import 'server-only';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { parseBearer } from '@/lib/server/api-tokens';
import { clientKey } from '@/lib/server/ratelimit';

/**
 * Per-request context for the MCP tools. mcp-handler builds a fresh, stateless server per request and passes
 * `request.auth` through to every handler as `ctx.http.authInfo`; the /mcp route stores what the tools need there:
 * the bearer token as sent (verified only by the tools that need a member, so open tools never touch the database)
 * and the rate-limit key (an HMAC of the address, never the address).
 *
 * The route never answers 401: a missing or bad token is a tool result with the next step, so Claude Code never
 * starts an OAuth flow against /mcp.
 */

export const MCP_CLIENT_ID = 'ok-to-intro-mcp';

export type TokenState = 'none' | 'present' | 'malformed';

export interface McpRequestContext {
  /** The token as sent (`oti_…`), or null. */
  token: string | null;
  /** none: no header, an empty value, or the plugin's unset `${user_config.token}`; malformed: something else. */
  tokenState: TokenState;
  clientKey: string | null;
}

/** What the route puts on `request.auth` (mcp-handler's per-request carrier). */
export function authInfoFor(request: Request): AuthInfo {
  const header = request.headers.get('authorization');
  const token = parseBearer(header);
  const raw = (header ?? '').replace(/^Bearer\s*/i, '').trim();
  const tokenState: TokenState = token ? 'present' : !raw || /^\$\{[^}]*\}$/.test(raw) ? 'none' : 'malformed';
  const context: McpRequestContext = { token, tokenState, clientKey: clientKey(request) };
  return { token: token ?? '', clientId: MCP_CLIENT_ID, scopes: [], extra: { okToIntro: context } };
}

/** The context a tool handler sees (a safe default when a test calls a handler without one). */
export function contextOf(authInfo: AuthInfo | undefined): McpRequestContext {
  const ctx = (authInfo?.extra as { okToIntro?: McpRequestContext } | undefined)?.okToIntro;
  return ctx ?? { token: null, tokenState: 'none', clientKey: null };
}
