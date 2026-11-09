import { createMcpHandler } from 'mcp-handler';
import { authInfoFor } from '@/lib/mcp/context';
import { registerTools, SERVER_INSTRUCTIONS, SERVER_VERSION } from '@/lib/mcp/server';
import { MCP_SERVER_ID } from '@/lib/site';

/**
 * S6 · `/mcp`: the OK to Intro MCP server (Streamable HTTP, stateless, mcp-handler 2.x). Open tools: try_rules and
 * draft_ask; send_ask and answer_question also run without a token on the SAMPLE network; the rest need
 * `Authorization: Bearer <token>` (the token a member creates under Your gate; the plugin sends it from the keychain).
 * GET and DELETE answer 405 (no sessions). Never 401: token problems are tool results with the next step.
 * Nothing logs request bodies or tokens (no onEvent, no verbose logs).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: MCP_SERVER_ID, version: SERVER_VERSION },
  instructions: SERVER_INSTRUCTIONS,
});

async function serve(request: Request): Promise<Response> {
  // mcp-handler hands `request.auth` to every tool as ctx.http.authInfo (the token as sent, the rate-limit key).
  request.auth = authInfoFor(request);
  const response = await handler(request);
  try {
    response.headers.set('Cache-Control', 'no-store');
  } catch {
    // An immutable Response (never expected from the SDK): serve it as is.
  }
  return response;
}

export { serve as DELETE, serve as GET, serve as POST };
