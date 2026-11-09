import { jsonNoStore } from '@/lib/http';
import { answerSampleQuestion, type SampleAnswerInput } from '@/lib/server/dispatch';
import { clientKey } from '@/lib/server/ratelimit';

/**
 * Owner: BE2. POST /api/asks/sample/answer — the founder answers a gate's question on a SAMPLE ask; only the gates
 * that asked rerun once (YOUR gate live). Body: SampleAnswerInput. 200 SampleAnswerResult (ok) · 400 · 429 · 503
 * with a FanoutRefusal body. Nothing is persisted, nobody is emailed.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: Partial<SampleAnswerInput> | null = null;
  try {
    body = (await request.json()) as Partial<SampleAnswerInput>;
  } catch {
    body = null;
  }
  if (!body || typeof body.sample_ask_id !== 'string' || typeof body.answer !== 'string' || !body.question || !body.compiled) {
    return jsonNoStore({ error: 'invalid', message: 'Send {sample_ask_id, compiled, you, question, answer}.' }, 400);
  }
  const res = await answerSampleQuestion(
    { sample_ask_id: body.sample_ask_id, compiled: body.compiled, you: body.you ?? null, question: body.question, answer: body.answer },
    { clientKey: clientKey(request), signal: request.signal },
  );
  if (res.ok) return jsonNoStore(res);
  return jsonNoStore(res.body, res.status);
}
