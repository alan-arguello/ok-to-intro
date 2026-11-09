import { startCompile } from '@/lib/server/compiler';
import { clientKey } from '@/lib/server/ratelimit';
import { sseFromIterable } from '@/lib/sse';
import type { CompileRequest } from '@/lib/types';

/**
 * Owner: BE1. POST /api/compile — the 5-part compiler as SSE (ux-spec S2).
 * Body: CompileRequest `{text, network}`. Before streaming: 400 `{error:'invalid_text'}`, 429 `{error:'rate_limited',
 * retry_at}`, 503 `{error:'live_unavailable', live, until}`. Then plan → part × 5 → done (or refused, or error).
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const raw = (body ?? {}) as Partial<CompileRequest>;
  if (typeof raw.text !== 'string') {
    return Response.json({ error: 'invalid_text', message: 'Send JSON: {"text": "…", "network": "sample"}.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const start = await startCompile({ text: raw.text, network: raw.network === 'real' ? 'real' : 'sample' }, { clientKey: clientKey(request), signal: request.signal });
  if (!start.ok) return Response.json(start.body, { status: start.status, headers: { 'Cache-Control': 'no-store' } });
  return sseFromIterable(request, () => start.events);
}
