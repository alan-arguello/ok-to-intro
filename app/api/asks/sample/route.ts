import { jsonNoStore } from '@/lib/http';
import { startSampleSendWith, type SampleSendInput } from '@/lib/server/dispatch';
import { clientKey } from '@/lib/server/ratelimit';
import { sseFromIterable } from '@/lib/sse';

/**
 * Owner: BE2. POST /api/asks/sample — the SAMPLE fan-out as SSE (nothing persisted, nobody emailed).
 * Body: SampleSendInput `{sample_ask_id, text, compiled, you}`. Before streaming: 400 · 429 · 503 with a
 * FanoutRefusal body. Then plan → cell × 40 (FanoutCellEventSample) → question* → offer? → done.
 * `?replay=0` renders a recorded (model) file at once instead of at its recorded speed (reduced motion); an
 * authored file always renders at once.
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
  if (!body || typeof body.text !== 'string' || !body.compiled || typeof body.compiled !== 'object') {
    return jsonNoStore({ error: 'invalid', message: 'Send {sample_ask_id, text, compiled, you}.' }, 400);
  }
  const replay = new URL(request.url).searchParams.get('replay') !== '0';
  const start = await startSampleSendWith(
    { sample_ask_id: body.sample_ask_id ?? null, text: body.text, compiled: body.compiled, you: body.you ?? null },
    { clientKey: clientKey(request), signal: request.signal },
    { replay },
  );
  if (!start.ok) return jsonNoStore(start.body, start.status);
  return sseFromIterable(request, () => start.events);
}
