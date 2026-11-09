import { answerQuestion } from '@/lib/server/questions';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks/[id]/answer — `{question_id, answer, idempotency_key}` → AnswerQuestionResult.
 * 200 ok · 400 bad_input · 401 · 404 not_found · 409 already_answered · 503 not_configured | db_down | live_unavailable.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await getUser();
  if (!who.ok) return Response.json({ error: who.reason }, { status: who.reason === 'signed_out' ? 401 : 503, headers: NO_STORE });
  type Body = { question_id?: unknown; answer?: unknown; idempotency_key?: unknown };
  let body: Body | null = null;
  try {
    body = (await request.json()) as Body;
  } catch {
    body = null;
  }
  if (!body || typeof body.question_id !== 'string' || typeof body.answer !== 'string' || typeof body.idempotency_key !== 'string') {
    return Response.json({ error: 'bad_input' }, { status: 400, headers: NO_STORE });
  }
  const res = await answerQuestion({ ask_id: id, question_id: body.question_id, answer: body.answer, user: who.user, idempotency_key: body.idempotency_key });
  if (res.ok) return Response.json(res, { headers: NO_STORE });
  const status = { not_found: 404, already_answered: 409, bad_input: 400 }[res.reason as string] ?? 503;
  return Response.json({ error: res.reason }, { status, headers: NO_STORE });
}
