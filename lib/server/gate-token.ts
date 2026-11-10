import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A new owner token: 32 random bytes, base64url (43 characters). Shown once; only its hash is stored. */
export function newOwnerToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of the token, hex. */
export function hashOwnerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time check of a presented token against a stored hash. False for anything malformed. */
export function ownerTokenMatches(token: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (typeof token !== 'string' || typeof storedHash !== 'string' || !token || token.length > 200) return false;
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashOwnerToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
