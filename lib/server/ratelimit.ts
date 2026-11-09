import 'server-only';
import type { RateBucket, RateLimitResult } from '@/lib/types';

/**
 * Owner: BE1. Per-address limits (ux-spec §8 “Limits”). The Vercel WAF rule returns 429 at the edge first;
 * this module gives the friendly reset time from a Postgres counter keyed by HMAC(ip, daily salt)
 * (public.hit_rate_limit), falling back to an in-memory limiter when that query fails or takes over 300 ms.
 *
 * STUB (foundation): signatures are final. Until BE1 replaces the bodies, every check allows (no limits).
 */

/** Limits per bucket: 20 live runs per 10 minutes on /api/try and /api/asks/* (presets are unlimited). */
export const RATE_LIMITS: Readonly<Record<RateBucket, { limit: number; window_s: number }>> = {
  try: { limit: 20, window_s: 600 },
  compile: { limit: 20, window_s: 600 },
  send: { limit: 20, window_s: 600 },
  sample_send: { limit: 20, window_s: 600 },
  mcp: { limit: 60, window_s: 600 },
  pages: { limit: 120, window_s: 60 },
};

/**
 * The rate-limit key for a request: HMAC(ip, daily salt) — never the raw IP (ux-spec S8 /privacy).
 * Reads x-forwarded-for / x-real-ip as Vercel sets them. Returns null when no address is known.
 */
export function clientKey(request: Request): string | null {
  void request;
  return null;
}

/**
 * Counts one hit for `key` in `bucket` and says whether it is allowed. A null key (unknown address) is allowed.
 * Never throws: a database failure falls back to the in-memory limiter.
 */
export async function checkRateLimit(key: string | null, bucket: RateBucket): Promise<RateLimitResult> {
  void key;
  return { ok: true, remaining: RATE_LIMITS[bucket].limit };
}
