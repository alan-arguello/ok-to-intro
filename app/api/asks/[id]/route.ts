import { getAskerView, sessionRefusal } from '@/lib/server/asks';
import { sseResponse } from '@/lib/sse';
import { getUser } from '@/lib/supabase/server';
import type { AskerAskView, AskTailEvent } from '@/lib/types';

/**
 * Owner: BE2. GET /api/asks/[id] — the asker's serialized view (AskerAskView), owner only.
 * 200 view · 401 signed_out · 404 not_found (also for someone else's ask) · 503 not_configured | db_down.
 *
 * With `Accept: text/event-stream` (EventSource) it is the tail of a REAL ask (AskTailEvent): `view` on connect and
 * again whenever anything the asker may see changes (each one replaces the last, so Last-Event-ID needs no replay),
 * then `end`: `settled` once the outcome stops changing on its own (not ready or gating), `timeout` after about
 * 55 s, `not_found`. The client closes its EventSource on `end` and re-reads at `view.next_checkpoint` or on focus.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Accept, Cookie' };
const TAIL_MS = 55_000;
const POLL_MS = 1_500;

const moving = (v: AskerAskView) => v.outcome === 'ready' || v.outcome === 'gating';

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tail = (request.headers.get('accept') ?? '').includes('text/event-stream');
  const who = await getUser();
  if (!who.ok) {
    const refusal = sessionRefusal(who.reason);
    return Response.json(refusal.body, { status: refusal.status, headers: NO_STORE });
  }
  const first = await getAskerView(id, who.user);

  if (!tail) {
    if (first.ok) return Response.json(first.view, { headers: NO_STORE });
    return Response.json({ error: first.reason }, { status: first.reason === 'not_found' ? 404 : 503, headers: NO_STORE });
  }
  if (!first.ok && first.reason !== 'not_found') {
    // EventSource stops for good on a non-200 answer (no reconnect loop while the database is away).
    return Response.json({ error: first.reason }, { status: 503, headers: NO_STORE });
  }

  const user = who.user;
  return sseResponse<AskTailEvent>(
    request,
    async (sink) => {
      if (!first.ok) {
        sink.send({ event: 'end', data: { reason: 'not_found' } });
        return;
      }
      let last = JSON.stringify(first.view);
      sink.send({ event: 'view', data: first.view });
      if (!moving(first.view)) {
        sink.send({ event: 'end', data: { reason: 'settled' } });
        return;
      }
      const stopAt = Date.now() + TAIL_MS;
      while (!sink.closed && Date.now() < stopAt) {
        await wait(POLL_MS, sink.signal);
        if (sink.closed) return;
        const next = await getAskerView(id, user);
        if (!next.ok) {
          if (next.reason === 'not_found') {
            sink.send({ event: 'end', data: { reason: 'not_found' } });
            return;
          }
          continue; // a blip: try again on the next tick
        }
        const json = JSON.stringify(next.view);
        if (json !== last) {
          last = json;
          sink.send({ event: 'view', data: next.view });
        }
        if (!moving(next.view)) {
          sink.send({ event: 'end', data: { reason: 'settled' } });
          return;
        }
      }
      if (!sink.closed) sink.send({ event: 'end', data: { reason: 'timeout' } });
    },
    { headers: { Vary: 'Accept, Cookie' } },
  );
}
