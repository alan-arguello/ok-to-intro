import 'server-only';
import { hex4 } from '@/lib/oti/text';
import type { SampleSendView } from '@/lib/receipts';
import { SAMPLE_NETWORK_ASKS, sampleNetworkAskById } from '@/lib/sample/network';
import type { SampleNetworkAsk } from '@/lib/sample/types';
import { canonicalSampleAsk } from '@/lib/server/dispatch';
import type { CompiledAsk, FanoutCellEventSample, FanoutEvent, QuestionType, SampleNetworkAskId } from '@/lib/types';
import { PART_KEYS } from '@/lib/types';

/**
 * SAMPLE sends from Claude Code (send_ask without a token, `you: null`): which sample ask a draft's text is, how a
 * fan-out stream reads as a receipt, and what answer_question needs afterwards (the ask as sent and the question's
 * type). Nothing here is persisted beyond the draft row and an hour of memory, like BE2's own SAMPLE state.
 */

const QUESTION_TYPES: readonly QuestionType[] = ['price', 'deal_size', 'buyer_count', 'stage', 'region', 'timeline', 'role', 'metric'];

/** The sample ask whose recorded results apply to this text (one of its three variants), or null. */
export function canonicalSampleId(text: string): SampleNetworkAskId | null {
  for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) if (canonicalSampleAsk(sa.id, text)) return sa.id;
  return null;
}

/** BE2's SAMPLE question ids are `q_` + hex4(`<ask id>:<type>`): the type back from an id, or null. */
export function questionTypeFor(askId: string, questionId: string): QuestionType | null {
  return QUESTION_TYPES.find((t) => `q_${hex4(`${askId}:${t}`)}` === questionId) ?? null;
}

/** The complete sample ask as a CompiledAsk (when a canonical sample id is answered without a send on this server). */
export function sampleCompiled(sa: SampleNetworkAsk): CompiledAsk {
  const parts = { challenge: '', tried: '', needs: '', by: '', offers: '' };
  for (const k of PART_KEYS) {
    const p = sa.compiledPartial.find((x) => x.key === k);
    parts[k] = p ? (p.state === 'missing' ? (p.sample ?? '') : p.text) : '';
  }
  return { parts, subject: sa.subject, text: sa.complete, price: null, topic: null };
}

/* ---------- an hour of memory per instance (like BE2's custom SAMPLE asks) ---------- */

interface Remembered {
  at: number;
  compiled: CompiledAsk;
  questions: { qid: string; type: QuestionType; text: string }[];
}
const sent = new Map<string, Remembered>();
const TTL_MS = 3_600_000;

export function rememberSampleSend(id: string, compiled: CompiledAsk, questions: Remembered['questions']): void {
  const now = Date.now();
  for (const [k, v] of sent) if (now - v.at > TTL_MS) sent.delete(k);
  while (sent.size >= 500) sent.delete(sent.keys().next().value as string);
  sent.set(id, { at: now, compiled, questions });
}

export function recallSampleSend(id: string): Remembered | null {
  const r = sent.get(id);
  return r && Date.now() - r.at <= TTL_MS ? r : null;
}

/** The question text for a sample ask's question type, from memory or the hand-written sample data. */
export function sampleQuestionText(id: string, type: QuestionType): string {
  const remembered = recallSampleSend(id)?.questions.find((q) => q.type === type)?.text;
  if (remembered) return remembered;
  const sa = sampleNetworkAskById(id);
  const fromSample = sa?.ask_back.find(([, q]) => q.type === type)?.[1].text ?? (sa?.youAskBack?.type === type ? sa.youAskBack.text : null);
  return fromSample ?? '';
}

/* ---------- a SAMPLE fan-out stream as a receipt ---------- */

/** Reads the events of startSampleSend into the receipt's view. */
export function sampleSendView(events: readonly FanoutEvent[], wallMs: number): SampleSendView & { cells: FanoutCellEventSample[] } {
  let id = '';
  let total = 40;
  let sampleSource: 'model' | 'authored' | 'live' = 'live';
  let recordedAt: string | null = null;
  let offer: { expires_at: string } | null = null;
  let failedClosed = false;
  const cells: FanoutCellEventSample[] = [];
  const questions: SampleSendView['question_list'][number][] = [];
  for (const e of events) {
    if (e.event === 'plan') {
      id = e.data.ask_id;
      total = e.data.total;
      sampleSource = e.data.sample_source ?? 'live';
      recordedAt = e.data.recorded_at ?? null;
    } else if (e.event === 'cell') cells.push(e.data as FanoutCellEventSample);
    else if (e.event === 'question') questions.push({ qid: e.data.qid, type: e.data.type, text: e.data.text, gates: e.data.gates });
    else if (e.event === 'offer') offer = { expires_at: e.data.expires_at };
    else if (e.event === 'done') failedClosed = e.data.failed_closed;
  }
  const ranLive = cells.filter((c) => c.state !== 'na' && c.source !== 'authored');
  const fortieth = cells.find((c) => c.you) ? 'live' : 'example';
  const members: SampleSendView['members'] = sampleSource === 'authored' ? 'authored' : sampleSource === 'model' ? 'recorded' : 'live';
  return {
    id,
    total,
    accepted: cells.filter((c) => c.state === 'accept').length,
    questions: cells.filter((c) => c.state === 'ask_back').length,
    declined: cells.filter((c) => c.state === 'decline').length,
    at_cap: cells.filter((c) => c.state === 'na' && c.na === 'at_cap').length,
    paused: cells.filter((c) => c.state === 'na' && c.na === 'paused').length,
    failed: cells.filter((c) => c.state === 'failed').length,
    ran: ranLive.length,
    members,
    fortieth,
    recorded_at: recordedAt,
    offer,
    failed_closed: failedClosed,
    question_list: questions,
    wall_ms: members === 'authored' && ranLive.length === 0 ? null : wallMs,
    cells,
  };
}
