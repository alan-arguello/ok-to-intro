import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { DAILY_BUDGET_USD, flags } from '@/lib/env';
import { getAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { capMonth, NETWORK_TZ, nextMonthStart, zonedParts, zonedTimeToUtc } from '@/lib/oti/time';
import { MODELS } from '@/lib/site';

/**
 * Owner: BE1. What live model calls cost, and the two stops that pause them (ux-spec §8 “Budget”):
 *
 * 1. Anthropic's own stops. A 429 whose error code is `enforced_spend_limit_reached` (the tier cap, no retry-after),
 *    a 400 saying the workspace reached its usage limits, or a 402 billing error. Never retried: live checks pause
 *    until the 1st of next month (Pacific time), presets keep their recorded run.
 * 2. The app's daily dollar cap (DAILY_BUDGET_USD, default $10, below the workspace limit): measured from token
 *    usage after every call, summed per Pacific-time day across instances in `public.model_usage`
 *    (`add_model_usage`). At the cap, live checks pause until the next local midnight.
 *
 * A pause is held in memory and, when the database is configured, in `public.app_state` (key `live_pause`), so every
 * instance sees it. To lift an Anthropic pause early (after raising the limit): `delete from public.app_state where
 * key = 'live_pause'` and redeploy (each instance also keeps its own copy until it restarts).
 * Never throws; a database problem only means each instance enforces what it has seen itself.
 */

/* ========================================================================== *
 * Prices (USD per million tokens; prompts up to 100K tokens; tech.md + the claude-api reference, Nov 2026)
 * ========================================================================== */

export interface ModelPrice {
  input: number;
  output: number;
  /** 5-minute cache write (1.25 × input). */
  cache_write: number;
  /** Cache read (0.1 × input). */
  cache_read: number;
}

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  [MODELS.gate]: { input: 0.1, output: 0.5, cache_write: 0.125, cache_read: 0.01 },
  [MODELS.compiler]: { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 },
  [MODELS.offline]: { input: 4, output: 20, cache_write: 5, cache_read: 0.4 },
};

/** The usage fields a Messages response reports. Nulls count as 0. */
export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Dollars for one response, measured from its token usage. `input_tokens` is the uncached part only (the API
 * reports cache writes and reads separately). Unknown model → null (never a guess).
 */
export function usageCost(model: string, usage: UsageLike | null | undefined): number | null {
  if (!usage) return null;
  const p = PRICES[model];
  if (!p) return null;
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const usd =
    (n(usage.input_tokens) * p.input +
      n(usage.output_tokens) * p.output +
      n(usage.cache_creation_input_tokens) * p.cache_write +
      n(usage.cache_read_input_tokens) * p.cache_read) /
    1_000_000;
  return Math.round(usd * 1e9) / 1e9;
}

/* ========================================================================== *
 * Anthropic budget stops
 * ========================================================================== */

/** True for the API's spend stops (tech.md “budget”): never retry these, pause live calls instead. */
export function isBudgetStop(err: unknown): boolean {
  if (!(err instanceof APIError)) return false;
  if (err.errorCode === 'enforced_spend_limit_reached') return true;
  if (err.status === 402 || err.type === 'billing_error') return true;
  // The workspace spend limit has no error code: a 400 whose message says the usage limits were reached.
  if (err.status === 400 && /usage limits|spend limit|credit balance is too low/i.test(err.apiMessage ?? err.message ?? '')) return true;
  return false;
}

/** Seconds from a `retry-after-ms` or `retry-after` header (seconds or an HTTP date), or null. */
export function retryAfterSeconds(headers: Headers | null | undefined, now: number = Date.now()): number | null {
  if (!headers) return null;
  const ms = headers.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms) / 1000);
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, (at - now) / 1000);
}

/* ========================================================================== *
 * Dates
 * ========================================================================== */

/** `YYYY-MM-DD`, the Pacific-time day (model_usage.day). */
export function localDay(now: number = Date.now()): string {
  const p = zonedParts(now, NETWORK_TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The next local midnight in Pacific time (when the daily cap resets). */
export function nextLocalMidnight(now: number = Date.now()): Date {
  const p = zonedParts(now, NETWORK_TZ);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return new Date(zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, NETWORK_TZ));
}

/** The 1st of next month, local midnight in Pacific time (when an Anthropic monthly limit is assumed to reset). */
export function nextMonthStartFrom(now: number = Date.now()): Date {
  return nextMonthStart(capMonth(now));
}

/* ========================================================================== *
 * The live pause
 * ========================================================================== */

export type PauseReason = 'anthropic_spend_limit' | 'daily_cap';

export interface LivePause {
  state: 'budget';
  /** ISO. */
  until: string;
  reason: PauseReason;
}

const PAUSE_KEY = 'live_pause';
const SHARED_READ_TTL_MS = 15_000;
const DB_READ_TIMEOUT_MS = 400;
const DB_WRITE_TIMEOUT_MS = 2_000;

let memoryPause: LivePause | null = null;
let sharedPause: { value: LivePause | null; readAt: number } | null = null;
let sharedRead: Promise<void> | null = null;

function dbClient() {
  if (!flags.hasSupabaseAdmin) return null;
  const admin = getAdminClient();
  return admin.ok ? admin.client : null;
}

function asPause(value: unknown): LivePause | null {
  const v = value as Partial<LivePause> | null;
  if (!v || v.state !== 'budget' || typeof v.until !== 'string' || Number.isNaN(Date.parse(v.until))) return null;
  return { state: 'budget', until: v.until, reason: v.reason === 'daily_cap' ? 'daily_cap' : 'anthropic_spend_limit' };
}

async function refreshSharedPause(now: number): Promise<void> {
  const db = dbClient();
  if (!db) return;
  try {
    const { data, error } = await db.from('app_state').select('value').eq('key', PAUSE_KEY).abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS)).maybeSingle();
    sharedPause = { value: error ? (sharedPause?.value ?? null) : asPause(data?.value), readAt: now };
  } catch {
    sharedPause = { value: sharedPause?.value ?? null, readAt: now };
  }
}

/**
 * Pauses live calls until `until` on this instance and, when the database is configured, on every instance.
 * Never throws. The shared write is awaited with a short timeout so a following request on another instance sees it.
 */
export async function pauseLive(reason: PauseReason, until: Date): Promise<void> {
  const pause: LivePause = { state: 'budget', until: until.toISOString(), reason };
  // Many gates of one run hit the same stop at once: pause and write it once.
  if (memoryPause && Date.parse(memoryPause.until) >= until.getTime()) return;
  memoryPause = pause;
  console.warn(`[budget] live checks paused until ${pause.until} (${reason})`);
  const db = dbClient();
  if (!db) return;
  try {
    await db
      .from('app_state')
      .upsert({ key: PAUSE_KEY, value: pause as unknown as Json, updated_at: new Date().toISOString() })
      .abortSignal(AbortSignal.timeout(DB_WRITE_TIMEOUT_MS));
    sharedPause = { value: pause, readAt: Date.now() };
  } catch {
    /* this instance still holds the pause */
  }
}

/** The active pause, if any: an Anthropic stop (memory or shared) or the daily cap. */
export async function currentPause(now: number = Date.now()): Promise<LivePause | null> {
  if (memoryPause && Date.parse(memoryPause.until) > now) return memoryPause;
  if (dbClient()) {
    if (!sharedPause || now - sharedPause.readAt > SHARED_READ_TTL_MS) {
      sharedRead ??= refreshSharedPause(now).finally(() => {
        sharedRead = null;
      });
      await sharedRead;
    }
    const shared = sharedPause?.value ?? null;
    if (shared && Date.parse(shared.until) > now) return shared;
  }
  const spent = await spentToday(now);
  if (spent >= DAILY_BUDGET_USD) return { state: 'budget', until: nextLocalMidnight(now).toISOString(), reason: 'daily_cap' };
  return null;
}

/* ========================================================================== *
 * Daily spend
 * ========================================================================== */

interface DayTotal {
  day: string;
  usd: number;
  calls: number;
}

/** This instance's spend today (flushed and not). */
let local: DayTotal = { day: '', usd: 0, calls: 0 };
/** The network total last read from (or returned by) the database. */
let shared: (DayTotal & { readAt: number }) | null = null;
/** Not yet added to the database. */
let pending: DayTotal = { day: '', usd: 0, calls: 0 };
let flushing: Promise<void> | null = null;
let totalRead: Promise<void> | null = null;

function rollDay(now: number) {
  const day = localDay(now);
  if (local.day !== day) local = { day, usd: 0, calls: 0 };
  if (pending.day !== day) pending = { day, usd: 0, calls: 0 };
}

async function flushUsage(): Promise<void> {
  const db = dbClient();
  if (!db) return;
  while (pending.usd > 0 || pending.calls > 0) {
    const batch = { ...pending };
    pending = { day: batch.day, usd: 0, calls: 0 };
    try {
      const { data, error } = await db
        .rpc('add_model_usage', { p_usd: batch.usd, p_calls: batch.calls })
        .abortSignal(AbortSignal.timeout(DB_WRITE_TIMEOUT_MS));
      if (error) throw new Error(error.code || 'rpc error');
      if (typeof data === 'number' || typeof data === 'string') shared = { day: batch.day, usd: Number(data), calls: 0, readAt: Date.now() };
    } catch {
      // Keep it for the next flush (same day only); the instance's own total already counts it.
      if (pending.day === batch.day) pending = { day: batch.day, usd: pending.usd + batch.usd, calls: pending.calls + batch.calls };
      return;
    }
  }
}

/**
 * Adds measured spend (from token usage) to today's totals. Never throws, never blocks the caller: one database
 * write is in flight at a time and later usage joins the next one.
 */
export function recordUsage(usd: number | null, calls = 1, now: number = Date.now()): void {
  rollDay(now);
  const value = typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : 0;
  local.usd += value;
  local.calls += calls;
  pending.usd += value;
  pending.calls += calls;
  if (!flushing && dbClient()) {
    flushing = flushUsage()
      .catch(() => undefined)
      .finally(() => {
        flushing = null;
      });
  }
}

/** Waits for the usage write in flight (scripts and tests call it before exiting). */
export async function settleUsage(): Promise<void> {
  if (flushing) await flushing;
}

async function readTotal(day: string, now: number): Promise<void> {
  const db = dbClient();
  if (!db) return;
  try {
    const { data, error } = await db.from('model_usage').select('usd, calls').eq('day', day).abortSignal(AbortSignal.timeout(DB_READ_TIMEOUT_MS)).maybeSingle();
    if (!error) shared = { day, usd: Number(data?.usd ?? 0), calls: Number(data?.calls ?? 0), readAt: now };
  } catch {
    /* keep the last value */
  }
}

/** Best estimate of today's network-wide spend in USD (Pacific-time day). */
export async function spentToday(now: number = Date.now()): Promise<number> {
  rollDay(now);
  const day = local.day;
  if (dbClient() && (!shared || shared.day !== day || now - shared.readAt > 60_000)) {
    totalRead ??= readTotal(day, now).finally(() => {
      totalRead = null;
    });
    await totalRead;
  }
  const sharedUsd = shared && shared.day === day ? shared.usd + pending.usd : 0;
  return Math.max(local.usd, sharedUsd);
}

/** For tests: forget every pause and total. */
export function __resetBudgetForTests(): void {
  memoryPause = null;
  sharedPause = null;
  sharedRead = null;
  local = { day: '', usd: 0, calls: 0 };
  shared = null;
  pending = { day: '', usd: 0, calls: 0 };
  flushing = null;
  totalRead = null;
}
