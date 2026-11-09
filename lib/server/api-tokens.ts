import 'server-only';
import type { MemberRef } from '@/lib/types';

/**
 * Owner: S3. Claude Code tokens (shown once under “Your gate”; only the HMAC is stored; one active token per
 * member; revocable). The MCP server and the SessionStart hook verify the `Authorization: Bearer …` header here.
 *
 * STUB (foundation): signature final. Until S3 replaces the body no token verifies.
 */

/**
 * The member a bearer token belongs to, or null (missing, malformed, unknown, revoked, or tokens not configured).
 * Accepts the raw header value (“Bearer abc…”) or the bare token. Updates last_used_at / last_used_from.
 */
export async function verifyApiToken(authorization: string | null, usedFrom: 'claude_code' | 'hook' = 'claude_code'): Promise<MemberRef | null> {
  void authorization;
  void usedFrom;
  return null;
}
