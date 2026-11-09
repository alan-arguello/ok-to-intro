import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import type { GateFailureKind, LiveState } from '@/lib/types';
import { currentPause, retryAfterSeconds, settleUsage } from './budget';
import { GATE_TIMEOUT_MS, MAX_RETRY_AFTER_S, SDK_MAX_RETRIES } from './rubric';

/**
 * Owner: BE1. Whether live model calls can run right now (ux-spec §8 “Degraded modes”), computed from live traffic
 * with no cron canary, plus the one Anthropic client every live call shares.
 *
 *   off     no ANTHROPIC_API_KEY on this instance (never described as an outage)
 *   budget  Anthropic reported a spend stop, or the app's daily dollar cap was reached (budget.ts); never retried
 *           until `paused_until`
 *   down    the last 5 model calls in a row failed (timeouts, 5xx, 529s, connection errors), the last one less than
 *           60 s ago; after that the next run is let through as a probe, and one success ends it
 *   slow    p95 of the last 50 gate calls over 6 s (a timeout counts as over), or more than 20% of them rate-limited
 *           (at least 10 calls in the last 15 minutes)
 *   ok      otherwise
 *
 * The stats are per server instance (Fluid compute keeps a few warm); the budget pause is shared through the
 * database when it is configured.
 */

export interface LiveSnapshot {
  state: LiveState;
  /** When a budget pause ends (ISO), else null. */
  paused_until: string | null;
}

/* ========================================================================== *
 * The client
 * ========================================================================== */

let client: Anthropic | null = null;
let testOverride: { fetch: typeof fetch; apiKey: string } | null = null;

/**
 * The SDK's own retry (maxRetries 1) honours `x-should-retry`. This fetch wrapper sets it to false whenever the API
 * asks for a wait we won't make: a 429 without retry-after or with more than 2 s (an Anthropic spend stop has none),
 * and a 5xx/529 with more than 2 s. So at most one retry happens, and only within the 2 s rule (ux-spec §8).
 */
export function retryPolicyFetch(base: typeof fetch): typeof fetch {
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const res = await base(input, init);
    if (res.status !== 429 && res.status < 500) return res;
    const wait = retryAfterSeconds(res.headers);
    const retry = res.status === 429 ? wait !== null && wait <= MAX_RETRY_AFTER_S : wait === null || wait <= MAX_RETRY_AFTER_S;
    if (retry || res.headers.get('x-should-retry') === 'false') return res;
    const headers = new Headers(res.headers);
    headers.set('x-should-retry', 'false');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
  return wrapped as typeof fetch;
}

/** True when this instance can call the model at all (a key is set). */
export function liveConfigured(): boolean {
  return Boolean(testOverride || env.ANTHROPIC_API_KEY);
}

/**
 * The shared client (created once per instance, so keep-alive sockets are reused across Fluid-concurrent
 * invocations). Null without a key. maxRetries 1; each call passes its own deadline and signal.
 */
export function getModelClient(): Anthropic | null {
  const apiKey = testOverride?.apiKey ?? env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client ??= new Anthropic({
    apiKey,
    maxRetries: SDK_MAX_RETRIES,
    timeout: 30_000,
    // Keys that are not scoped to a workspace must name one on every request.
    ...(env.ANTHROPIC_WORKSPACE_ID && !testOverride ? { defaultHeaders: { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } } : {}),
    fetch: retryPolicyFetch(testOverride?.fetch ?? globalThis.fetch.bind(globalThis)),
  });
  return client;
}

/** For tests: route every model call through `fetchImpl` (a fake API). Pass null to restore. Resets the stats. */
export function __setModelFetchForTests(fetchImpl: typeof fetch | null, apiKey = 'sk-ant-test-key'): void {
  testOverride = fetchImpl ? { fetch: fetchImpl, apiKey } : null;
  client = null;
  __resetLiveStatsForTests();
}

/* ========================================================================== *
 * Traffic stats
 * ========================================================================== */

interface CallStat {
  at: number;
  /** Latency in ms; a timeout counts as over the 6 s budget. */
  ms: number;
  kind: GateFailureKind | null;
}

const WINDOW = 50;
const DOWN_STREAK = 5;
const DOWN_COOLDOWN_MS = 60_000;
const SLOW_P95_MS = 6_000;
const SLOW_429_SHARE = 0.2;
const SLOW_MIN_SAMPLES = 10;
const STATS_FRESH_MS = 15 * 60_000;

let gateCalls: CallStat[] = [];
let failureStreak = 0;
let lastFailureAt = 0;

/** The API didn't answer: these count toward `down`. Refusals and parse failures are answers; budget has its own state. */
function isOutage(kind: GateFailureKind | null): boolean {
  return kind === 'timeout' || kind === 'overloaded' || kind === 'unavailable';
}

/**
 * Records one model call's outcome (`kind` null = a valid answer). `gate` calls also feed the latency window; the
 * compiler's calls only feed the failure streak. Calls the caller aborted (the visitor left) are not recorded.
 */
export function recordModelCall(outcome: { ms: number; kind: GateFailureKind | null; gate: boolean; at?: number }): void {
  const at = outcome.at ?? Date.now();
  if (outcome.gate) {
    gateCalls.push({ at, ms: outcome.kind === 'timeout' ? GATE_TIMEOUT_MS + 1 : Math.max(0, outcome.ms), kind: outcome.kind });
    if (gateCalls.length > WINDOW) gateCalls = gateCalls.slice(-WINDOW);
  }
  if (isOutage(outcome.kind)) {
    failureStreak += 1;
    lastFailureAt = at;
  } else if (outcome.kind !== 'rate_limited' && outcome.kind !== 'budget') {
    failureStreak = 0;
  }
}

function isDown(now: number): boolean {
  return failureStreak >= DOWN_STREAK && now - lastFailureAt < DOWN_COOLDOWN_MS;
}

/** p95 over the given latencies (nearest rank). */
export function p95(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] as number;
}

function isSlow(now: number): boolean {
  const recent = gateCalls.filter((c) => now - c.at < STATS_FRESH_MS);
  if (recent.length < SLOW_MIN_SAMPLES) return false;
  const latencies = recent.filter((c) => c.kind === null || c.kind === 'timeout' || c.kind === 'refused' || c.kind === 'parse').map((c) => c.ms);
  const limited = recent.filter((c) => c.kind === 'rate_limited').length / recent.length;
  return p95(latencies) > SLOW_P95_MS || limited > SLOW_429_SHARE;
}

/** The current live state. Never throws. */
export async function getLiveState(now: number = Date.now()): Promise<LiveSnapshot> {
  if (!liveConfigured()) return { state: 'off', paused_until: null };
  try {
    const pause = await currentPause(now);
    if (pause) return { state: 'budget', paused_until: pause.until };
  } catch {
    /* a budget lookup problem never blocks live checks on its own */
  }
  if (isDown(now)) return { state: 'down', paused_until: null };
  if (isSlow(now)) return { state: 'slow', paused_until: null };
  return { state: 'ok', paused_until: null };
}

/** True when live calls may start (state ok or slow). */
export function canRunLive(snapshot: LiveSnapshot): boolean {
  return snapshot.state === 'ok' || snapshot.state === 'slow';
}

/* ========================================================================== *
 * Work that outlives the response (usage writes, audit rows)
 * ========================================================================== */

const background = new Set<Promise<unknown>>();

/** Keeps a side effect alive until `settleBackground()`; route handlers call that from `after()`. Never rejects. */
export function track(work: Promise<unknown>): void {
  const p = work.catch(() => undefined).finally(() => background.delete(p));
  background.add(p);
}

/** Waits for every tracked side effect and the usage write in flight. */
export async function settleBackground(): Promise<void> {
  await Promise.all([...background]);
  await settleUsage();
}

/** For tests: forget the traffic stats. */
export function __resetLiveStatsForTests(): void {
  gateCalls = [];
  failureStreak = 0;
  lastFailureAt = 0;
}
