import { crossOrigin, isSameOrigin, jsonNoStore } from '@/lib/http';
import { NOTHING_SENT } from '@/lib/oti/copy';
import { fmtClock, NETWORK_TZ, zoneAbbr } from '@/lib/oti/time';
import { sessionRefusal } from '@/lib/server/asks';
import { answerQuestion } from '@/lib/server/questions';
import { checkRateLimit, clientKey } from '@/lib/server/ratelimit';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks/[id]/answer — `{question_id, answer, idempotency_key}` → AnswerQuestionResult.
 * The answer goes only to the gates that asked, and each reruns once (live gate calls, so it counts against the send
 * limit). 200 ok · 400 bad_input · 401 · 404 not_found · 409 already_answered · 429 rate_limited ·
 * 503 not_configured | db_down | live_unavailable (nothing saved: answer again later).
 */
export const runtime = 'nodejs';
// The reruns run before answering (6 s per gate); what they cause (an offer email, a queued ask) runs after it.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  not_found: 'This question isn’t on an ask of yours.',
  already_answered: 'You already answered this question. Each gate reruns once.',
  bad_input: 'Your answer needs 1 to 280 characters.',
  not_configured: 'The real network isn’t set up on this instance.',
  db_down: `Something broke on our side. ${NOTHING_SENT}`,
  live_unavailable: `Live checks are paused, so the gates can’t rerun yet. Your answer wasn’t saved; send it again later. ${NOTHING_SENT}`,
};

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return crossOrigin();
  const { id } = await ctx.params;
  const who = await getUser();
  if (!who.ok) {
    const refusal = sessionRefusal(who.reason);
    return jsonNoStore(refusal.body, refusal.status);
  }
  type Body = { question_id?: unknown; answer?: unknown; idempotency_key?: unknown };
  let body: Body | null = null;
  try {
    body = (await request.json()) as Body;
  } catch {
    body = null;
  }
  if (!body || typeof body.question_id !== 'string' || typeof body.answer !== 'string' || typeof body.idempotency_key !== 'string') {
    return jsonNoStore({ error: 'bad_input', message: 'Send {question_id, answer, idempotency_key}.' }, 400);
  }
  const limit = await checkRateLimit(clientKey(request), 'send');
  if (!limit.ok) {
    const at = Date.parse(limit.retry_at);
    return jsonNoStore(
      { error: 'rate_limited', retry_at: limit.retry_at, message: `Too many live checks from your network. Try again at ${fmtClock(at, NETWORK_TZ)} ${zoneAbbr(at, NETWORK_TZ)}. ${NOTHING_SENT}` },
      429,
    );
  }
  const res = await answerQuestion({ ask_id: id, question_id: body.question_id, answer: body.answer, user: who.user, idempotency_key: body.idempotency_key });
  if (res.ok) return jsonNoStore(res);
  const status = { not_found: 404, already_answered: 409, bad_input: 400 }[res.reason as string] ?? 503;
  return jsonNoStore({ error: res.reason, message: MESSAGES[res.reason] }, status);
}
