import { startSampleSend, type SampleSendInput } from '@/lib/server/dispatch';
import { clientKey } from '@/lib/server/ratelimit';
import { sseFromIterable } from '@/lib/sse';

/**
 * Owner: BE2. POST /api/asks/sample — the SAMPLE fan-out as SSE (nothing persisted, nobody emailed).
 * Body: SampleSendInput `{sample_ask_id, text, compiled, you}`. Before streaming: 400 · 429 · 503 with a
 * FanoutRefusal body. Then plan → cell × 40 (FanoutCellEventSample) → question* → offer? → done.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: Partial<SampleSendInput> | null = null;
  try {
    body = (await request.json()) as Partial<SampleSendInput>;
  } catch {
    body = null;
  }
  if (!body || typeof body.text !== 'string' || !body.compiled) {
    return Response.json({ error: 'invalid', message: 'Send {sample_ask_id, text, compiled, you}.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const start = await startSampleSend(
    { sample_ask_id: body.sample_ask_id ?? null, text: body.text, compiled: body.compiled, you: body.you ?? null },
    { clientKey: clientKey(request), signal: request.signal },
  );
  if (!start.ok) return Response.json(start.body, { status: start.status, headers: { 'Cache-Control': 'no-store' } });
  return sseFromIterable(request, () => start.events);
}
