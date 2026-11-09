import { hookPayload } from '@/lib/mcp/hook';

/**
 * S6 · GET /api/hook: what the plugin's SessionStart hook prints. 200 with `{systemMessage, hookSpecificOutput}`
 * when something waits on the member behind the bearer token; 204 (the hook prints nothing) when nothing does,
 * the token is missing or invalid, or anything fails. Answers within 1.5 s; the hook gives up at 2 s.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const silent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  try {
    const payload = await hookPayload(request.headers.get('authorization'));
    if (!payload) return silent();
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch {
    return silent();
  }
}
