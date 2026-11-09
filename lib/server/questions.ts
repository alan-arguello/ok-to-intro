import 'server-only';
import { isRealAskId } from '@/lib/oti/ids';
import { ANSWER_MAX } from '@/lib/oti/text';
import type { AskerQuestion, CompiledAsk, MemberRef, QuestionType } from '@/lib/types';
import { networkConfigured, rpc } from './audit';
import { decisionFromGate, gate, IN_FLIGHT, pool, recordDecision } from './dispatch';
import { canRunLive, getLiveState } from './live';
import { afterAdvance, completeAdvance, mintSlots, type AdvanceResult } from './offers';

/**
 * Owner: BE2. ask_back: the asker answers a gate's one question; the answer goes only to the gates that asked,
 * and each reruns once (gate_decisions.attempt = 2). “Nobody new was interrupted” unless a rerun accept becomes
 * the best accept while nobody holds the ask. A price answer becomes the card's Price fact for the gates that asked.
 */

export type AnswerQuestionResult =
  | { ok: true; question: AskerQuestion; reran: number; accepted: number; repeated: boolean }
  | { ok: false; reason: 'not_found' | 'already_answered' | 'bad_input' | 'not_configured' | 'db_down' | 'live_unavailable' };

const QUESTION_ID = /^q_[0-9A-Za-z]{3,16}$/;

interface QuestionRow {
  id: string;
  type: QuestionType;
  text: string;
  gates: number;
  answer: string | null;
  answered_at: string | null;
}

function toAskerQuestion(q: QuestionRow): AskerQuestion {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    gates: Number(q.gates) || 1,
    answer: q.answer,
    answered_at: q.answered_at ? new Date(Date.parse(q.answered_at)).toISOString() : null,
  };
}

export async function answerQuestion(input: {
  ask_id: string;
  question_id: string;
  /** ≤ 280 characters, approved by the asker. */
  answer: string;
  user: MemberRef;
  idempotency_key: string;
}): Promise<AnswerQuestionResult> {
  if (!networkConfigured()) return { ok: false, reason: 'not_configured' };
  const answer = typeof input?.answer === 'string' ? input.answer.replace(/\s+/g, ' ').trim() : '';
  if (!isRealAskId(String(input?.ask_id ?? '')) || !QUESTION_ID.test(String(input?.question_id ?? ''))) return { ok: false, reason: 'not_found' };
  if (!answer || answer.length > ANSWER_MAX) return { ok: false, reason: 'bad_input' };
  // The answer reruns live gates: when they can't run, nothing is saved, so the asker can answer again later.
  const live = await getLiveState();
  if (!canRunLive(live)) return { ok: false, reason: 'live_unavailable' };

  const now = new Date();
  const res = await rpc<{
    ok: boolean;
    reason?: 'not_found' | 'already_answered';
    repeated?: boolean;
    question?: QuestionRow;
    compiled?: CompiledAsk;
    asker_stage?: string | null;
    gates?: { member_id: string; rules: string; rules_version: number }[];
  }>('net_answer_question', { p_ask: input.ask_id, p_asker: input.user.id, p_question: input.question_id, p_answer: answer, p_now: now.toISOString() });
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const d = res.data;
  if (!d?.ok || !d.question) return { ok: false, reason: d?.reason === 'already_answered' ? 'already_answered' : 'not_found' };

  if (d.repeated) {
    const counts = await rpc<{ reran: number; accepted: number }>('net_rerun_counts', { p_ask: input.ask_id, p_question: input.question_id });
    return {
      ok: true,
      question: toAskerQuestion(d.question),
      reran: counts.ok ? Number(counts.data?.reran) || 0 : 0,
      accepted: counts.ok ? Number(counts.data?.accepted) || 0 : 0,
      repeated: true,
    };
  }

  // Each gate that asked reruns once with the answer, and its decision is saved before anything moves.
  const compiled = d.compiled as CompiledAsk;
  const ask = { text: compiled.text, subject: compiled.subject, parts: compiled.parts, ...(d.asker_stage ? { asker_stage: d.asker_stage } : {}) };
  const answers = [{ type: d.question.type, text: answer }];
  const verdicts = await pool(d.gates ?? [], IN_FLIGHT, async (g) => {
    const decision = decisionFromGate(await gate({ rules: g.rules, ask, answers }), 2);
    const saved = await recordDecision(input.ask_id, g.member_id, 2, g.rules_version, decision, new Date());
    return saved ? decision.verdict : null;
  });
  const accepted = verdicts.filter((v) => v === 'accept').length;

  // If nobody holds the ask, a rerun accept may now be the best accept (or the ask settles).
  const adv = await rpc<AdvanceResult>('net_advance', { p_ask: input.ask_id, p_now: new Date().toISOString(), p_slots: mintSlots(accepted + 2) });
  if (adv.ok) await afterAdvance(await completeAdvance(input.ask_id, adv.data, now), now);

  return { ok: true, question: toAskerQuestion(d.question), reran: verdicts.length, accepted, repeated: false };
}
