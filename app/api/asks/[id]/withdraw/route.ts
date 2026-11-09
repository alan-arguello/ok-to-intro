import { crossOrigin, isSameOrigin, jsonNoStore } from '@/lib/http';
import { NOTHING_SENT } from '@/lib/oti/copy';
import { sessionRefusal, withdrawAsk } from '@/lib/server/asks';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks/[id]/withdraw — `{idempotency_key}`. The person holding the ask is told it's no
 * longer needed; nobody else is asked. 200 `{ok:true, withdrawn_at}` (a repeat answers the same) · 401 · 404 ·
 * 409 `closed` (an intro was made, or the ask already closed) · 503.
 */
export const runtime = 'nodejs';
// A withdrawal can free room for a queued ask, whose fan-out then runs after the response.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return crossOrigin();
  const { id } = await ctx.params;
  const who = await getUser();
  if (!who.ok) {
    const refusal = sessionRefusal(who.reason);
    return jsonNoStore(refusal.body, refusal.status);
  }
  let body: { idempotency_key?: unknown } | null = null;
  try {
    body = (await request.json()) as { idempotency_key?: unknown };
  } catch {
    body = null;
  }
  if (!body || typeof body.idempotency_key !== 'string' || !body.idempotency_key.trim()) {
    return jsonNoStore({ error: 'bad_input', message: 'Send {idempotency_key}.' }, 400);
  }
  const res = await withdrawAsk(id, who.user);
  if (res.ok) return jsonNoStore({ ok: true, withdrawn_at: res.withdrawn_at, repeated: res.repeated });
  if (res.reason === 'not_found') return jsonNoStore({ error: 'not_found' }, 404);
  if (res.reason === 'closed') return jsonNoStore({ error: 'closed', message: 'This ask is already closed. There is nothing to withdraw.' }, 409);
  return jsonNoStore(
    { error: res.reason, message: res.reason === 'not_configured' ? 'The real network isn’t set up on this instance.' : `Something broke on our side. ${NOTHING_SENT}` },
    503,
  );
}
