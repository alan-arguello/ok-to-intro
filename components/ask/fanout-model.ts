/**
 * The /ask/[id] status page as data: a SAMPLE run (what the fan-out stream sent, plus what happened in this tab
 * since), the four-state asker view of every cell, the legend, the outcome, the offer line and the raw trace.
 * Pure; tested in tests/ask. The SAMPLE fan-out itself comes from BE2 (POST /api/asks/sample); this module only
 * renders it and applies the tab's own steps (the sample loop, an answer, a withdrawal).
 *
 * Askers see four states (docs/CONTRACT.md §d): offered (holds the offer, or said OK), next (accepted, in line),
 * question (their gate's question is pending), not this time (everything else, a pass and an expiry included).
 * SAMPLE can reveal the rest behind “Show what askers never see”.
 */

import { findClause } from '@/lib/oti/clause';
import { AUTHORED_FANOUT_LABEL } from '@/lib/oti/copy';
import { lower1, plural, shuffled, hash32, hex4, stripEnd } from '@/lib/oti/text';
import { OFFER_WINDOW_MS } from '@/lib/oti/time';
import type { PlaygroundStore } from '@/lib/oti/storage';
import type { QaState } from '@/lib/qa';
import { presetById } from '@/lib/sample/presets';
import { sampleAskById as askByKey } from '@/lib/sample/asks';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { SAMPLE_FANOUTS, SAMPLE_MEMBER_NAMES, SAMPLE_MEMBERS, SAMPLE_NETWORK_ASKS, sampleNetworkAskById } from '@/lib/sample/network';
import type { SampleNetworkAsk } from '@/lib/sample/types';
import { PRESET_RECORDINGS } from '@/lib/recorded';
import type {
  AskerCellState,
  CellClass,
  CompiledAsk,
  FanoutCellEventSample,
  FanoutDoneEvent,
  FanoutOfferEvent,
  FanoutPlanEvent,
  FanoutQuestionEvent,
  GateQuestion,
  PresetId,
  ReasonCode,
  SampleNetworkAskId,
} from '@/lib/types';

/* ========================================================================== *
 * The SAMPLE run (stored in this tab under oti.s2.runs; see sample-store.ts)
 * ========================================================================== */

/** One cell as it arrived, with its arrival time in ms after Send (null in QA examples, which have no timing). */
export type SampleCell = FanoutCellEventSample & { at: number | null };
export type SampleQuestion = FanoutQuestionEvent & { at: number | null };

export type SampleOutcome =
  | 'ready' // in the tab, not sent yet: the status page sends it
  | 'streaming'
  | 'offered'
  | 'offered-you'
  | 'question' // nothing offered yet; a gate's question waits on the asker
  | 'no-match'
  | 'failed-closed'
  | 'answered' // the member who held it answered in 2 lines (the sample loop)
  | 'intro' // the member who held it said OK (the sample loop)
  | 'moved-on' // the holder passed: the next person in line holds it
  | 'closed-all-passed'
  | 'expired-deadline' // QA only: a SAMPLE ask never ages
  | 'closed' // the asker said the answer solved it
  | 'withdrawn'
  | 'refused' // the send was refused before anything streamed
  | 'lost' // the stream ended without `done`
  | 'offline';

export interface SampleRefusal {
  status: number;
  error: string;
  message: string;
  retry_at?: string;
}

export interface SampleAnswerRecord {
  qid: string;
  question: GateQuestion;
  text: string;
  reran: number;
  accepted: number;
  offer: boolean;
  /** The visitor's own gate was one of the gates that asked (it reran on this answer). */
  you?: boolean;
}

export interface SampleRun {
  v: 1;
  /** `sa_eng | sa_health | sa_founder`, or `sa_` + random for the founder's own text. */
  id: string;
  preset: PresetId;
  /** The canonical sample ask the text came from, or null for the founder's own text. */
  sample_ask_id: SampleNetworkAskId | null;
  /** The founder's text (1..600) and the ask exactly as approved. */
  text: string;
  compiled: CompiledAsk;
  /** The visitor's own gate: their playground rules and cap at Send, or null. */
  you: { rules: string; cap: number } | null;
  /** When the visitor pressed Send (epoch ms, the viewer's own clock). */
  sent_at: number;
  outcome: SampleOutcome;
  plan: FanoutPlanEvent | null;
  /** By waffle position; null until that cell's event arrives. */
  cells: (SampleCell | null)[];
  questions: SampleQuestion[];
  /** The stream's offer event (the first holder). */
  offer: (FanoutOfferEvent & { at: number | null }) | null;
  done: (FanoutDoneEvent & { at: number | null }) | null;
  /** Positions offered, in order: the first holder, then each next person after a pass. */
  offered: number[];
  /** When the current holder got it (epoch ms); reply by = this + 72 h. */
  offered_at: number | null;
  answers: SampleAnswerRecord[];
  /** The 2 lines the member wrote (oti.sampleOffer `answer`). */
  member_answer: string | null;
  /** The last oti.sampleOffer `at` applied, so the loop applies each action once. */
  loop_at: number | null;
  withdrawn_at: number | null;
  closed_at: number | null;
  refusal: SampleRefusal | null;
  /** QA example data (never stored, never sent). */
  example: boolean;
}

export const NETWORK_TOTAL = 40;

const CLOSED: readonly SampleOutcome[] = ['closed-all-passed', 'expired-deadline', 'closed', 'withdrawn', 'failed-closed', 'intro'];
/** Outcomes where someone holds the offer (or held it and acted): their cell stays orange. */
const HOLDER_SHOWN: readonly SampleOutcome[] = ['offered', 'offered-you', 'moved-on', 'answered', 'intro', 'closed'];
/** Waiting on a member: the sample loop, the phone bar's “Open it as the member”, Withdraw. */
export const WAITING: readonly SampleOutcome[] = ['offered', 'offered-you', 'moved-on'];
const TERMINAL: readonly SampleOutcome[] = ['withdrawn', 'intro', 'closed-all-passed', 'expired-deadline', 'no-match', 'closed', 'failed-closed'];

export function isClosed(o: SampleOutcome): boolean {
  return CLOSED.includes(o);
}
export function isTerminal(o: SampleOutcome): boolean {
  return TERMINAL.includes(o);
}
export function isWaiting(o: SampleOutcome): boolean {
  return WAITING.includes(o);
}
/** The run has finished streaming (whatever came of it). */
export function isSettled(o: SampleOutcome): boolean {
  return !['ready', 'streaming', 'refused', 'lost', 'offline'].includes(o);
}

export function cellAt(run: SampleRun, pos: number): SampleCell | null {
  return run.cells[pos] ?? null;
}

export function youCell(run: SampleRun): SampleCell | null {
  return run.cells.find((c): c is SampleCell => !!c && c.you) ?? null;
}

/** The position of whoever holds (or held and acted on) the offer, when the outcome shows one. */
export function holderPos(run: SampleRun): number | null {
  if (!HOLDER_SHOWN.includes(run.outcome) || !run.offered.length) return null;
  return run.offered[run.offered.length - 1] as number;
}

export function holderCell(run: SampleRun): SampleCell | null {
  const p = holderPos(run);
  return p === null ? null : cellAt(run, p);
}

/** People interrupted = offers delivered (a pass, an answer, an expiry and a withdrawal all count). */
export function interrupted(run: SampleRun): number {
  return run.offered.length;
}

/**
 * Who gets the offer next among accepts not offered yet: the most unused cap this month, then the earliest answer
 * (arrival in the stream), then the waffle position. The same order BE2 uses for the first offer, so a pass in the
 * sample loop moves the ask exactly as the server would. Deterministic.
 */
export function rankAccepts(cells: readonly (SampleCell | null)[], exclude: readonly number[] = []): number[] {
  const big = Number.MAX_SAFE_INTEGER;
  return cells
    .map((c, pos) => ({ c, pos }))
    .filter((x): x is { c: SampleCell; pos: number } => !!x.c && x.c.state === 'accept' && !exclude.includes(x.pos))
    .sort((a, b) => b.c.cap - b.c.used - (a.c.cap - a.c.used) || (a.c.at ?? big) - (b.c.at ?? big) || a.pos - b.pos)
    .map((x) => x.pos);
}

/** Accepts in line, the holder and anyone offered before included (“Offered to the next person in line (2 of 3)”). */
export function acceptsInLine(run: SampleRun): number {
  const accepts = run.cells.filter((c) => c && c.state === 'accept').length;
  return Math.max(accepts, run.offered.length);
}

/** The questions still waiting on the asker, the type the visitor's own gate asked first. */
export function pendingQuestions(run: SampleRun): SampleQuestion[] {
  const answered = new Set(run.answers.map((a) => a.qid));
  const you = youCell(run);
  const mine = (q: SampleQuestion) => Number(you?.state === 'ask_back' && you.question?.type === q.type);
  return run.questions.filter((q) => !answered.has(q.qid)).sort((a, b) => mine(b) - mine(a));
}

/** True when the visitor's own gate asked this question (its rerun goes to BE2 with the visitor's rules). */
export function youAsked(run: SampleRun, q: Pick<SampleQuestion, 'type'>): boolean {
  const you = youCell(run);
  return you?.state === 'ask_back' && you.question?.type === q.type;
}

/** Pending ask_back cells (the question is still open for them). */
function askingCells(run: SampleRun): number {
  return run.cells.filter((c) => c && c.state === 'ask_back').length;
}

/* ---------- cells: what an asker sees, and what SAMPLE can reveal ---------- */

export type CellView = CellClass | 'passed';

/** One cell's state. Asker view: offered | next | ask | nothistime (+ checking while streaming). */
export function cellView(run: SampleRun, pos: number, reveal: boolean): CellView {
  const c = cellAt(run, pos);
  if (!c) return run.outcome === 'streaming' || run.outcome === 'ready' ? 'checking' : 'queued';
  if (holderPos(run) === pos) return 'offered';
  if (run.offered.includes(pos)) return reveal ? 'passed' : 'nothistime';
  const closed = isClosed(run.outcome);
  if (c.state === 'accept') return closed && !reveal ? 'nothistime' : 'next';
  if (c.state === 'ask_back') return closed && !reveal ? 'nothistime' : 'ask';
  if (!reveal) return 'nothistime';
  return c.state === 'na' ? 'na' : c.state === 'failed' ? 'failed' : 'declined';
}

/** The CSS class a view paints with (a passed member is a plain chip). */
export function cellClassOf(view: CellView): CellClass {
  return view === 'passed' ? 'nothistime' : view;
}

export interface LegendItem {
  state: CellClass;
  text: string;
}

const DECLINE_CODES: readonly ReasonCode[] = ['topic', 'stage', 'proof', 'region', 'no_rule', 'rule_says_no'];
const CODE_LABEL: Partial<Record<ReasonCode, string>> = { no_rule: 'no rule', rule_says_no: 'rule says no' };

export function legendItems(run: SampleRun, reveal: boolean): LegendItem[] {
  const t: Record<CellView, number> = { queued: 0, checking: 0, offered: 0, next: 0, ask: 0, nothistime: 0, declined: 0, na: 0, failed: 0, passed: 0 };
  const codes = new Map<string, number>();
  const nas = { at_cap: 0, paused: 0 };
  for (let pos = 0; pos < run.cells.length; pos++) {
    const v = cellView(run, pos, reveal);
    t[v]++;
    const c = cellAt(run, pos);
    if (v === 'declined' && c) codes.set(c.reason_code ?? 'topic', (codes.get(c.reason_code ?? 'topic') ?? 0) + 1);
    if (v === 'na' && c) nas[c.na === 'paused' ? 'paused' : 'at_cap']++;
  }
  const items: LegendItem[] = [];
  const add = (state: CellClass, text: string) => items.push({ state, text });
  if (t.queued + t.checking) add('checking', `${t.queued + t.checking} checking`);
  if (t.offered) add('offered', `${t.offered} offered`);
  if (!reveal) {
    if (t.next) add('next', `${t.next} next in line`);
    if (t.ask) add('ask', t.ask === 1 ? '1 question for you' : `${t.ask} questions for you`);
    if (t.nothistime) add('nothistime', `${t.nothistime} not this time`);
    return items;
  }
  const closed = isClosed(run.outcome);
  if (t.next) add('next', `${t.next} ${closed ? 'accepted, not offered' : 'accepted, next in line'}`);
  if (t.passed) add('nothistime', `${t.passed} passed`);
  if (t.ask) add('ask', t.ask === 1 ? '1 question' : `${t.ask} questions`);
  if (t.declined) {
    const known = DECLINE_CODES.filter((k) => codes.get(k)).map((k) => `${CODE_LABEL[k] ?? k} ${codes.get(k)}`);
    const other = [...codes.entries()].filter(([k]) => !DECLINE_CODES.includes(k as ReasonCode)).reduce((n, [, v]) => n + v, 0);
    if (other) known.push(`other ${other}`);
    add('declined', `${t.declined} declined (${known.join(' · ')})`);
  }
  if (t.na) add('na', `${t.na} not available (${[nas.at_cap ? `${nas.at_cap} at their monthly cap` : '', nas.paused ? `${nas.paused} paused` : ''].filter(Boolean).join(' · ')})`);
  if (t.failed) add('failed', `${t.failed} not checked`);
  return items;
}

export function waffleLabel(items: readonly LegendItem[], total: number): string {
  return `${total} members: ${items.map((i) => i.text).join(', ')}`;
}

/** The popover line for one cell when the reveal is on (“m-7f2a · Mexico City · accepted · cited “…” · cap 1 of 2 used”). */
export function cellDetail(run: SampleRun, pos: number, liveOff: boolean): string {
  const c = cellAt(run, pos);
  if (!c) return 'checking';
  const view = cellView(run, pos, true);
  const closed = isClosed(run.outcome);
  let verdict: string;
  switch (view) {
    case 'offered':
      verdict = run.outcome === 'intro' ? 'accepted · offered · said OK' : run.outcome === 'answered' || run.outcome === 'closed' ? 'accepted · offered · answered in 2 lines' : 'accepted · offered';
      break;
    case 'passed':
      verdict = run.outcome === 'withdrawn' && run.offered[run.offered.length - 1] === pos ? 'accepted · offered · withdrawn' : 'accepted · offered · passed (a No stays private)';
      break;
    case 'next':
      verdict = closed ? (run.outcome === 'failed-closed' ? 'accepted · not offered, too many gates failed' : 'accepted · not offered before the ask closed') : 'accepted · next in line';
      break;
    case 'ask':
      verdict = `question: “${c.question?.text ?? ''}”`;
      break;
    case 'na':
      verdict = `not available: ${c.na === 'paused' ? 'paused' : 'at their monthly cap'} · skipped by SQL`;
      break;
    case 'failed':
      verdict = c.you && liveOff ? 'not checked: live checks are off on this instance' : 'not checked: no answer, never an accept';
      break;
    default:
      verdict = `declined · ${CODE_LABEL[c.reason_code ?? 'topic'] ?? c.reason_code ?? 'topic'}`;
  }
  const bits = [c.you ? 'You' : c.label, c.you ? 'your rules' : c.city, verdict];
  if ((view === 'offered' || view === 'next' || view === 'passed') && c.cited) bits.push(`cited “${c.cited}”`);
  if (view !== 'na' && c.ms !== null) bits.push(`${c.ms.toLocaleString('en-US')} ms`);
  const used = c.used + (run.offered.includes(pos) ? 1 : 0);
  bits.push(c.na === 'paused' ? 'paused' : `cap ${used} of ${c.cap} used`);
  return bits.join(' · ');
}

/* ---------- the stream's result → the outcome ---------- */

/** The outcome when the fan-out finished (`done` arrived). */
export function outcomeAfterDone(run: SampleRun): SampleOutcome {
  if (run.done?.failed_closed) return 'failed-closed';
  if (run.offer && run.offered.length) {
    const holder = cellAt(run, run.offered[0] as number);
    return run.offer.to === 'you' || holder?.you ? 'offered-you' : 'offered';
  }
  if (askingCells(run) || pendingQuestions(run).length) return 'question';
  if (run.cells.some((c) => c && c.state === 'accept')) return 'lost';
  return 'no-match';
}

/** The tab's own steps after the fan-out (the sample loop, a No, a withdrawal). Pure: returns the next run. */
export function moveOn(run: SampleRun, now: number): SampleRun {
  const next = rankAccepts(run.cells, run.offered)[0];
  if (next === undefined) return { ...run, outcome: 'closed-all-passed', closed_at: now };
  return { ...run, outcome: 'moved-on', offered: [...run.offered, next], offered_at: now };
}

export type LoopAction = { action: 'ok' | 'answer' | 'no'; at: number; text: string | null };

/** Applies what happened on /o/sample (oti.sampleOffer) to a waiting ask, once. */
export function applyLoop(run: SampleRun, loop: LoopAction, now: number): SampleRun {
  if (!isWaiting(run.outcome) || (run.loop_at !== null && loop.at <= run.loop_at)) return run;
  const base = { ...run, loop_at: loop.at };
  if (loop.action === 'ok') return { ...base, outcome: 'intro', closed_at: now };
  if (loop.action === 'answer') return { ...base, outcome: 'answered', member_answer: (loop.text ?? '').trim() || null };
  return moveOn(base, now);
}

/** Applies BE2's rerun result for an answered question (only the gates that asked changed). */
export function applyAnswer(run: SampleRun, question: SampleQuestion, text: string, result: { reran: number; accepted: number; cells: FanoutCellEventSample[]; offer: FanoutOfferEvent | null }, now: number): SampleRun {
  const cells = run.cells.slice();
  for (const c of result.cells) if (c.cell >= 0 && c.cell < cells.length) cells[c.cell] = { ...c, at: cells[c.cell]?.at ?? null };
  let next: SampleRun = {
    ...run,
    cells,
    answers: [...run.answers, { qid: question.qid, question: { type: question.type, text: question.text }, text, reran: result.reran, accepted: result.accepted, offer: !!result.offer && !run.offered.length, you: youAsked(run, question) }],
  };
  if (result.offer && !run.offered.length) {
    const pos = typeof result.offer.cell === 'number' ? result.offer.cell : rankAccepts(cells)[0];
    if (pos !== undefined) {
      const offeredAt = Number.isNaN(Date.parse(result.offer.expires_at)) ? now : Date.parse(result.offer.expires_at) - OFFER_WINDOW_MS;
      next = { ...next, offer: { ...result.offer, at: null }, offered: [pos], offered_at: offeredAt };
    }
  }
  if (next.outcome === 'question') {
    if (next.offered.length) next = { ...next, outcome: cellAt(next, next.offered[0] as number)?.you ? 'offered-you' : 'offered' };
    else if (!pendingQuestions(next).length && !askingCells(next)) next = { ...next, outcome: next.cells.some((c) => c?.state === 'accept') ? 'lost' : 'no-match' };
  }
  return next;
}

/** “Why: topic 26 · stage 4 · other 10.” over the whole network; SQL skips and buckets under 3 fold into other. */
export function whyLine(run: SampleRun): string {
  const counts = new Map<string, number>();
  let other = 0;
  for (const c of run.cells) {
    if (!c) continue;
    if (c.state === 'decline' && c.reason_code && ['topic', 'stage', 'proof', 'region'].includes(c.reason_code)) counts.set(c.reason_code, (counts.get(c.reason_code) ?? 0) + 1);
    else if (c.state !== 'accept' && c.state !== 'ask_back') other++;
  }
  const bits: string[] = [];
  for (const k of ['topic', 'stage', 'proof', 'region']) {
    const v = counts.get(k) ?? 0;
    if (v >= 3) bits.push(`${k} ${v}`);
    else other += v;
  }
  if (other) bits.push(`other ${other}`);
  return `Why: ${bits.join(' · ')}.`;
}

/* ---------- labels ---------- */

/** Where the 39 (or 40) results came from, by source (docs/CONTRACT.md §e.11). */
export function sourceLine(run: SampleRun, liveOff: boolean): string {
  const you = youCell(run);
  const members = you ? 39 : 40;
  const src = run.example ? 'authored' : run.plan?.sample_source;
  if (src === 'live') return `${members === 40 ? 'All 40' : '39'} sample members’ gates ran live on your ask${you ? ', with your gate' : ''}`;
  const base =
    src === 'model'
      ? `${members} recorded sample members (${recordedDay(run.plan?.recorded_at ?? null)}, replayed at recorded speed)`
      : members === 39
        ? AUTHORED_FANOUT_LABEL
        : AUTHORED_FANOUT_LABEL.replace('39 sample members', '40 sample members');
  if (!you) return base;
  if (run.example) return `${base} + your gate (an example verdict in this QA state)`;
  return `${base} + your gate (${you.state === 'failed' && liveOff ? 'not checked: live checks are off on this instance' : 'live'})`;
}

function recordedDay(iso: string | null): string {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'earlier' : `${d.toLocaleString('en-US', { month: 'short', timeZone: 'America/Mexico_City' })} ${d.toLocaleString('en-US', { day: 'numeric', timeZone: 'America/Mexico_City' })}`;
}

/** The member's name for the intro copy (fictional sample names exist only for members an offer can reach). */
export function memberName(cell: SampleCell | null): { name: string; line: string } | null {
  if (!cell || cell.you) return null;
  const n = SAMPLE_MEMBER_NAMES[cell.label];
  return n ? { name: n.name, line: lower1(stripEnd(n.line)) } : null;
}

/* ---------- the raw trace ---------- */

export type TracePart = string | { tone: 'ok' | 'wait' | 'no' | 'attn' | 'dim'; text: string };
export interface TraceRow {
  at: number;
  parts: TracePart[];
}

function verdictWord(c: SampleCell): TracePart[] {
  if (c.state === 'accept') return [{ tone: 'ok', text: 'accept' }, c.cited ? ` · cited “${c.cited}”` : ''];
  if (c.state === 'ask_back') return [{ tone: 'wait', text: 'ask_back' }, ` ${c.question?.type ?? ''}`];
  if (c.state === 'failed') return [{ tone: 'no', text: 'not checked' }, ' · never an accept'];
  return [`decline ${c.reason_code ?? 'topic'}`];
}

export function traceRows(run: SampleRun, reveal: boolean, replyBy: (ms: number) => string, words: number, liveOff = false): TraceRow[] {
  const L: TraceRow[] = [];
  const total = run.plan?.total ?? run.cells.length;
  const at = (n: number | null | undefined) => (typeof n === 'number' && n >= 0 ? n : 0);
  L.push({ at: 0, parts: [`ask ${run.id} · compiled 5/5 · ${words} words · SAMPLE network · ${total} members`] });
  const you = youCell(run);
  const src = run.example ? 'authored' : run.plan?.sample_source;
  // Your gate is live unless live checks are off here (then it never ran: not checked).
  const yours = !you ? '' : run.example ? ' + your gate (an example verdict)' : you.state === 'failed' && liveOff ? ' + your gate (not run: live checks are off)' : ' + your gate live';
  L.push({
    at: 0,
    parts: [
      src === 'live'
        ? `live ${you ? 'gates for 39 sample members + your gate' : 'gates for 40 sample members'}`
        : src === 'model'
          ? `replay ${you ? 39 : 40} recorded sample members (${recordedDay(run.plan?.recorded_at ?? null)})${yours}`
          : `${you ? 39 : 40} sample members from hand-written examples (not a model run)${yours}`,
    ],
  });
  const cells = run.cells.map((c, pos) => (c ? { c, pos } : null)).filter((x): x is { c: SampleCell; pos: number } => !!x);
  const skipped = cells.filter((x) => x.c.state === 'na');
  if (reveal) {
    for (const { c } of [...cells].sort((a, b) => at(a.c.at) - at(b.c.at) || a.pos - b.pos)) {
      if (c.you) continue;
      if (c.state === 'na') L.push({ at: at(c.at), parts: [`sql skip ${c.label} ${c.na ?? 'at_cap'}`] });
      else L.push({ at: at(c.at), parts: [`gate ${c.label} `, ...verdictWord(c)] });
    }
  } else if (skipped.length) {
    L.push({ at: Math.min(...skipped.map((x) => at(x.c.at))), parts: [`sql skip ${skipped.length} members before any model call`] });
  }
  if (you) {
    const off = you.state === 'failed' && liveOff;
    L.push({ at: at(you.at), parts: off ? ['your gate ', { tone: 'no', text: 'not checked' }, ' · live checks are off on this instance'] : ['your gate ', ...verdictWord(you), you.cited && you.state === 'accept' ? ' · found in your rules' : ''] });
  }
  if (run.done) {
    const fails = run.done.gates_failed;
    L.push({ at: at(run.done.at), parts: [`gates done${fails ? ` · ${fails} failed, counted as not checked` : ''}`] });
  }
  if (run.offer && run.offered.length) {
    const first = cellAt(run, run.offered[0] as number);
    const t = at(run.offer.at ?? run.done?.at);
    const firstOfferedAt = Number.isNaN(Date.parse(run.offer.expires_at)) ? null : Date.parse(run.offer.expires_at) - OFFER_WINDOW_MS;
    L.push({ at: t, parts: [`offered to ${first?.you ? 'you' : '1 person'} · reply window ends ${firstOfferedAt === null ? '—' : replyBy(firstOfferedAt + OFFER_WINDOW_MS)}`] });
    L.push({ at: t, parts: [{ tone: 'attn', text: `people interrupted ${run.offered.length > 0 ? 1 : 0}` }] });
  } else if (run.done && !run.done.failed_closed && run.outcome !== 'question') {
    L.push({ at: at(run.done.at), parts: ['nothing offered'] });
    L.push({ at: at(run.done.at), parts: ['people interrupted 0'] });
  } else if (run.done?.failed_closed) {
    L.push({ at: at(run.done.at), parts: [{ tone: 'no', text: 'nothing offered' }, ' · more than 1 in 5 gates failed'] });
  }
  return L.sort((a, b) => a.at - b.at);
}

/* ========================================================================== *
 * QA examples (?state=…): canonical SAMPLE data, labelled as hand-written, never stored
 * ========================================================================== */

function exampleYou(sa: SampleNetworkAsk, pg: PlaygroundStore | null, force: boolean): SampleCell | null {
  const rules = pg && typeof pg.rules === 'string' && pg.rules.trim() ? pg.rules : force ? presetById(sa.preset).rules : null;
  if (!rules) return null;
  const cap = pg && pg.rules.trim() ? Math.max(1, Math.round(pg.cap) || 2) : 2;
  const gate = PRESET_RECORDINGS.runs[sa.preset].gates.find((g) => g.ask_id === sa.based_on);
  const presetRules = presetById(sa.preset).rules;
  const quotes = (gate?.cited ?? []).map((c) => (c.found && typeof c.start === 'number' ? presetRules.slice(c.start, c.end) : c.text));
  const ranges = quotes.map((qt) => findClause(rules, qt));
  const base = { cell: -1, you: true, label: 'You', city: 'your rules', ms: null, cap, used: 0, na: null, source: 'authored' as const, at: null };
  if (!gate || !ranges.length || ranges.some((r) => !r)) return { ...base, state: 'decline', reason_code: 'no_rule', cited: null, question: null };
  const r = ranges[0] as { start: number; end: number };
  const cited = rules.slice(r.start, r.end);
  if (sa.youAskBack) return { ...base, state: 'ask_back', reason_code: 'proof', cited, question: { type: sa.youAskBack.type, text: sa.youAskBack.text } };
  return { ...base, state: 'accept', reason_code: 'match', cited, question: null };
}

function exampleFiller(sa: SampleNetworkAsk): SampleCell {
  return { cell: -1, state: 'decline', you: false, label: `m-${hex4(`${sa.id}:fill`)}`, city: 'Monterrey', reason_code: 'topic', cited: null, question: null, ms: null, cap: 2, used: 1, na: null, source: 'authored', at: null };
}

/** The canonical fan-out of a sample ask as cells by position (39 authored members + your gate or a filler). */
export function exampleCells(sa: SampleNetworkAsk, you: SampleCell | null): SampleCell[] {
  const rows: SampleCell[] = SAMPLE_FANOUTS[sa.id].map((r) => ({
    cell: -1,
    state: r.state,
    you: false,
    label: r.label,
    city: r.city,
    reason_code: r.reason_code,
    cited: r.cited,
    question: r.question,
    ms: null,
    cap: r.cap,
    used: r.used,
    na: r.na,
    source: 'authored',
    at: null,
  }));
  rows.push(you ?? exampleFiller(sa));
  const order = shuffled(NETWORK_TOTAL, hash32(sa.id));
  const byPos: SampleCell[] = new Array(NETWORK_TOTAL);
  rows.forEach((c, i) => {
    const pos = order[i] as number;
    byPos[pos] = { ...c, cell: pos };
  });
  return byPos;
}

/**
 * Question events for the ask_back cells, one per question type (as BE2's stream sends them): the visitor's own
 * gate's wording leads, else the first by position; `gates` counts every gate that asked that type.
 */
export function questionsFromCells(cells: readonly (SampleCell | null)[], id: string): SampleQuestion[] {
  const by = new Map<GateQuestion['type'], SampleQuestion & { you: boolean; pos: number }>();
  for (const c of cells) {
    if (!c || c.state !== 'ask_back' || !c.question) continue;
    const cur = by.get(c.question.type);
    if (!cur) by.set(c.question.type, { qid: `q_${hex4(`${id}:${c.question.type}`)}`, type: c.question.type, text: c.question.text, gates: 1, at: null, you: c.you, pos: c.cell });
    else {
      cur.gates++;
      if (c.you || (!cur.you && c.cell < cur.pos)) Object.assign(cur, { text: c.question.text, you: c.you, pos: c.cell });
    }
  }
  return [...by.values()].sort((a, b) => Number(b.you) - Number(a.you) || a.pos - b.pos).map(({ you: _you, pos: _pos, ...q }) => q);
}

/** The example SampleAsk for a canonical id, keeping the subject and parts of the sample ask. */
export function exampleCompiled(sa: SampleNetworkAsk): CompiledAsk {
  const a = askByKey(sa.based_on);
  const parts = Object.fromEntries(sa.compiledPartial.map((p) => [p.key, p.state === 'missing' ? (p.sample ?? '') : p.text])) as unknown as CompiledAsk['parts'];
  return { parts, subject: sa.subject, text: sa.complete, price: null, topic: a?.topic ?? null };
}

export function emptyRun(init: Pick<SampleRun, 'id' | 'preset' | 'sample_ask_id' | 'text' | 'compiled' | 'you' | 'sent_at'>, example = false): SampleRun {
  return {
    v: 1,
    ...init,
    outcome: 'ready',
    plan: null,
    cells: new Array(NETWORK_TOTAL).fill(null),
    questions: [],
    offer: null,
    done: null,
    offered: [],
    offered_at: null,
    answers: [],
    member_answer: null,
    loop_at: null,
    withdrawn_at: null,
    closed_at: null,
    refusal: null,
    example,
  };
}

/**
 * A QA state on a canonical sample ask (prototype a.js `applyOutcome`), from the authored fan-out. Example data:
 * `example: true`, labelled hand-written, rendered at once, never stored or sent.
 */
export function exampleRun(id: SampleNetworkAskId, state: QaState<'askStatus'>, pg: PlaygroundStore | null, now: number): SampleRun {
  const sa = sampleNetworkAskById(id) ?? SAMPLE_NETWORK_ASKS.engineer;
  // “offered-you” is about your own gate: without playground rules it uses the preset's rules (an example verdict).
  const forceYou = state === 'offered-you';
  const you = exampleYou(sa, pg, forceYou);
  let cells: SampleCell[] = exampleCells(sa, you);
  const run = emptyRun({ id: sa.id, preset: sa.preset, sample_ask_id: sa.id, text: sa.complete, compiled: exampleCompiled(sa), you: you ? { rules: pg?.rules ?? presetById(sa.preset).rules, cap: you.cap } : null, sent_at: now }, true);
  const byPos = (a: SampleCell, b: SampleCell) => a.cell - b.cell;
  const gateCells = () => cells.filter((c) => c.state !== 'na').sort(byPos);
  const setState = (c: SampleCell, patch: Partial<SampleCell>) => {
    cells = cells.map((x) => (x.cell === c.cell ? { ...x, ...patch } : x));
  };
  const forceAccepts = (n: number) => {
    const acc = rankAccepts(cells).map((p) => cells[p] as SampleCell);
    if (acc.length > n) acc.slice(n).forEach((c) => setState(c, { state: 'decline', reason_code: 'topic' }));
    else {
      const pool = [...cells.filter((c) => c.state === 'ask_back' && !c.you).sort(byPos), ...cells.filter((c) => c.state === 'decline' && !c.you).sort(byPos)];
      for (let k = acc.length; k < n && pool.length; k++) {
        const c = pool.shift() as SampleCell;
        const m = SAMPLE_MEMBERS.find((x) => x.label === c.label);
        setState(c, { state: 'accept', reason_code: 'match', question: null, cited: c.cited ?? (m ? m.rules.split('. ')[0]?.replace(/\.$/, '') ?? null : null) });
      }
    }
  };
  if (state === 'streaming') {
    // Frozen mid-stream: 21 of 40 answered, in a fixed order.
    const keep = new Set(shuffled(NETWORK_TOTAL, hash32(`${sa.id}:stream`)).slice(0, 21));
    return { ...run, outcome: 'streaming', plan: { ask_id: sa.id, network: 'sample', total: NETWORK_TOTAL, sample_source: 'authored' }, cells: cells.map((c) => (keep.has(c.cell) ? c : null)) };
  }
  if (state === 'no-match') {
    gateCells().forEach((c, i) => setState(c, { state: 'decline', reason_code: i < 26 ? 'topic' : i < 30 ? 'stage' : i < 32 ? 'proof' : 'region', question: null, cited: null }));
  }
  if (state === 'failed-closed') {
    cells.filter((c) => c.state === 'decline' && !c.you).sort(byPos).slice(0, 9).forEach((c) => setState(c, { state: 'failed', reason_code: null }));
  }
  if (state === 'partial-failure') {
    cells.filter((c) => c.state === 'decline' && !c.you).sort(byPos).slice(0, 2).forEach((c) => setState(c, { state: 'failed', reason_code: null }));
  }
  if (state === 'moved-on' || state === 'closed-all-passed') forceAccepts(3);
  if (state === 'expired-deadline') forceAccepts(2);
  const ran = cells.filter((c) => c.state !== 'na').length;
  const failed = cells.filter((c) => c.state === 'failed').length;
  const questions = questionsFromCells(cells, sa.id);
  const done = { wall_ms: 0, people_interrupted: 0, counts: { offered: 0, next: 0, question: 0, nothistime: 0 }, gates_ran: ran, gates_failed: failed, failed_closed: state === 'failed-closed', at: null };
  let next: SampleRun = { ...run, plan: { ask_id: sa.id, network: 'sample', total: NETWORK_TOTAL, sample_source: 'authored' }, cells, questions, done };
  if (state === 'no-match') return { ...next, outcome: 'no-match' };
  if (state === 'failed-closed') return { ...next, outcome: 'failed-closed' };
  // The first holder: the best accept; in the plain “offered” state a sample member (your gate waits in line).
  const ranked = rankAccepts(cells);
  const memberFirst = state === 'offered' ? [...ranked.filter((p) => !cells[p]?.you), ...ranked.filter((p) => cells[p]?.you)] : ranked;
  const n = state === 'moved-on' ? 2 : state === 'closed-all-passed' ? 3 : state === 'expired-deadline' ? 2 : 1;
  const offered = memberFirst.slice(0, n);
  if (!offered.length) return { ...next, outcome: questions.length ? 'question' : 'no-match' };
  next = {
    ...next,
    offered,
    offered_at: now,
    offer: { expires_at: new Date(now + OFFER_WINDOW_MS).toISOString(), to: cells[offered[0] as number]?.you ? 'you' : 'member', cell: offered[0], at: null },
  };
  const firstYou = !!cells[offered[0] as number]?.you;
  switch (state) {
    case 'offered':
    case 'partial-failure':
    case 'ask-back':
      return { ...next, outcome: firstYou ? 'offered-you' : 'offered' };
    case 'offered-you':
      return { ...next, outcome: firstYou ? 'offered-you' : 'offered' };
    case 'answered':
      return { ...next, outcome: 'answered', member_answer: sa.answeredSample };
    case 'intro':
      return { ...next, outcome: 'intro', closed_at: now };
    case 'moved-on':
      return { ...next, outcome: 'moved-on' };
    case 'closed-all-passed':
      return { ...next, outcome: 'closed-all-passed', closed_at: now };
    case 'expired-deadline':
      return { ...next, outcome: 'expired-deadline', closed_at: now };
    case 'withdrawn':
      return { ...next, outcome: 'withdrawn', withdrawn_at: now };
    default:
      return { ...next, outcome: firstYou ? 'offered-you' : 'offered' };
  }
}

/** “3 people were offered it” helper for copy. */
export function offeredCount(run: SampleRun): string {
  return plural(run.offered.length, 'person', 'people');
}

/* ========================================================================== *
 * REAL: the four asker states from the serializer
 * ========================================================================== */

export function realCellClass(s: AskerCellState): CellClass {
  return s === 'question' ? 'ask' : s;
}

export function realLegend(cells: readonly AskerCellState[]): LegendItem[] {
  const t = { offered: 0, next: 0, question: 0, nothistime: 0 };
  for (const c of cells) t[c]++;
  const items: LegendItem[] = [];
  if (t.offered) items.push({ state: 'offered', text: `${t.offered} offered` });
  if (t.next) items.push({ state: 'next', text: `${t.next} next in line` });
  if (t.question) items.push({ state: 'ask', text: t.question === 1 ? '1 question for you' : `${t.question} questions for you` });
  if (t.nothistime) items.push({ state: 'nothistime', text: `${t.nothistime} not this time` });
  return items;
}

/** “+2104 ms  gates done” → the dim time column and the rest (the serializer's lines). */
export function splitTraceLine(line: string): { time: string | null; rest: string } {
  const m = /^(\+\d+\s*ms\s+)(.*)$/.exec(line);
  return m ? { time: m[1] as string, rest: m[2] as string } : { time: null, rest: line };
}

/**
 * The REAL view for the QA state `real` (Lucía's fictional hospital ask from lib/sample, offered Mon Nov 9, 21:04
 * CST): example data for layout, shown next to a dashed note, never fetched or sent.
 */
export function exampleRealView(): import('@/lib/types').AskerAskView {
  const a = askByKey('a02');
  const order = shuffled(NETWORK_TOTAL, hash32('a_91x'));
  const cells: AskerCellState[] = new Array(NETWORK_TOTAL).fill('nothistime');
  cells[order[0] as number] = 'offered';
  cells[order[1] as number] = 'next';
  cells[order[2] as number] = 'next';
  const parts = a ? a.parts : { challenge: '', tried: '', needs: '', by: '', offers: '' };
  const text = a?.text ?? '';
  return {
    id: 'a_91x',
    network: 'real',
    subject: a?.subject ?? 'Hospital procurement in Mexico, 20 min?',
    compiled: { parts, subject: a?.subject ?? '', text, price: null, topic: a?.topic ?? null },
    sent_at: OFFER_SAMPLE.sent_iso,
    outcome: 'offered',
    as_of: OFFER_SAMPLE.sent_iso,
    next_checkpoint: '2026-11-10T09:00:00-06:00',
    cells,
    people_interrupted: 1,
    gates_failed: 0,
    offered: { reply_by: OFFER_SAMPLE.reply_by_iso, position: 1, in_line: 3 },
    questions: [],
    matched_line: null,
    answer: null,
    intro: null,
    no_match: null,
    closed: null,
    withdrawn_at: null,
    trace: [
      `+0 ms     ask a_91x · compiled 5/5 · ${text.trim().split(/\s+/).filter(Boolean).length} words · REAL network · ${NETWORK_TOTAL} members`,
      '+2104 ms  gates done',
      '+2110 ms  offered to 1 person · reply window ends Thu Nov 12, 21:04 CST',
      '+2110 ms  people interrupted 1',
    ],
  };
}

/** The coarse reasons line for a REAL no-match (already folded by the serializer). */
export function realWhyLine(why: Partial<Record<'topic' | 'stage' | 'proof' | 'region', number>> & { other: number }): string {
  const bits = (['topic', 'stage', 'proof', 'region'] as const).filter((k) => (why[k] ?? 0) > 0).map((k) => `${k} ${why[k]}`);
  if (why.other > 0) bits.push(`other ${why.other}`);
  return `Why: ${bits.join(' · ')}.`;
}
