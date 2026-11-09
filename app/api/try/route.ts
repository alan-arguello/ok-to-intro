import { startTry } from '@/lib/server/gate';
import { clientKey } from '@/lib/server/ratelimit';
import { sseFromIterable } from '@/lib/sse';
import type { TryRequest } from '@/lib/types';

/**
 * Owner: BE1. POST /api/try — the playground's live run as SSE (ux-spec §8).
 * Body: TryRequest `{rules, ask_ids?}`. Before streaming: 400 `{error:'invalid_rules'}`, 429 `{error:'rate_limited',
 * retry_at}`, 503 `{error:'live_unavailable', live, until}`. Then `text/event-stream`: plan → gate|error × n → done.
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
  const raw = (body ?? {}) as Partial<TryRequest>;
  if (typeof raw.rules !== 'string') {
    return Response.json({ error: 'invalid_rules', message: 'Send JSON: {"rules": "…"}.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const start = await startTry({ rules: raw.rules, ask_ids: Array.isArray(raw.ask_ids) ? raw.ask_ids : undefined }, { clientKey: clientKey(request), signal: request.signal });
  if (!start.ok) return Response.json(start.body, { status: start.status, headers: { 'Cache-Control': 'no-store' } });
  return sseFromIterable(request, () => start.events);
}
