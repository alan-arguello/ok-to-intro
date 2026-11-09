import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Token hashing for email links and API tokens (server only).
 * Stored value = HMAC-SHA256(TOKEN_HMAC_SECRET, `${purpose}:${token}`) as hex. The purpose is part of the MAC,
 * so an offer token can never be replayed as a check-in or pause token. Raw tokens are never stored or logged.
 */

export type TokenPurpose = 'offer' | 'checkin' | 'pause' | 'api';

/** Hex HMAC of a token, or `null` when TOKEN_HMAC_SECRET is not configured (token features are off). */
export function hashToken(purpose: TokenPurpose, token: string): string | null {
  const secret = env.TOKEN_HMAC_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`${purpose}:${token}`).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * HMAC(ip, daily salt) for rate limits (ux-spec §8: “IP addresses: only an HMAC with a daily salt”).
 * Returns `null` without RATE_LIMIT_SALT_SECRET; callers then use the in-memory limiter keyed the same way
 * with a per-process salt.
 */
export function rateKey(ip: string, day: string): string | null {
  const secret = env.RATE_LIMIT_SALT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', `${secret}:${day}`).update(ip).digest('hex').slice(0, 32);
}
