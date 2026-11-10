import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { flags } from '@/lib/env';
import { rateKey } from '@/lib/oti/tokens';
import { getAdminClient } from '@/lib/supabase/admin';
import type { RateBucket, RateLimitResult } from '@/lib/types';
import { localDay } from './budget';

/**
 * Owner: BE1. Per-address limits (ux-spec §8 “Limits”). The Vercel WAF rule returns 429 at the edge first;
 * this module gives the friendly reset time from a Postgres counter keyed by HMAC(ip, daily salt)
 * (public.hit_rate_limit), falling back to an in-memory limiter when that query fails or takes over 300 ms.
 *
 * - The key is never the raw IP: HMAC-SHA256 over the IP with a salt that changes every Pacific-time day
 *   (RATE_LIMIT_SALT_SECRET + the date). Without that secret the salt is random per server process, the counter is
 *   kept in memory only (per instance), and the key starts with `m`.
 * - Windows are fixed and aligned the way the SQL aligns them (epoch / window), so both counters agree on reset times.
 * - Presets, recorded runs and code refusals never call this: only requests that will call the model count.
 */

/** Limits per bucket: 20 live runs per 10 minutes on /api/try and /api/asks/* (presets are unlimited). */
export const RATE_LIMITS: Readonly<Record<RateBucket, { limit: number; window_s: number }>> = {
  try: { limit: 20, window_s: 600 },
  compile: { limit: 20, window_s: 600 },
  send: { limit: 20, window_s: 600 },
  sample_send: { limit: 20, window_s: 600 },
  mcp: { limit: 60, window_s: 600 },
  pages: { limit: 120, window_s: 60 },
  // Personal gates (/g). Not in rate_limits' bucket check, so the shared counter errors and the in-memory limiter decides.
  gate_create: { limit: 5, window_s: 3600 },
  gate_ask: { limit: 6, window_s: 600 },
};

/** The Postgres counter gets this long before the in-memory limiter decides instead. */
export const DB_LIMIT_TIMEOUT_MS = 300;

const PROCESS_SALT = randomBytes(32).toString('hex');
const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

/** The client address as Vercel reports it (its own header first; it can't be set by the client), or null. */
export function clientIp(headers: Headers): string | null {
  const candidates = [
    headers.get('x-vercel-forwarded-for')?.split(',')[0],
    headers.get('x-real-ip'),
    headers.get('x-forwarded-for')?.split(',')[0],
  ];
  for (const c of candidates) {
    const ip = c?.trim();
    if (ip && IP_RE.test(ip)) return ip.toLowerCase();
  }
  return null;
}

/**
 * The rate-limit key for a request: HMAC(ip, daily salt) — never the raw IP (ux-spec S8 /privacy).
 * Reads x-forwarded-for / x-real-ip as Vercel sets them. Returns null when no address is known.
 */
export function clientKey(request: Request): string | null {
  const ip = clientIp(request.headers);
  if (!ip) return null;
  const day = localDay();
  const shared = rateKey(ip, day);
  if (shared) return shared;
  return `m${createHmac('sha256', `${PROCESS_SALT}:${day}`).update(ip).digest('hex').slice(0, 31)}`;
}

/* ========================================================================== *
 * Counters
 * ========================================================================== */

function windowStart(nowMs: number, window_s: number): number {
  return Math.floor(nowMs / 1000 / window_s) * window_s;
}

const memory = new Map<string, { start: number; count: number }>();
const MEMORY_MAX_KEYS = 20_000;

function prune(nowMs: number) {
  if (memory.size < MEMORY_MAX_KEYS) return;
  const longest = Math.max(...Object.values(RATE_LIMITS).map((l) => l.window_s));
  const oldest = nowMs / 1000 - longest;
  for (const [k, v] of memory) if (v.start < oldest) memory.delete(k);
  // Still full (a flood of distinct addresses): drop the oldest entries; the edge limit still applies.
  for (const k of memory.keys()) {
    if (memory.size < MEMORY_MAX_KEYS) break;
    memory.delete(k);
  }
}

/** The in-memory fixed-window limiter (per instance). */
export function memoryHit(key: string, bucket: RateBucket, nowMs: number = Date.now()): RateLimitResult {
  const { limit, window_s } = RATE_LIMITS[bucket];
  const start = windowStart(nowMs, window_s);
  const id = `${bucket}|${key}`;
  const entry = memory.get(id);
  const count = entry && entry.start === start ? entry.count + 1 : 1;
  memory.delete(id);
  memory.set(id, { start, count });
  prune(nowMs);
  if (count <= limit) return { ok: true, remaining: limit - count };
  return { ok: false, retry_at: new Date((start + window_s) * 1000).toISOString(), limit, window_s };
}

/** The shared counter: one `hit_rate_limit` call (null when it fails). */
async function dbHit(key: string, bucket: RateBucket): Promise<RateLimitResult | null> {
  const admin = getAdminClient();
  if (!admin.ok) return null;
  const { limit, window_s } = RATE_LIMITS[bucket];
  try {
    const { data, error } = await admin.client
      .rpc('hit_rate_limit', { p_key: key, p_bucket: bucket, p_window_s: window_s, p_limit: limit })
      .abortSignal(AbortSignal.timeout(DB_LIMIT_TIMEOUT_MS));
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row) return null;
    if (row.allowed) return { ok: true, remaining: Math.max(0, limit - Number(row.hits)) };
    return { ok: false, retry_at: new Date(row.retry_at).toISOString(), limit, window_s };
  } catch {
    return null;
  }
}

/** Resolves to null when `work` takes longer than `ms` or rejects. */
function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

let dbHitForTests: ((key: string, bucket: RateBucket) => Promise<RateLimitResult | null>) | null = null;

/**
 * Counts one hit for `key` in `bucket` and says whether it is allowed. A null key (unknown address) is allowed.
 * Never throws: a database failure, or an answer slower than 300 ms, falls back to the in-memory limiter.
 */
export async function checkRateLimit(key: string | null, bucket: RateBucket): Promise<RateLimitResult> {
  if (!key) return { ok: true, remaining: RATE_LIMITS[bucket].limit };
  const shared = dbHitForTests ?? (flags.hasSupabaseAdmin && flags.hasRateLimitSalt && !key.startsWith('m') ? dbHit : null);
  if (shared) {
    const res = await within(shared(key, bucket), DB_LIMIT_TIMEOUT_MS);
    if (res) return res;
  }
  return memoryHit(key, bucket);
}

/** For tests: replace the Postgres counter (null restores it) and clear the memory counters. */
export function __setRateLimitDbForTests(fn: ((key: string, bucket: RateBucket) => Promise<RateLimitResult | null>) | null): void {
  dbHitForTests = fn;
  memory.clear();
}
