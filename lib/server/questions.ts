import 'server-only';
import type { AskerQuestion, MemberRef } from '@/lib/types';

/**
 * Owner: BE2. ask_back: the asker answers a gate's one question; the answer goes only to the gates that asked,
 * and each reruns once (gate_decisions.attempt = 2). “Nobody new was interrupted” unless a rerun accept becomes
 * the best accept while nobody holds the ask.
 *
 * STUB (foundation): signature final. Until BE2 replaces the body every call reports `not_configured`.
 */

export type AnswerQuestionResult =
  | { ok: true; question: AskerQuestion; reran: number; accepted: number; repeated: boolean }
  | { ok: false; reason: 'not_found' | 'already_answered' | 'bad_input' | 'not_configured' | 'db_down' | 'live_unavailable' };

export async function answerQuestion(input: {
  ask_id: string;
  question_id: string;
  /** ≤ 280 characters, approved by the asker. */
  answer: string;
  user: MemberRef;
  idempotency_key: string;
}): Promise<AnswerQuestionResult> {
  void input;
  return { ok: false, reason: 'not_configured' };
}
