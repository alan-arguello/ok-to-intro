/**
 * Public ids and opaque tokens. Works in Node and the browser (Web Crypto).
 *
 * - Public ids are short and unguessable enough to show in URLs and receipts: `a_91xQ2`, `o_3Fp9kL`, `q_7Hd2`.
 *   They are never a capability: every read behind an id also checks ownership.
 * - Tokens in email links are 128-bit random (base64url, 22 characters). Only their HMAC is stored
 *   (lib/oti/tokens.ts, server-only). A GET never consumes a token.
 */

const ALPHABET = '0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'; // no l, O, I

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Prefixes by object, so an id says what it is. */
export const ID_PREFIX = {
  ask: 'a',
  /** A SAMPLE send of the visitor's own text (never persisted; its state lives in the browser tab). */
  sampleAsk: 'sa',
  offer: 'o',
  question: 'q',
  intro: 'i',
  checkin: 'c',
  draft: 'd',
  run: 'r',
  token: 't',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/** `publicId('ask')` → `a_91xQ2k` (prefix, underscore, `length` characters from a 58-letter alphabet). */
export function publicId(kind: IdKind, length = 6): string {
  const bytes = randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  return `${ID_PREFIX[kind]}_${s}`;
}

/** 128-bit random token, base64url without padding (22 characters). */
export function newToken(): string {
  const bytes = randomBytes(16);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Shape check before any lookup (cheap rejection of junk paths). */
export function looksLikeToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(s);
}

/** `sample` is the public SAMPLE offer and check-in (/o/sample, /c/sample). */
export const SAMPLE_TOKEN = 'sample';

/** A SAMPLE ask id (`sa_eng`, `sa_health`, `sa_founder`, or `sa_` + random): rendered from the tab, never the database. */
export function isSampleAskId(id: string): boolean {
  return /^sa_[0-9A-Za-z]{3,16}$/.test(id);
}

/** A REAL ask id (`a_…`): owner-only, through the asker serializer. */
export function isRealAskId(id: string): boolean {
  return /^a_[0-9A-Za-z]{3,16}$/.test(id);
}
