import 'server-only';
import { ERRORS } from '@/lib/receipts';
import { apiTokensConfigured, verifyApiToken } from '@/lib/server/api-tokens';
import { getHealth } from '@/lib/server/health';
import { checkRateLimit, RATE_LIMITS } from '@/lib/server/ratelimit';
import type { MemberRef } from '@/lib/types';
import type { McpRequestContext } from './context';

/**
 * The member behind a token tool call (S3's verifyApiToken), or the isError text that says what to do instead:
 * sign in and create a token, the token didn't verify, tokens aren't set up on this instance, or our side broke.
 */

export type MemberAuth = { ok: true; member: MemberRef } | { ok: false; text: string };

/** `what` names the action in the error, e.g. “my_asks” or “send_ask on the real network”. */
export async function requireMember(ctx: McpRequestContext, what: string): Promise<MemberAuth> {
  const configured = apiTokensConfigured();
  if (ctx.tokenState === 'none') return { ok: false, text: configured ? ERRORS.needsToken(what) : ERRORS.tokensOff(what) };
  if (!configured) return { ok: false, text: ERRORS.tokensOff(what) };
  const limit = await checkRateLimit(ctx.clientKey, 'mcp');
  if (!limit.ok) return { ok: false, text: ERRORS.rateLimited(limit.retry_at, 'token calls', RATE_LIMITS.mcp.limit) };
  if (ctx.tokenState === 'present' && ctx.token) {
    const member = await verifyApiToken(`Bearer ${ctx.token}`, 'claude_code');
    if (member) return { ok: true, member };
  }
  // verifyApiToken returns null for a bad token and for a database that didn't answer: tell them apart.
  const health = await getHealth();
  if (health.db === 'down') return { ok: false, text: ERRORS.dbDown() };
  return { ok: false, text: ERRORS.tokenRejected() };
}

/** The member when a valid token came with an open call (to own a draft), else null. Never an error. */
export async function optionalMember(ctx: McpRequestContext): Promise<MemberRef | null> {
  if (ctx.tokenState !== 'present' || !ctx.token || !apiTokensConfigured()) return null;
  return verifyApiToken(`Bearer ${ctx.token}`, 'claude_code');
}
