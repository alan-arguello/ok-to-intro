import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as healthRoute } from '@/app/api/health/route';
import {
  __resetBudgetForTests,
  currentPause,
  isBudgetStop,
  localDay,
  nextLocalMidnight,
  nextMonthStartFrom,
  recordUsage,
  retryAfterSeconds,
  spentToday,
  usageCost,
} from '@/lib/server/budget';
import { getHealth } from '@/lib/server/health';
import { __resetLiveStatsForTests, __setModelFetchForTests, canRunLive, getLiveState, p95, recordModelCall, retryPolicyFetch } from '@/lib/server/live';
import { __setRateLimitDbForTests, checkRateLimit, clientIp, clientKey, memoryHit, RATE_LIMITS } from '@/lib/server/ratelimit';
import { BadRequestError, RateLimitError } from '@anthropic-ai/sdk';
import { fakeFetch } from './fake-api';

const req = (headers: Record<string, string>) => new Request('http://localhost/api/try', { method: 'POST', headers });

describe('rate-limit keys', () => {
  it('are an HMAC of the address, never the address itself', () => {
    const k = clientKey(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(k).toMatch(/^m[0-9a-f]{31}$/);
    expect(k).not.toContain('203.0.113.7');
    expect(clientKey(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe(k);
    expect(clientKey(req({ 'x-forwarded-for': '203.0.113.8' }))).not.toBe(k);
  });

  it('prefer the platform’s own header, and ignore junk', () => {
    expect(clientIp(new Headers({ 'x-vercel-forwarded-for': '198.51.100.1', 'x-forwarded-for': '203.0.113.7' }))).toBe('198.51.100.1');
    expect(clientIp(new Headers({ 'x-real-ip': '2001:DB8::1' }))).toBe('2001:db8::1');
    expect(clientIp(new Headers({ 'x-forwarded-for': '<script>' }))).toBeNull();
    expect(clientKey(req({}))).toBeNull();
  });
});

describe('the limiter', () => {
  beforeEach(() => __setRateLimitDbForTests(null));
  afterEach(() => __setRateLimitDbForTests(null));

  it('allows 20 live runs per 10-minute window, then says when the next one is', () => {
    const t = Date.UTC(2026, 10, 9, 16, 31, 0);
    for (let n = 1; n <= 20; n++) expect(memoryHit('k1', 'try', t + n * 1000)).toEqual({ ok: true, remaining: 20 - n });
    const blocked = memoryHit('k1', 'try', t + 25_000);
    expect(blocked).toEqual({ ok: false, retry_at: new Date(Date.UTC(2026, 10, 9, 16, 40, 0)).toISOString(), limit: 20, window_s: 600 });
    expect(memoryHit('k1', 'try', Date.UTC(2026, 10, 9, 16, 40, 1))).toEqual({ ok: true, remaining: 19 });
    expect(memoryHit('k1', 'compile', t)).toEqual({ ok: true, remaining: 19 });
    expect(RATE_LIMITS.try).toEqual({ limit: 20, window_s: 600 });
  });

  it('lets an unknown address through', async () => {
    expect(await checkRateLimit(null, 'try')).toEqual({ ok: true, remaining: 20 });
  });

  it('uses the Postgres counter when it answers in time', async () => {
    const retry_at = new Date(Date.now() + 90_000).toISOString();
    __setRateLimitDbForTests(async () => ({ ok: false, retry_at, limit: 20, window_s: 600 }));
    expect(await checkRateLimit('k-db', 'try')).toEqual({ ok: false, retry_at, limit: 20, window_s: 600 });
  });

  it('falls back to memory when the counter takes over 300 ms or fails', async () => {
    __setRateLimitDbForTests(() => new Promise((resolve) => setTimeout(() => resolve({ ok: false, retry_at: new Date().toISOString(), limit: 20, window_s: 600 }), 2_000)));
    const t0 = Date.now();
    expect(await checkRateLimit('k-slow', 'try')).toEqual({ ok: true, remaining: 19 });
    expect(Date.now() - t0).toBeLessThan(800);
    __setRateLimitDbForTests(async () => {
      throw new Error('connection refused');
    });
    expect(await checkRateLimit('k-down', 'try')).toEqual({ ok: true, remaining: 19 });
    expect(await checkRateLimit('k-down', 'try')).toEqual({ ok: true, remaining: 18 });
    __setRateLimitDbForTests(async () => null);
    expect(await checkRateLimit('k-null', 'try')).toEqual({ ok: true, remaining: 19 });
  });
});

describe('retry policy (the SDK honours x-should-retry)', () => {
  it('allows a retry only within 2 s, and never on a 429 without retry-after', async () => {
    const make = (status: number, headers: Record<string, string>) => retryPolicyFetch(async () => new Response('{}', { status, headers }));
    const should = async (status: number, headers: Record<string, string>) => (await make(status, headers)('https://api.anthropic.com/v1/messages')).headers.get('x-should-retry');
    expect(await should(429, { 'retry-after': '1' })).toBeNull();
    expect(await should(429, { 'retry-after': '3' })).toBe('false');
    expect(await should(429, {})).toBe('false');
    expect(await should(529, {})).toBeNull();
    expect(await should(529, { 'retry-after': '30' })).toBe('false');
    expect(await should(200, {})).toBeNull();
    expect(await should(400, {})).toBeNull();
  });
});

describe('budget', () => {
  beforeEach(() => __resetBudgetForTests());
  afterEach(() => __resetBudgetForTests());

  it('prices usage per model from measured tokens', () => {
    expect(usageCost('claude-haiku-5-5', { input_tokens: 1_000_000 })).toBeCloseTo(0.1, 10);
    expect(usageCost('claude-haiku-5-5', { output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(0.5 + 0.01 + 0.125, 10);
    expect(usageCost('claude-sonnet-5-5', { input_tokens: 600, output_tokens: 300 })).toBeCloseTo((600 * 2 + 300 * 10) / 1e6, 12);
    expect(usageCost('some-other-model', { input_tokens: 1 })).toBeNull();
    expect(usageCost('claude-haiku-5-5', null)).toBeNull();
  });

  it('pauses live checks at the daily dollar cap until the next local midnight', async () => {
    const now = Date.UTC(2026, 10, 9, 17, 0);
    recordUsage(9.99, 1000, now);
    expect(await currentPause(now)).toBeNull();
    recordUsage(0.02, 1, now);
    expect(await spentToday(now)).toBeCloseTo(10.01, 6);
    expect(await currentPause(now)).toEqual({ state: 'budget', until: nextLocalMidnight(now).toISOString(), reason: 'daily_cap' });
    // A new Mexico City day starts from zero.
    const tomorrow = nextLocalMidnight(now).getTime() + 1000;
    expect(await currentPause(tomorrow)).toBeNull();
    expect(localDay(now)).toBe('2026-11-09');
    expect(nextLocalMidnight(now).toISOString()).toBe('2026-11-10T06:00:00.000Z');
    expect(nextMonthStartFrom(now).toISOString()).toBe('2026-12-01T06:00:00.000Z');
  });

  it('recognises Anthropic’s spend stops and nothing else', () => {
    const headers = new Headers();
    const err = (status: number, type: string, message: string, details?: Record<string, unknown>) => {
      const body = { type: 'error', error: { type, message, ...(details ? { details } : {}) } };
      return status === 429 ? new RateLimitError(429, body, undefined, headers) : new BadRequestError(400, body, undefined, headers);
    };
    expect(isBudgetStop(err(429, 'rate_limit_error', 'x', { error_code: 'enforced_spend_limit_reached' }))).toBe(true);
    expect(isBudgetStop(err(400, 'invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-12-01.'))).toBe(true);
    expect(isBudgetStop(err(429, 'rate_limit_error', 'Number of requests has exceeded your per-minute rate limit.'))).toBe(false);
    expect(isBudgetStop(err(400, 'invalid_request_error', 'messages: field required'))).toBe(false);
    expect(isBudgetStop(new Error('nope'))).toBe(false);
  });

  it('reads retry-after in seconds, milliseconds or as a date', () => {
    expect(retryAfterSeconds(new Headers({ 'retry-after': '7' }))).toBe(7);
    expect(retryAfterSeconds(new Headers({ 'retry-after-ms': '1500', 'retry-after': '9' }))).toBe(1.5);
    const now = Date.UTC(2026, 10, 9, 12, 0, 0);
    expect(retryAfterSeconds(new Headers({ 'retry-after': new Date(now + 4000).toUTCString() }), now)).toBe(4);
    expect(retryAfterSeconds(new Headers())).toBeNull();
  });
});

describe('live state from traffic', () => {
  beforeEach(() => {
    __setModelFetchForTests(fakeFetch().fetch);
    __resetBudgetForTests();
  });
  afterEach(() => {
    __setModelFetchForTests(null);
    __resetLiveStatsForTests();
    __resetBudgetForTests();
  });

  it('ok with too little traffic to judge', async () => {
    recordModelCall({ ms: 9_000, kind: null, gate: true });
    expect(await getLiveState()).toEqual({ state: 'ok', paused_until: null });
  });

  it('slow when p95 of the last calls is over 6 s (a timeout counts as over)', async () => {
    for (let n = 0; n < 18; n++) recordModelCall({ ms: 1_200, kind: null, gate: true });
    recordModelCall({ ms: 6_000, kind: 'timeout', gate: true });
    recordModelCall({ ms: 6_000, kind: 'timeout', gate: true });
    const live = await getLiveState();
    expect(live.state).toBe('slow');
    expect(canRunLive(live)).toBe(true);
  });

  it('slow when more than 20% of recent calls were rate-limited', async () => {
    for (let n = 0; n < 7; n++) recordModelCall({ ms: 900, kind: null, gate: true });
    for (let n = 0; n < 3; n++) recordModelCall({ ms: 300, kind: 'rate_limited', gate: true });
    expect((await getLiveState()).state).toBe('slow');
  });

  it('down after 5 outages in a row, compiler calls included; a success ends it', async () => {
    for (let n = 0; n < 4; n++) recordModelCall({ ms: 6_001, kind: 'timeout', gate: true });
    expect((await getLiveState()).state).not.toBe('down');
    recordModelCall({ ms: 300, kind: 'overloaded', gate: false });
    const live = await getLiveState();
    expect(live.state).toBe('down');
    expect(canRunLive(live)).toBe(false);
    recordModelCall({ ms: 800, kind: 'refused', gate: true });
    expect((await getLiveState()).state).not.toBe('down');
  });

  it('p95 is the nearest-rank 95th percentile', () => {
    expect(p95([])).toBe(0);
    expect(p95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19);
    expect(p95([5])).toBe(5);
  });
});

describe('GET /api/health', () => {
  afterEach(() => __setModelFetchForTests(null));

  it('reports configuration honestly without keys, and is cacheable for 15 s', async () => {
    __setModelFetchForTests(null);
    const res = await healthRoute();
    expect(res.headers.get('cache-control')).toContain('s-maxage=15');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ live: 'off', live_paused_until: null, db: 'off', email: 'off', network: 'sample_only' });
    expect(Date.parse(body.checked_at as string)).not.toBeNaN();
  });

  it('reports live ok once a key is configured', async () => {
    __setModelFetchForTests(fakeFetch().fetch);
    expect((await getHealth()).live).toBe('ok');
  });
});
