import { crossOrigin, isSameOrigin, jsonNoStore } from '@/lib/http';
import { NOTHING_SENT } from '@/lib/oti/copy';
import { resolveAsk, sessionRefusal } from '@/lib/server/asks';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks/[id]/resolve — after a 2-line answer: `{solved: boolean, idempotency_key}`
 * (“Yes, close my ask” / “No, keep it open”). 200 `{ok:true, outcome}` (a repeat answers the same) · 401 · 404 ·
 * 409 `not_answered` (no answer the asker can see yet) · 503.
 */
export const runtime = 'nodejs';
// “No, keep it open” moves the ask on (the next offer email, or a queued ask's fan-out, run after the response).
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
  let body: { solved?: unknown; idempotency_key?: unknown } | null = null;
  try {
    body = (await request.json()) as { solved?: unknown; idempotency_key?: unknown };
  } catch {
    body = null;
  }
  if (!body || typeof body.solved !== 'boolean' || typeof body.idempotency_key !== 'string' || !body.idempotency_key.trim()) {
    return jsonNoStore({ error: 'bad_input', message: 'Send {solved, idempotency_key}.' }, 400);
  }
  const res = await resolveAsk(id, who.user, body.solved);
  if (res.ok) return jsonNoStore({ ok: true, outcome: res.outcome, repeated: res.repeated });
  if (res.reason === 'not_found') return jsonNoStore({ error: 'not_found' }, 404);
  if (res.reason === 'not_answered') return jsonNoStore({ error: 'not_answered', message: 'There is no answer to resolve on this ask.' }, 409);
  return jsonNoStore(
    { error: res.reason, message: res.reason === 'not_configured' ? 'The real network isn’t set up on this instance.' : `Something broke on our side. ${NOTHING_SENT}` },
    503,
  );
}
