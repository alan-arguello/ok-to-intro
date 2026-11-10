import 'server-only';
import { after } from 'next/server';
import { validateAsk } from '@/lib/oti/ask';
import { findClause } from '@/lib/oti/clause';
import { fillCopy, NOTHING_SENT } from '@/lib/oti/copy';
import { isRealAskId, isSampleAskId, publicId } from '@/lib/oti/ids';
import { ANSWER_MAX, hash32, hex4, RULES_MAX, shuffled } from '@/lib/oti/text';
import { fmtClock, fmtDay, NETWORK_TZ, OFFER_WINDOW_MS, toMs, zoneAbbr } from '@/lib/oti/time';
import { sampleNetworkRun, type RecordedMemberGate } from '@/lib/recorded';
import { isSampleNetworkAskId, memberCitation, SAMPLE_MEMBERS, sampleNetworkAskById } from '@/lib/sample/network';
import type { SampleMember, SampleNetworkAsk } from '@/lib/sample/types';
import { detachedEvents } from '@/lib/sse';
import type {
  AskerCellState,
  CitedQuote,
  CompiledAsk,
  DecidedBy,
  FanoutCellEventSample,
  FanoutDoneEvent,
  FanoutEvent,
  FanoutOfferEvent,
  GateDecision,
  GateFailureKind,
  GateFlag,
  GateQuestion,
  LiveState,
  MemberRef,
  QuestionType,
  ReasonCode,
  SampleNetworkAskId,
  Verdict,
} from '@/lib/types';
import { networkConfigured, recordAudit, rpc, type RpcResult } from './audit';
import { runGate, type GateInput, type GateResult } from './gate';
import { canRunLive, getLiveState, type LiveSnapshot } from './live';
import { afterAdvance, completeAdvance, mintSlots, type AdvanceResult } from './offers';
import { checkRateLimit } from './ratelimit';

/**
 * Owner: BE2. The fan-out: SQL prefilter (public.prefilter_members) → gates in parallel (BE1 runGate, at most 16
 * in flight, each decision persisted before it streams) → reserve_slot / create_offer for the best accept (the
 * member with the most unused cap this month, then the earliest answer) → offer email. Fails closed: if more than
 * 1 in 5 gates fail, nothing is offered.
 *
 * REAL sends run detached from the request (lib/sse `detachedEvents` + next/server `after`): every decision is
 * persisted and the offer is made even if the asker closes the tab, and the daily cron finishes a send whose function
 * died. The stream an asker sees is serialized: cells are only offered | next | question | nothistime, and every
 * nothistime cell (declines, failures and SQL skips alike) is emitted together after the last gate, so the timing of
 * instant results can't reveal how many members were at their cap or paused (docs/CONTRACT.md §d.10).
 *
 * SAMPLE sends persist nothing and email nobody: 39 fictional members from data/recorded/sample-network.json
 * (labelled by its source) plus the visitor's own gate, live.
 */

/** Gates in flight at once (ux-spec §8: “up to 40 gates, 16 in flight”). */
export const IN_FLIGHT = 16;

export type FanoutRefusal = {
  error: 'invalid' | 'not_configured' | 'not_allowed' | 'not_found' | 'queued' | 'already_sent' | 'rate_limited' | 'live_unavailable';
  message: string;
  retry_at?: string;
  live?: LiveState;
  ask_id?: string;
};

export type FanoutStart =
  | { ok: true; ask_id: string; events: AsyncIterable<FanoutEvent> }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 503; body: FanoutRefusal };

/* ========================================================================== *
 * Shared pieces: the pool, gate results as stored decisions, refusal copy
 * ========================================================================== */

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, worker));
  return results;
}

const QUESTION_TYPES: readonly QuestionType[] = ['price', 'deal_size', 'buyer_count', 'stage', 'region', 'timeline', 'role', 'metric'];
const FLAGS: readonly GateFlag[] = ['instruction_in_ask', 'asker_not_founder'];

/** The 8 types, ≤ 100 characters, no URL or email (the same rule the questions table enforces). */
export function validQuestion(q: GateQuestion | null | undefined): q is GateQuestion {
  if (!q || !QUESTION_TYPES.includes(q.type)) return false;
  const text = String(q.text ?? '').trim();
  return text.length >= 1 && text.length <= 100 && !/(https?:\/\/|www\.|[^\s@]+@[^\s@]+\.)/i.test(text);
}

/** A decision as public.net_record_decision stores it (null verdict = not checked). */
export interface StoredDecision {
  verdict: Verdict | null;
  model_verdict: Verdict | null;
  cited: CitedQuote[];
  decided_by: DecidedBy | null;
  clause_verified: boolean;
  reason_code: ReasonCode | null;
  reason: string | null;
  question: GateQuestion | null;
  flags: GateFlag[];
  confidence: number | null;
  error_kind: GateFailureKind | null;
  latency_ms: number | null;
  model: string | null;
  request_id: string | null;
  cost_usd: number | null;
}

/**
 * One gate result as the network records it. Code has the last word, whatever the gate returned: an accept must be
 * backed by quotes code found in the member's rules (else a decline by the clause check); a question must be one of
 * the 8 types without links, and a rerun can't ask again (both become declines); a failure is not checked, never
 * an accept; a refusal or unparseable output is a decline by code.
 */
export function decisionFromGate(res: GateResult, attempt: 1 | 2): StoredDecision {
  const base = { confidence: null, latency_ms: Math.max(0, Math.round(res.ms || 0)) || null, model: null, request_id: null, cost_usd: null };
  if (!res.ok) {
    if ((res.kind === 'refused' || res.kind === 'parse') && res.decision) {
      return fromDecision(res.decision, attempt, { ...base, error_kind: res.kind, request_id: res.request_id ?? null }, true);
    }
    if (res.kind === 'refused' || res.kind === 'parse') {
      return {
        ...base,
        verdict: 'decline',
        model_verdict: null,
        cited: [],
        decided_by: null,
        clause_verified: false,
        reason_code: 'no_rule',
        reason: res.kind === 'refused' ? 'The model refused to evaluate this ask.' : 'The gate’s answer didn’t parse, so code declined it.',
        question: null,
        flags: [],
        error_kind: res.kind,
        request_id: res.request_id ?? null,
      };
    }
    return {
      ...base,
      verdict: null,
      model_verdict: null,
      cited: [],
      decided_by: null,
      clause_verified: false,
      reason_code: null,
      reason: null,
      question: null,
      flags: [],
      error_kind: res.kind,
      request_id: res.request_id ?? null,
    };
  }
  return fromDecision(res.decision, attempt, {
    ...base,
    error_kind: null,
    confidence: typeof res.decision.confidence === 'number' ? res.decision.confidence : null,
    model: res.model,
    request_id: res.request_id,
    cost_usd: res.cost_usd,
  }, false);
}

function fromDecision(
  d: GateDecision,
  attempt: 1 | 2,
  meta: Pick<StoredDecision, 'confidence' | 'latency_ms' | 'model' | 'request_id' | 'cost_usd' | 'error_kind'>,
  codeDecline: boolean,
): StoredDecision {
  const cited = Array.isArray(d.cited) ? d.cited.map((c) => ({ text: String(c.text ?? ''), found: !!c.found, ...(c.found ? { start: c.start, end: c.end } : {}) })) : [];
  const allFound = cited.length > 0 && cited.every((c) => c.found && typeof c.start === 'number' && typeof c.end === 'number');
  let verdict: Verdict = codeDecline ? 'decline' : d.verdict;
  let decided_by: DecidedBy = d.decided_by === 'clause_check' ? 'clause_check' : 'gate';
  let question: GateQuestion | null = d.question ?? null;
  let reason_code: ReasonCode = d.reason_code;
  if (verdict === 'accept' && !allFound) {
    verdict = 'decline';
    decided_by = 'clause_check';
  }
  if (verdict === 'ask_back' && (attempt === 2 || !validQuestion(question))) {
    verdict = 'decline';
    if (reason_code === 'match') reason_code = 'no_rule';
  }
  if (verdict !== 'ask_back') question = null;
  if (verdict === 'decline' && reason_code === 'match') reason_code = 'no_rule';
  return {
    ...meta,
    verdict,
    model_verdict: d.model_verdict ?? d.verdict,
    cited,
    decided_by,
    clause_verified: verdict === 'accept' && allFound,
    reason_code,
    reason: typeof d.reason === 'string' ? d.reason.slice(0, 500) : null,
    question: question ? { type: question.type, text: String(question.text ?? '').trim() } : null,
    flags: (d.flags ?? []).filter((f): f is GateFlag => FLAGS.includes(f)),
  };
}

/** runGate, with one more guard: it never throws (BE1 promises it), and if it ever did, the gate is not checked. */
export async function gate(input: GateInput, options: { signal?: AbortSignal } = {}): Promise<GateResult> {
  const started = Date.now();
  try {
    return await runGate(input, options);
  } catch {
    return { ok: false, kind: 'unavailable', ms: Date.now() - started };
  }
}

const atClock = (iso: string) => `${fmtClock(toMs(iso), NETWORK_TZ)} ${zoneAbbr(toMs(iso), NETWORK_TZ)}`;

/** The refusal when live gate calls can't run (never described as an outage when it is a missing key). */
function liveRefusal(live: LiveSnapshot, saved: boolean): FanoutRefusal {
  const tail = saved ? `${NOTHING_SENT} Your ask is saved.` : NOTHING_SENT;
  const message =
    live.state === 'off'
      ? `Live checks are off on this instance: no model API key is set. ${tail}`
      : live.state === 'budget'
        ? `${fillCopy('Live checks are paused until {date}: this demo reached its model budget.', { date: live.paused_until ? fmtDay(toMs(live.paused_until), NETWORK_TZ) : 'tomorrow' })} ${tail}`
        : `Live checks are paused: the model API isn’t answering. ${tail}`;
  return { error: 'live_unavailable', message, live: live.state, ...(live.paused_until ? { retry_at: live.paused_until } : {}) };
}

function rateRefusal(retryAt: string, what: 'send' | 'sample'): FanoutRefusal {
  return {
    error: 'rate_limited',
    retry_at: retryAt,
    message:
      what === 'send'
        ? `You sent 20 asks in 10 minutes. The next send is at ${atClock(retryAt)}. ${NOTHING_SENT} Your ask is saved.`
        : `You ran 20 live checks in 10 minutes. The next live run is at ${atClock(retryAt)}. ${NOTHING_SENT}`,
  };
}

/** Keeps a REAL send alive after the response (Vercel), or lets the caller await it outside a request. */
function keepAlive(done: Promise<void>): void {
  try {
    after(() => done);
  } catch {
    // Outside a request scope (scripts, tests): the caller awaits `done` itself.
  }
}

/* ========================================================================== *
 * REAL: the persisted fan-out
 * ========================================================================== */

interface GateRow {
  member_id: string;
  position: number;
  rules: string;
  rules_version: number;
}

interface BeginSend {
  ok: true;
  network_size: number;
  sent_at: string;
  compiled: CompiledAsk;
  asker_stage: string | null;
  gates: GateRow[];
  skipped: number[];
}

type FinishResult = Omit<AdvanceResult, 'outcome'> & {
  outcome: AdvanceResult['outcome'] | 'failed' | 'not_gating';
  gates_ran?: number;
  gates_failed?: number;
  status?: string;
  questions?: { id: string; type: QuestionType; text: string; gates: number }[];
};

/** One retry after a short wait for a transient failure (never for a missing configuration). */
async function rpcRetry<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const first = await rpc<T>(fn, args);
  if (first.ok || first.reason === 'not_configured') return first;
  await new Promise((r) => setTimeout(r, 250));
  return rpc<T>(fn, args);
}

/** Persists one decision (one retry on a transient failure). Null when it could not be saved: it counts as not checked. */
export async function recordDecision(askId: string, memberId: string, attempt: 1 | 2, rulesVersion: number, d: StoredDecision, now: Date): Promise<{ question_id: string | null } | null> {
  const question_id = d.verdict === 'ask_back' && d.question ? publicId('question', 8) : null;
  const res = await rpcRetry<{ ok: boolean; question_id: string | null }>('net_record_decision', {
    p_ask: askId,
    p_member: memberId,
    p_attempt: attempt,
    p_rules_version: rulesVersion,
    p_result: { ...d, question_id },
    p_now: now.toISOString(),
  });
  if (!res.ok || !res.data?.ok) return null;
  return { question_id: res.data.question_id ?? null };
}

/** The gates of one REAL send, persisted one by one, then the offer. Emits asker-serialized events only. */
async function runRealFanout(askId: string, begin: BeginSend, emit: (e: FanoutEvent) => void): Promise<void> {
  const started = Date.now();
  const size = Math.max(0, begin.network_size);
  emit({ event: 'plan', data: { ask_id: askId, network: 'real', total: size } });
  const ask: GateInput['ask'] = {
    text: begin.compiled.text,
    subject: begin.compiled.subject,
    parts: begin.compiled.parts,
    ...(begin.asker_stage ? { asker_stage: begin.asker_stage } : {}),
  };
  const live: Map<number, 'next' | 'question'> = new Map();
  await pool(begin.gates, IN_FLIGHT, async (g) => {
    let d: StoredDecision;
    try {
      d = decisionFromGate(await gate({ rules: g.rules, ask }), 1);
    } catch {
      return; // never expected (runGate never throws); unrecorded, so not checked when the send finishes
    }
    const saved = await recordDecision(askId, g.member_id, 1, g.rules_version, d, new Date());
    if (!saved) return; // not persisted, so not streamed: it counts as not checked when the send finishes
    if (d.verdict === 'accept') {
      live.set(g.position, 'next');
      emit({ event: 'cell', data: { cell: g.position, state: 'next' } });
    } else if (d.verdict === 'ask_back' && saved.question_id) {
      live.set(g.position, 'question');
      emit({ event: 'cell', data: { cell: g.position, state: 'question' } });
    }
  });
  await finishRealSend(askId, size, live, started, emit);
}

async function finishRealSend(askId: string, size: number, live: Map<number, 'next' | 'question'>, started: number, emit: (e: FanoutEvent) => void): Promise<void> {
  const now = new Date();
  const accepts = [...live.values()].filter((s) => s === 'next').length;
  const fin = await rpcRetry<FinishResult>('net_finish_send', { p_ask: askId, p_now: now.toISOString(), p_slots: mintSlots(accepts + 2) });
  if (!fin.ok) {
    emit({ event: 'error', data: { kind: 'unavailable', message: `Something broke on our side. ${NOTHING_SENT} Your ask is saved.` } });
    return;
  }
  const result = fin.data;
  const failed = result.outcome === 'failed';
  const stopped = result.outcome === 'not_gating' || result.outcome === 'not_found';
  const settled = failed || stopped ? null : await completeAdvance(askId, result as AdvanceResult, now);
  const offered = settled?.outcome === 'offered' && typeof settled.cell === 'number' ? settled : null;

  // The final cells, in position order: nothistime for everything that isn't in line, a question, or the offer.
  const finalState = (pos: number): AskerCellState => {
    if (offered && offered.cell === pos) return 'offered';
    if (failed || stopped) return 'nothistime';
    return live.get(pos) ?? 'nothistime';
  };
  const counts: Record<AskerCellState, number> = { offered: 0, next: 0, question: 0, nothistime: 0 };
  for (let pos = 0; pos < size; pos++) {
    const s = finalState(pos);
    counts[s] += 1;
    if (s === 'nothistime') emit({ event: 'cell', data: { cell: pos, state: 'nothistime' } });
  }
  if (offered) emit({ event: 'cell', data: { cell: offered.cell as number, state: 'offered' } });
  if (!failed && !stopped) {
    for (const q of result.questions ?? []) emit({ event: 'question', data: { qid: q.id, type: q.type, text: q.text, gates: Number(q.gates) || 1 } });
  }
  if (offered?.expires_at) emit({ event: 'offer', data: { expires_at: new Date(toMs(offered.expires_at)).toISOString() } });
  const done: FanoutDoneEvent = {
    wall_ms: Date.now() - started,
    people_interrupted: offered ? 1 : 0,
    counts,
    gates_ran: null,
    gates_failed: Number(result.gates_failed) || 0,
    failed_closed: failed,
  };
  emit({ event: 'done', data: done });
  // After the stream's last event: the offer email, and the next queued ask if this one settled.
  await afterAdvance(settled, now);
}

type BeginOutcome = { ok: true; begin: BeginSend } | { ok: false; reason: 'not_found' | 'queued' | 'already_sent' | 'not_configured' | 'db_down' };

async function beginSend(askId: string, askerId: string, now: Date): Promise<BeginOutcome> {
  const res = await rpc<BeginSend | { ok: false; reason: 'not_found' | 'queued' | 'already_sent' }>('net_begin_send', { p_ask: askId, p_asker: askerId, p_now: now.toISOString() });
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const d = res.data;
  if (!d || !d.ok) return { ok: false, reason: (d as { reason?: 'not_found' | 'queued' | 'already_sent' } | null)?.reason ?? 'not_found' };
  return { ok: true, begin: { ...d, gates: Array.isArray(d.gates) ? d.gates : [], skipped: Array.isArray(d.skipped) ? d.skipped : [] } };
}

/**
 * Sends a persisted REAL ask that `user` owns (status `ready`, or `failed` for a retry; `queued` → 409 queued;
 * anything later → 409 already_sent with `ask_id`). Events are asker-serialized: cell states are only offered |
 * next | question | nothistime; no caps, pauses or identities (docs/CONTRACT.md §d). The fan-out finishes and
 * persists even if the client disconnects (lib/sse `detachedEvents` + `after(() => run.done)`).
 * Used by POST /api/asks/[id]/send and the MCP tool send_ask (with a token).
 */
export async function startSend(askId: string, user: MemberRef, context: { clientKey: string | null; signal?: AbortSignal }): Promise<FanoutStart> {
  if (!networkConfigured()) {
    return { ok: false, status: 503, body: { error: 'not_configured', message: `The real network isn’t set up on this instance. ${NOTHING_SENT}` } };
  }
  if (typeof askId !== 'string' || !isRealAskId(askId)) return { ok: false, status: 404, body: { error: 'not_found', message: 'No ask of yours has this id.' } };
  // Read first, change nothing: a refusal below must leave the ask exactly as it was.
  const owner = await rpc<{ asker_id: string; status: string } | null>('net_ask_owner', { p_ask: askId });
  if (!owner.ok) return { ok: false, status: 503, body: { error: 'not_configured', message: `Something broke on our side. ${NOTHING_SENT} Your ask is saved.` } };
  const status = owner.data && owner.data.asker_id === user.id ? owner.data.status : null;
  if (!status) return { ok: false, status: 404, body: { error: 'not_found', message: 'No ask of yours has this id.' } };
  if (status === 'queued') {
    return { ok: false, status: 409, body: { error: 'queued', ask_id: askId, message: 'You have 3 open asks. This one sends when one of them closes.' } };
  }
  if (status !== 'ready' && status !== 'failed') {
    return { ok: false, status: 409, body: { error: 'already_sent', ask_id: askId, message: 'This ask was already sent.' } };
  }
  const live = await getLiveState();
  if (!canRunLive(live)) return { ok: false, status: 503, body: { ...liveRefusal(live, true), ask_id: askId } };
  const limit = await checkRateLimit(context.clientKey, 'send');
  if (!limit.ok) return { ok: false, status: 429, body: { ...rateRefusal(limit.retry_at, 'send'), ask_id: askId } };

  const begun = await beginSend(askId, user.id, new Date());
  if (!begun.ok) {
    if (begun.reason === 'queued') return { ok: false, status: 409, body: { error: 'queued', ask_id: askId, message: 'You have 3 open asks. This one sends when one of them closes.' } };
    if (begun.reason === 'already_sent') return { ok: false, status: 409, body: { error: 'already_sent', ask_id: askId, message: 'This ask was already sent.' } };
    if (begun.reason === 'not_found') return { ok: false, status: 404, body: { error: 'not_found', message: 'No ask of yours has this id.' } };
    return { ok: false, status: 503, body: { error: 'not_configured', message: `Something broke on our side. ${NOTHING_SENT} Your ask is saved.` } };
  }
  const run = detachedEvents<FanoutEvent>((emit) => runRealFanout(askId, begun.begin, emit));
  keepAlive(run.done);
  return { ok: true, ask_id: askId, events: run.events };
}

/**
 * Sends a ready REAL ask with nobody watching: a queued ask that became ready when another closed, or one whose tab
 * closed between create and send (the daily cron). Leaves it ready when live checks can't run.
 */
export async function sendInBackground(askId: string): Promise<'sent' | 'not_sent'> {
  if (!networkConfigured() || !isRealAskId(askId)) return 'not_sent';
  const live = await getLiveState();
  if (!canRunLive(live)) return 'not_sent';
  const owner = await rpc<{ asker_id: string } | null>('net_ask_owner', { p_ask: askId });
  if (!owner.ok || !owner.data?.asker_id) return 'not_sent';
  const begun = await beginSend(askId, owner.data.asker_id, new Date());
  if (!begun.ok) return 'not_sent';
  const run = detachedEvents<FanoutEvent>((emit) => runRealFanout(askId, begun.begin, emit));
  keepAlive(run.done);
  await run.done;
  return 'sent';
}

/** Finishes a send whose function died mid-way (the daily cron): runs the gates that never recorded, then the offer. */
export async function resumeSend(askId: string): Promise<'resumed' | 'not_resumed'> {
  if (!networkConfigured()) return 'not_resumed';
  const live = await getLiveState();
  const rows = await rpc<{ compiled: CompiledAsk; asker_stage: string | null; gates: GateRow[] }>('net_resume_gates', { p_ask: askId });
  if (!rows.ok || !rows.data) return 'not_resumed';
  const { compiled, asker_stage, gates } = rows.data;
  const ask: GateInput['ask'] = { text: compiled.text, subject: compiled.subject, parts: compiled.parts, ...(asker_stage ? { asker_stage } : {}) };
  if (canRunLive(live)) {
    await pool(Array.isArray(gates) ? gates : [], IN_FLIGHT, async (g) => {
      await recordDecision(askId, g.member_id, 1, g.rules_version, decisionFromGate(await gate({ rules: g.rules, ask }), 1), new Date());
    });
  }
  // Whatever is still missing counts as not checked; more than 1 in 5 fails closed.
  const now = new Date();
  const fin = await rpc<FinishResult>('net_finish_send', { p_ask: askId, p_now: now.toISOString(), p_slots: mintSlots(8) });
  if (!fin.ok) return 'not_resumed';
  if (fin.data.outcome !== 'failed' && fin.data.outcome !== 'not_gating') await afterAdvance(await completeAdvance(askId, fin.data as AdvanceResult, now), now);
  return 'resumed';
}

/* ========================================================================== *
 * SAMPLE: 39 fictional members plus the visitor's own gate
 * ========================================================================== */

export interface SampleSendInput {
  /** One of the three sample asks when the founder sent its text (vague / partial / complete variants). */
  sample_ask_id: SampleNetworkAskId | null;
  text: string;
  compiled: CompiledAsk;
  /** The visitor's own gate (the YOU cell): their playground rules and cap, or null. */
  you: { rules: string; cap: number } | null;
}

const SAMPLE_TOTAL = 40;
const YOU_LABEL = 'You';
const YOU_CITY = 'your rules';

/** The sample ask whose recorded results apply: its id, and the text is one of its three variants. */
export function canonicalSampleAsk(id: string | null | undefined, text: string): SampleNetworkAsk | null {
  if (!id || !isSampleNetworkAskId(id)) return null;
  const sa = sampleNetworkAskById(id);
  if (!sa) return null;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const t = norm(text);
  return [sa.vague, sa.partial, sa.complete].some((v) => norm(v) === t) ? sa : null;
}

function cleanYou(you: unknown): { rules: string; cap: number } | null | 'bad' {
  if (you === null || you === undefined) return null;
  if (typeof you !== 'object') return 'bad';
  const y = you as { rules?: unknown; cap?: unknown };
  if (typeof y.rules !== 'string') return 'bad';
  if (!y.rules.trim()) return null;
  if (y.rules.length > RULES_MAX) return 'bad';
  const cap = Number(y.cap);
  if (!Number.isInteger(cap) || cap < 1 || cap > 5) return 'bad';
  return { rules: y.rules, cap };
}

/** The member's own words for the first quote code found (offsets index `rules`). */
function citedWords(rules: string, cited: CitedQuote[] | null | undefined): string | null {
  const q = (cited ?? []).find((c) => c && c.found && typeof c.start === 'number' && typeof c.end === 'number' && c.end > c.start);
  return q && q.start !== undefined && q.end !== undefined ? rules.slice(q.start, q.end) : null;
}

/** Waffle positions for a sample ask: cell i (39 members in SAMPLE_MEMBERS order, then you) sits at order[i]. */
export function samplePositions(id: string): number[] {
  return shuffled(SAMPLE_TOTAL, hash32(id));
}

/** The 40th cell when the visitor has no playground rules: a hand-written sample member that declines (topic). */
function fillerCell(id: string, pos: number): FanoutCellEventSample {
  return { cell: pos, state: 'decline', you: false, label: `m-${hex4(`${id}:fill`)}`, city: 'Seattle', reason_code: 'topic', cited: null, question: null, ms: null, cap: 2, used: 1, na: null, source: 'authored' };
}

function recordedCell(row: RecordedMemberGate, m: SampleMember, pos: number, fromModel: boolean): FanoutCellEventSample {
  return {
    cell: pos,
    state: row.state,
    you: false,
    label: m.label,
    city: m.city,
    reason_code: row.reason_code,
    cited: citedWords(m.rules, row.cited),
    question: row.question ? { ...row.question } : null,
    ms: fromModel && row.state !== 'na' ? row.ms : null,
    cap: m.cap,
    used: m.used,
    na: row.na,
    source: fromModel ? 'recorded' : 'authored',
  };
}

/** A live gate's result as a sample cell (the YOU cell, or any member of a custom-text send). */
function liveCell(res: GateResult | null, who: { pos: number; you: boolean; label: string; city: string; cap: number; used: number; rules: string }, attempt: 1 | 2): FanoutCellEventSample {
  const base = { cell: who.pos, you: who.you, label: who.label, city: who.city, cap: who.cap, used: who.used, na: null, source: 'live' as const };
  if (!res) return { ...base, state: 'failed', reason_code: null, cited: null, question: null, ms: null };
  const d = decisionFromGate(res, attempt);
  const ms = res.ms ? Math.round(res.ms) : null;
  if (d.verdict === null) return { ...base, state: 'failed', reason_code: null, cited: null, question: null, ms };
  return {
    ...base,
    state: d.verdict === 'accept' ? 'accept' : d.verdict === 'ask_back' ? 'ask_back' : 'decline',
    reason_code: d.reason_code,
    cited: d.verdict === 'accept' ? citedWords(who.rules, d.cited) : null,
    question: d.verdict === 'ask_back' ? d.question : null,
    ms,
  };
}

/** A tiny async channel: producers push, the generator yields in arrival order. */
function channel<T>() {
  const buf: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(v: T) {
      buf.push(v);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        if (buf.length) {
          yield buf.shift() as T;
          continue;
        }
        if (closed) return;
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}

/** Most unused cap first, then the earliest answer, then the waffle position. */
function bestAccept(cells: FanoutCellEventSample[], arrival: Map<number, number>): FanoutCellEventSample | null {
  const accepts = cells.filter((c) => c.state === 'accept');
  accepts.sort((a, b) => b.cap - b.used - (a.cap - a.used) || (arrival.get(a.cell) ?? 0) - (arrival.get(b.cell) ?? 0) || a.cell - b.cell);
  return accepts[0] ?? null;
}

/** Custom-text SAMPLE sends keep, for an hour, which members asked which question (for answerSampleQuestion). */
const customAsks = new Map<string, { at: number; askers: Partial<Record<QuestionType, number[]>>; offered: boolean }>();
const CUSTOM_TTL_MS = 3_600_000;
function rememberCustom(id: string, cells: FanoutCellEventSample[], offered: boolean): void {
  const now = Date.now();
  for (const [k, v] of customAsks) if (now - v.at > CUSTOM_TTL_MS) customAsks.delete(k);
  while (customAsks.size >= 500) customAsks.delete(customAsks.keys().next().value as string);
  const askers: Partial<Record<QuestionType, number[]>> = {};
  for (const c of cells) if (c.state === 'ask_back' && c.question && !c.you) (askers[c.question.type] ??= []).push(c.cell);
  customAsks.set(id, { at: now, askers, offered });
}

interface SamplePlan {
  id: string;
  sa: SampleNetworkAsk | null;
  you: { rules: string; cap: number } | null;
  /** The YOU gate (and, for custom text, every gate) may call the model. */
  liveOk: boolean;
  compiled: CompiledAsk;
  replay: boolean;
  signal?: AbortSignal;
}

async function* sampleFanout(plan: SamplePlan): AsyncGenerator<FanoutEvent> {
  const started = Date.now();
  const abort = new AbortController();
  const onOuterAbort = () => abort.abort();
  plan.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const order = samplePositions(plan.id);
  const youPos = order[SAMPLE_TOTAL - 1] as number;
  const ask: GateInput['ask'] = {
    text: plan.compiled.text,
    subject: plan.compiled.subject,
    parts: plan.compiled.parts,
    ...(plan.sa ? { asker_stage: plan.sa.as.stage } : {}),
  };
  const recorded = plan.sa ? await sampleNetworkRun(plan.sa.id) : null;
  const fromModel = recorded?.file.source === 'model';
  try {
    yield {
      event: 'plan',
      data: {
        ask_id: plan.id,
        network: 'sample',
        total: SAMPLE_TOTAL,
        sample_source: recorded ? recorded.file.source : 'live',
        ...(recorded ? { recorded_at: recorded.file.recorded_at } : {}),
      },
    };

    const chan = channel<FanoutCellEventSample>();
    const producers: Promise<void>[] = [];
    const youRun = async () => {
      if (!plan.you) {
        chan.push(fillerCell(plan.id, youPos));
        return;
      }
      const who = { pos: youPos, you: true, label: YOU_LABEL, city: YOU_CITY, cap: plan.you.cap, used: 0, rules: plan.you.rules };
      chan.push(liveCell(plan.liveOk ? await gate({ rules: plan.you.rules, ask }, { signal: abort.signal }) : null, who, 1));
    };

    if (recorded) {
      const rows = recorded.run.members;
      const cells = SAMPLE_MEMBERS.map((m, i) => {
        const row = rows.find((r) => r.label === m.label) ?? (rows[i] as RecordedMemberGate);
        return { at: row.state === 'na' || !fromModel || !plan.replay ? 0 : Math.max(0, row.ms ?? 0), cell: recordedCell(row, m, order[i] as number, fromModel) };
      });
      // SQL skips resolve at once on SAMPLE (on purpose: everything here is fictional), then the gates.
      cells.sort((a, b) => a.at - b.at || Number(b.cell.state === 'na') - Number(a.cell.state === 'na') || a.cell.cell - b.cell.cell);
      producers.push(
        (async () => {
          for (const c of cells) {
            if (c.at > 0) await sleep(c.at - (Date.now() - started), abort.signal);
            if (abort.signal.aborted) return;
            chan.push(c.cell);
          }
        })(),
      );
      producers.push(youRun());
    } else {
      // Custom text: every sample member's gate runs live (members at their cap or paused are skipped by the same
      // rule SQL applies), plus yours.
      const gates: (() => Promise<void>)[] = [];
      SAMPLE_MEMBERS.forEach((m, i) => {
        const pos = order[i] as number;
        if (m.paused || m.used >= m.cap) {
          // Skipped by the cap and pause rule over the sample's hand-written usage: no gate ran, nothing was live.
          chan.push({ cell: pos, state: 'na', you: false, label: m.label, city: m.city, reason_code: null, cited: null, question: null, ms: null, cap: m.cap, used: m.used, na: m.paused ? 'paused' : 'at_cap', source: 'authored' });
          return;
        }
        gates.push(async () => {
          const res = plan.liveOk ? await gate({ rules: m.rules, ask }, { signal: abort.signal }) : null;
          if (!abort.signal.aborted) chan.push(liveCell(res, { pos, you: false, label: m.label, city: m.city, cap: m.cap, used: m.used, rules: m.rules }, 1));
        });
      });
      gates.push(youRun);
      producers.push(pool(gates, IN_FLIGHT, (g) => g()).then(() => undefined));
    }
    // allSettled: a producer that somehow threw still ends the stream (its cells simply never arrive: not checked).
    void Promise.allSettled(producers).then(() => chan.close());

    const cells: FanoutCellEventSample[] = [];
    const arrival = new Map<number, number>();
    for await (const c of chan.drain()) {
      arrival.set(c.cell, cells.length);
      cells.push(c);
      yield { event: 'cell', data: c };
    }
    if (abort.signal.aborted) return;

    // The offer: fail closed when more than 1 in 5 gates weren't checked; otherwise the best accept.
    const ran = cells.filter((c) => c.state !== 'na');
    const failed = ran.filter((c) => c.state === 'failed').length;
    const failedClosed = ran.length > 0 && failed * 5 > ran.length;
    const best = failedClosed ? null : bestAccept(cells, arrival);
    if (!plan.sa) rememberCustom(plan.id, cells, !!best);

    if (!failedClosed) {
      const byType = new Map<QuestionType, { text: string; gates: number; you: boolean; pos: number }>();
      for (const c of cells) {
        if (c.state !== 'ask_back' || !c.question) continue;
        const cur = byType.get(c.question.type);
        if (!cur) byType.set(c.question.type, { text: c.question.text, gates: 1, you: c.you, pos: c.cell });
        else {
          cur.gates += 1;
          // Your own gate's wording leads (ux-spec S2: the question you can answer from your rules).
          if (c.you || (!cur.you && c.cell < cur.pos)) Object.assign(cur, { text: c.question.text, you: c.you, pos: c.cell });
        }
      }
      const questions = [...byType.entries()].sort((a, b) => Number(b[1].you) - Number(a[1].you) || a[1].pos - b[1].pos);
      for (const [type, q] of questions) {
        yield { event: 'question', data: { qid: `q_${hex4(`${plan.id}:${type}`)}`, type, text: q.text, gates: q.gates } };
      }
    }
    let offer: FanoutOfferEvent | null = null;
    if (best) {
      offer = { expires_at: new Date(Date.now() + OFFER_WINDOW_MS).toISOString(), to: best.you ? 'you' : 'member', cell: best.cell };
      yield { event: 'offer', data: offer };
    }
    const accepts = cells.filter((c) => c.state === 'accept').length;
    const asks = cells.filter((c) => c.state === 'ask_back').length;
    const counts: Record<AskerCellState, number> = {
      offered: best ? 1 : 0,
      next: failedClosed ? 0 : accepts - (best ? 1 : 0),
      question: failedClosed ? 0 : asks,
      nothistime: 0,
    };
    counts.nothistime = SAMPLE_TOTAL - counts.offered - counts.next - counts.question;
    yield {
      event: 'done',
      data: { wall_ms: Date.now() - started, people_interrupted: best ? 1 : 0, counts, gates_ran: ran.length, gates_failed: failed, failed_closed: failedClosed },
    };
  } finally {
    abort.abort();
    plan.signal?.removeEventListener('abort', onOuterAbort);
  }
}

function liveSampleRefusal(live: LiveSnapshot): FanoutRefusal {
  const base = liveRefusal(live, false);
  return {
    ...base,
    message:
      live.state === 'off'
        ? `Your own text needs live checks, and they’re off on this instance: no model API key is set. Try one of the 3 sample asks; they run from their example results. ${NOTHING_SENT}`
        : base.message,
  };
}

/**
 * The SAMPLE fan-out: nothing is persisted and nobody is emailed. For a sample ask, the 39 sample members come
 * from data/recorded/sample-network.json (replayed at recorded speed only when its source is "model"; an
 * authored file renders at once and is labelled AUTHORED_FANOUT_LABEL) and YOUR gate runs live (NOT CHECKED when
 * live calls are unavailable: never an accept). Without `you` (no playground rules), the 40th cell is an authored
 * sample member that declines (topic), labelled authored. For any other text all 40 gates run live, or the send is
 * refused with `live_unavailable`; such a send gets the id `sa_` + 6 characters (publicId('sampleAsk')).
 * validateAsk (lib/oti/ask.ts) runs first. Cell events carry the full internal result (FanoutCellEventSample) for
 * the reveal switch; the `offer` event names the holder's cell. Used by POST /api/asks/sample and send_ask without a
 * token. The playground-style stream may stop when the client leaves (nothing is persisted).
 */
export async function startSampleSend(input: SampleSendInput, context: { clientKey: string | null; signal?: AbortSignal }): Promise<FanoutStart> {
  return startSampleSendWith(input, context, { replay: true });
}

/**
 * startSampleSend with options: `replay: false` renders a recorded (model) file at once instead of at its recorded
 * speed (POST /api/asks/sample?replay=0, for viewers who prefer reduced motion; an authored file always renders at once).
 */
export async function startSampleSendWith(
  input: SampleSendInput,
  context: { clientKey: string | null; signal?: AbortSignal },
  options: { replay: boolean },
): Promise<FanoutStart> {
  const text = typeof input?.text === 'string' ? input.text : '';
  const check = validateAsk(text, input?.compiled);
  if (!check.ok) return { ok: false, status: 400, body: { error: 'invalid', message: check.message } };
  const you = cleanYou(input.you);
  if (you === 'bad') {
    return { ok: false, status: 400, body: { error: 'invalid', message: 'Your playground rules need 1 to 1,000 characters and a cap from 1 to 5.' } };
  }
  const sa = canonicalSampleAsk(input.sample_ask_id, text);
  const live = await getLiveState();
  let liveOk = canRunLive(live);
  if (!sa) {
    if (!liveOk) return { ok: false, status: 503, body: liveSampleRefusal(live) };
    const limit = await checkRateLimit(context.clientKey, 'sample_send');
    if (!limit.ok) return { ok: false, status: 429, body: rateRefusal(limit.retry_at, 'sample') };
  } else if (you && liveOk) {
    // Recorded results are unlimited; only your own live gate counts against the limit (rate-limited: not checked).
    const limit = await checkRateLimit(context.clientKey, 'sample_send');
    if (!limit.ok) liveOk = false;
  }
  const id = sa ? sa.id : publicId('sampleAsk');
  void recordAudit('sample_ask_sent', { ask_id: id, detail: { live: !sa, you: !!you } });
  return {
    ok: true,
    ask_id: id,
    events: sampleFanout({ id, sa, you, liveOk, compiled: input.compiled, replay: options.replay, signal: context.signal }),
  };
}

export interface SampleAnswerInput {
  /** The SAMPLE ask the question is on (`sa_eng`, `sa_health`, `sa_founder` or a custom `sa_…`). */
  sample_ask_id: string;
  compiled: CompiledAsk;
  /** The visitor's own gate, only if IT asked this question (its question reruns live). */
  you: { rules: string; cap: number } | null;
  question: GateQuestion;
  /** The founder's approved answer, ≤ 280 characters. */
  answer: string;
}

export type SampleAnswerResult =
  | {
      ok: true;
      /** Gates that asked and reran once (“That answer reran the 2 gates that asked.”). */
      reran: number;
      accepted: number;
      /** The cells that changed, with their new internal result (YOU live; sample members from their file's source). */
      cells: FanoutCellEventSample[];
      /** A new offer when nobody held the ask and a rerun accept is now the best accept; else null. */
      offer: FanoutOfferEvent | null;
    }
  | { ok: false; status: 400 | 429 | 503; body: FanoutRefusal };

/**
 * ask_back on SAMPLE (/ask/sa_…, MCP answer_question on a SAMPLE id): the answer goes only to the gates that asked,
 * and each reruns once. YOUR gate reruns live (stays NOT CHECKED when live calls are unavailable); sample members
 * use their recorded or authored rerun, labelled by source. Nothing is persisted. POST /api/asks/sample/answer.
 *
 * Which members asked: for the 3 sample asks, the recorded file says; for a custom-text send, this instance
 * remembers it for an hour (an unknown id answers 400 “Send it again”). The authored file has no rerun rows: the
 * hand-written sample expects each gate that asked to accept once it has the answer (prototype data.js), and those
 * cells say `authored`. A model file's members rerun live; without live calls the answer is refused (503 live_unavailable).
 */
export async function answerSampleQuestion(input: SampleAnswerInput, context: { clientKey: string | null; signal?: AbortSignal }): Promise<SampleAnswerResult> {
  const id = typeof input?.sample_ask_id === 'string' ? input.sample_ask_id : '';
  const q = input?.question;
  const answer = typeof input?.answer === 'string' ? input.answer.replace(/\s+/g, ' ').trim() : '';
  if (!isSampleAskId(id) || !q || !QUESTION_TYPES.includes(q.type) || !answer || answer.length > ANSWER_MAX || !input.compiled || typeof input.compiled.text !== 'string') {
    return { ok: false, status: 400, body: { error: 'invalid', message: `Send {sample_ask_id, compiled, you, question, answer}; the answer needs 1 to ${ANSWER_MAX} characters.` } };
  }
  const you = cleanYou(input.you);
  if (you === 'bad') return { ok: false, status: 400, body: { error: 'invalid', message: 'Your playground rules need 1 to 1,000 characters and a cap from 1 to 5.' } };

  const order = samplePositions(id);
  const sa = isSampleNetworkAskId(id) ? sampleNetworkAskById(id) : null;
  const recorded = sa ? await sampleNetworkRun(sa.id) : null;
  const custom = sa ? null : customAsks.get(id);
  if (!sa && !custom) {
    return { ok: false, status: 400, body: { error: 'not_found', message: `This sample ask is no longer on the server. Send it again. ${NOTHING_SENT}` } };
  }

  // The sample members whose gate asked this type of question.
  const askers: { i: number; m: SampleMember; pos: number }[] = [];
  SAMPLE_MEMBERS.forEach((m, i) => {
    const pos = order[i] as number;
    if (recorded) {
      const row = recorded.run.members.find((r) => r.label === m.label);
      if (row?.state === 'ask_back' && row.question?.type === q.type) askers.push({ i, m, pos });
    } else if (custom?.askers[q.type]?.includes(pos)) askers.push({ i, m, pos });
  });
  const authoredReruns = recorded?.file.source === 'authored';
  const needsLive = !!you || !authoredReruns;
  const live = await getLiveState();
  let liveOk = needsLive && canRunLive(live);
  if (liveOk) {
    const limit = await checkRateLimit(context.clientKey, 'sample_send');
    if (!limit.ok) return { ok: false, status: 429, body: rateRefusal(limit.retry_at, 'sample') };
  } else liveOk = false;
  // Sample members from a model file (or a custom send) rerun live. Without live calls none of them can rerun, so
  // refuse, as a REAL answer does, rather than report failed reruns as gates that “reran once and declined”.
  if (askers.length > 0 && !authoredReruns && !liveOk) {
    const base = liveRefusal(live, false);
    return { ok: false, status: 503, body: { ...base, message: `The gates that asked rerun live, and they can’t right now. ${base.message}` } };
  }

  const ask: GateInput['ask'] = { text: input.compiled.text, subject: input.compiled.subject, parts: input.compiled.parts, ...(sa ? { asker_stage: sa.as.stage } : {}) };
  const answers = [{ type: q.type, text: answer }];
  const jobs: (() => Promise<FanoutCellEventSample>)[] = askers.map(({ m, pos }) => async () => {
    if (authoredReruns) {
      const words = findClause(m.rules, memberCitation(m));
      return {
        cell: pos, state: 'accept', you: false, label: m.label, city: m.city, reason_code: 'match',
        cited: words ? m.rules.slice(words.start, words.end) : null, question: null, ms: null, cap: m.cap, used: m.used, na: null, source: 'authored',
      };
    }
    const res = liveOk ? await gate({ rules: m.rules, ask, answers }, { signal: context.signal }) : null;
    return liveCell(res, { pos, you: false, label: m.label, city: m.city, cap: m.cap, used: m.used, rules: m.rules }, 2);
  });
  if (you) {
    const youPos = order[SAMPLE_TOTAL - 1] as number;
    jobs.push(async () => {
      const res = liveOk ? await gate({ rules: you.rules, ask, answers }, { signal: context.signal }) : null;
      return liveCell(res, { pos: youPos, you: true, label: YOU_LABEL, city: YOU_CITY, cap: you.cap, used: 0, rules: you.rules }, 2);
    });
  }
  const cells = await pool(jobs, IN_FLIGHT, (job) => job());
  const accepted = cells.filter((c) => c.state === 'accept').length;

  // Nobody new is interrupted while someone holds the ask; when nobody does, the best rerun accept gets it.
  const held = recorded ? recorded.run.members.some((r) => r.state === 'accept') : !!custom?.offered;
  let offer: FanoutOfferEvent | null = null;
  if (!held && accepted) {
    const best = bestAccept(cells, new Map(cells.map((c, i) => [c.cell, i])));
    if (best) {
      offer = { expires_at: new Date(Date.now() + OFFER_WINDOW_MS).toISOString(), to: best.you ? 'you' : 'member', cell: best.cell };
      if (custom) custom.offered = true;
    }
  }
  return { ok: true, reran: cells.length, accepted, cells, offer };
}
