import 'server-only';
import { newToken, publicId } from '@/lib/oti/ids';
import { hashToken } from '@/lib/oti/tokens';
import { recordAudit } from '@/lib/server/audit';
import { getAdminClient, isDbDown } from '@/lib/supabase/admin';
import type { MemberRef } from '@/lib/types';

/**
 * Owner: S3. Claude Code tokens (shown once under “Your gate”; only the HMAC is stored; one active token per
 * member; revocable). The MCP server and the SessionStart hook verify the `Authorization: Bearer …` header here.
 *
 * Format: `oti_` + 22 base64url characters (128 random bits). Stored as HMAC-SHA256(TOKEN_HMAC_SECRET, `api:<token>`)
 * (lib/oti/tokens.ts), so a database leak doesn't leak usable tokens. Without TOKEN_HMAC_SECRET or the service role
 * nothing verifies and /me shows “Claude Code tokens aren’t set up on this instance.”
 */

export const API_TOKEN_PREFIX = 'oti_';
const TOKEN_RE = /^oti_[A-Za-z0-9_-]{22}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** last_used_at is written at most once a minute per token (every MCP call verifies). */
const TOUCH_EVERY_MS = 60_000;
const DB_TIMEOUT_MS = 8_000;

export type TokenUse = 'claude_code' | 'hook';

/** The bare token from “Bearer oti_…” (or a bare token), or null when malformed. Never logs the value. */
export function parseBearer(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const value = authorization.trim();
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  const token = match ? (match[1] as string) : value;
  return TOKEN_RE.test(token) ? token : null;
}

/** True when tokens can be created and verified on this instance (service role + TOKEN_HMAC_SECRET). */
export function apiTokensConfigured(): boolean {
  return getAdminClient().ok && hashToken('api', 'probe') !== null;
}

/**
 * The member a bearer token belongs to, or null (missing, malformed, unknown, revoked, or tokens not configured).
 * Accepts the raw header value (“Bearer abc…”) or the bare token. Updates last_used_at / last_used_from.
 */
export async function verifyApiToken(authorization: string | null, usedFrom: 'claude_code' | 'hook' = 'claude_code'): Promise<MemberRef | null> {
  const token = parseBearer(authorization);
  if (!token) return null;
  const hash = hashToken('api', token);
  if (!hash) return null;
  const admin = getAdminClient();
  if (!admin.ok) return null;
  const db = admin.client;
  try {
    const { data: row, error } = await db
      .from('api_tokens')
      .select('id, member_id, last_used_at, last_used_from')
      .eq('token_hash', hash)
      .is('revoked_at', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (error || !row) return null;
    const { data: member, error: memberError } = await db
      .from('members')
      .select('id, email')
      .eq('id', row.member_id)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (memberError || !member) return null;
    const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
    if (Date.now() - last >= TOUCH_EVERY_MS || row.last_used_from !== usedFrom) {
      // Best effort: a failed touch never fails the request.
      await db
        .from('api_tokens')
        .update({ last_used_at: new Date().toISOString(), last_used_from: usedFrom })
        .eq('id', row.id)
        .is('revoked_at', null)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    }
    return { id: member.id, email: member.email };
  } catch {
    return null;
  }
}

export type ApiTokenStatus =
  | { state: 'none' }
  | { state: 'active'; created_at: string; last_used_at: string | null; last_used_from: TokenUse | null }
  | { state: 'revoked'; revoked_at: string };

export type TokenFailure = { ok: false; reason: 'not_configured' | 'db_down' | 'not_found' };

/** A foreign-key miss means the member row is gone; anything else (unreachable, timeout, unexpected) is our side. */
function failure(error: { message?: string; code?: string } | null | undefined): TokenFailure {
  if (error && !isDbDown(error) && error.code === '23503') return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'db_down' };
}

/** The member's latest token, for the /me panel: none, active (with last use) or revoked. */
export async function getApiTokenStatus(memberId: string): Promise<{ ok: true; status: ApiTokenStatus } | TokenFailure> {
  if (!apiTokensConfigured()) return { ok: false, reason: 'not_configured' };
  if (!UUID_RE.test(memberId)) return { ok: true, status: { state: 'none' } };
  const admin = getAdminClient();
  if (!admin.ok) return { ok: false, reason: 'not_configured' };
  try {
    const { data, error } = await admin.client
      .from('api_tokens')
      .select('created_at, last_used_at, last_used_from, revoked_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) return failure(error);
    const row = data?.[0];
    if (!row) return { ok: true, status: { state: 'none' } };
    if (row.revoked_at) return { ok: true, status: { state: 'revoked', revoked_at: row.revoked_at } };
    const from = row.last_used_from === 'hook' || row.last_used_from === 'claude_code' ? row.last_used_from : null;
    return { ok: true, status: { state: 'active', created_at: row.created_at, last_used_at: row.last_used_at, last_used_from: from } };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

/**
 * Creates the member's token and returns it ONCE (only its HMAC is stored). An active token is revoked first:
 * a member has at most one (public.api_tokens_one_active).
 */
export async function createApiToken(memberId: string): Promise<{ ok: true; token: string; created_at: string } | TokenFailure> {
  if (!apiTokensConfigured()) return { ok: false, reason: 'not_configured' };
  if (!UUID_RE.test(memberId)) return { ok: false, reason: 'not_found' };
  const admin = getAdminClient();
  if (!admin.ok) return { ok: false, reason: 'not_configured' };
  const db = admin.client;
  const token = `${API_TOKEN_PREFIX}${newToken()}`;
  const hash = hashToken('api', token);
  if (!hash) return { ok: false, reason: 'not_configured' };
  try {
    const now = new Date().toISOString();
    const revoked = await db
      .from('api_tokens')
      .update({ revoked_at: now })
      .eq('member_id', memberId)
      .is('revoked_at', null)
      .select('id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (revoked.error) return failure(revoked.error);
    const { data, error } = await db
      .from('api_tokens')
      .insert({ id: publicId('token'), member_id: memberId, token_hash: hash, label: 'Claude Code' })
      .select('created_at')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .single();
    if (error || !data) return failure(error);
    if (revoked.data?.length) await recordAudit('token_revoked', { member_id: memberId, actor_id: memberId, detail: { replaced: true } });
    await recordAudit('token_created', { member_id: memberId, actor_id: memberId });
    return { ok: true, token, created_at: data.created_at };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

/** Revokes the member's active token (a no-op when there is none). */
export async function revokeApiToken(memberId: string): Promise<{ ok: true; revoked_at: string } | TokenFailure> {
  if (!apiTokensConfigured()) return { ok: false, reason: 'not_configured' };
  if (!UUID_RE.test(memberId)) return { ok: false, reason: 'not_found' };
  const admin = getAdminClient();
  if (!admin.ok) return { ok: false, reason: 'not_configured' };
  try {
    const now = new Date().toISOString();
    const { data, error } = await admin.client
      .from('api_tokens')
      .update({ revoked_at: now })
      .eq('member_id', memberId)
      .is('revoked_at', null)
      .select('id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) return failure(error);
    if (data?.length) await recordAudit('token_revoked', { member_id: memberId, actor_id: memberId });
    return { ok: true, revoked_at: now };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}
