import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { looksLikeToken, SAMPLE_TOKEN } from '@/lib/oti/ids';
import { getUser, requireMember } from '@/lib/supabase/server';

/**
 * Guards for the recipient pages' POSTs (tech.md “One-tap actions”): a per-link CSRF token on top of Next's own
 * Origin check for server actions, idempotency keys that never contain the raw link token, and one way to turn the
 * URL segment of /o and /c into a reference BE2 understands.
 */

/** The SAMPLE pages change nothing, so their forms carry a fixed marker instead of a token. */
export const SAMPLE_CSRF = 'sample';
export const EXAMPLE_CSRF = 'example';

/**
 * HMAC(TOKEN_HMAC_SECRET, `csrf:<scope>`), 32 base64url characters. The scope names the object and the person
 * (`o:t:<token>`, `o:i:<offer_id>:<member_id>`, …), so a token from one page never validates another. Null without
 * the secret: then token links can't be verified either, and REAL pages render their not-set-up state.
 */
export function csrfToken(scope: string): string | null {
  const secret = env.TOKEN_HMAC_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`csrf:${scope}`).digest('base64url').slice(0, 32);
}

export function csrfValid(scope: string, value: unknown): boolean {
  const expected = csrfToken(scope);
  if (!expected || typeof value !== 'string' || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

/**
 * An idempotency key for one change on one object: `<action>:<sha256(scope)>`. Built on the server only (a client
 * never picks a key BE2 dedupes on), and the raw link token never appears in it (tokens are never stored).
 */
export function serverIdempotencyKey(scope: string, action: string): string {
  return `${action}:${createHash('sha256').update(scope).digest('base64url').slice(0, 32)}`;
}

export type RecipientRef<R> =
  | { kind: 'sample' }
  | { kind: 'real'; ref: R; scope: string }
  | { kind: 'invalid' }
  | { kind: 'unconfigured' }
  | { kind: 'broken' };

/**
 * Resolves the URL segment of /o or /c (docs/CONTRACT.md §b): `sample` → SAMPLE; a 22-character link token →
 * `{token}`; an `o_…`/`c_…` id → the signed-in member it belongs to (signed out → /join?next=…); anything else →
 * invalid (never a 404). Without Supabase an id can't be checked, so it renders the not-set-up state.
 */
export async function resolveRecipientRef<R>(
  segment: string,
  kind: 'o' | 'c',
  build: { token: (token: string) => R; id: (id: string, memberId: string) => R },
): Promise<RecipientRef<R>> {
  if (segment === SAMPLE_TOKEN) return { kind: 'sample' };
  if (looksLikeToken(segment)) return { kind: 'real', ref: build.token(segment), scope: `${kind}:t:${segment}` };
  if (new RegExp(`^${kind}_[0-9A-Za-z]{3,16}$`).test(segment)) {
    const user = await getUser();
    if (!user.ok) {
      if (user.reason === 'not_configured') return { kind: 'unconfigured' };
      if (user.reason === 'error') return { kind: 'broken' };
      // Signed out: sign in, then come back to this page. requireMember redirects (never inside a try/catch).
      await requireMember({ next: `/${kind}/${segment}` });
      return { kind: 'invalid' };
    }
    return { kind: 'real', ref: build.id(segment, user.user.id), scope: `${kind}:i:${segment}:${user.user.id}` };
  }
  return { kind: 'invalid' };
}
