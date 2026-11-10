/**
 * `/rules` (“Be asked”) · the pure model: runs, display verdicts, counts, the plain outcome each row shows, the
 * chain inside Details and the sort at done. No DOM, React or network, so every rule here is unit-tested
 * (tests/playground).
 *
 * Honesty rules applied here (docs/CONTRACT.md §e):
 * - Each verdict carries its source: `live` (a model call in this tab), `recorded` (a model recording),
 *   `authored` (hand-written example) or `fixture` (a QA state's example data). Only `live` and `recorded` rows
 *   are ever called “model”; only they show latency.
 * - The limit is applied in the browser with `applyCap`, so its step says “(code)”, never “(Postgres)”.
 * - Quoted words are always the member's own text at the offsets code found (`rules.slice(start, end)`).
 */

import { applyCap, type DisplayVerdict } from '@/lib/oti/cap';
import { checkQuotes } from '@/lib/oti/clause';
import { GATE_FAILURE_COPY, INJECTION_RESISTED, INVESTOR_FLAG, NO_LINE_COVERS } from '@/lib/oti/copy';
import { fmtMs, plural } from '@/lib/oti/text';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import type { SampleAsk } from '@/lib/sample/types';
import type { CitedQuote, DecidedBy, GateErrorKind, GateFlag, GateQuestion, PresetId, ReasonCode, SampleAskKey, Verdict } from '@/lib/types';

/* ------------------------------------------------------------------ *
 * The 12 asks
 * ------------------------------------------------------------------ */

export const ASKS: readonly SampleAsk[] = SAMPLE_ASKS;
export const TOTAL = SAMPLE_ASKS.length;
export const ASK_IDS: readonly SampleAskKey[] = SAMPLE_ASKS.map((a) => a.id);

const BY_ID = new Map<SampleAskKey, SampleAsk>(SAMPLE_ASKS.map((a) => [a.id, a]));
const INDEX = new Map<SampleAskKey, number>(SAMPLE_ASKS.map((a, i) => [a.id, i]));

export function askOf(id: SampleAskKey): SampleAsk {
  return BY_ID.get(id) as SampleAsk;
}
export function indexOf(id: SampleAskKey): number {
  return INDEX.get(id) ?? -1;
}
export function isAskId(id: unknown): id is SampleAskKey {
  return typeof id === 'string' && BY_ID.has(id as SampleAskKey);
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

/** Where one row's verdict came from (see the file header). */
export type RowSource = 'live' | 'recorded' | 'authored' | 'fixture';

/** Where a whole run came from: what its meta line says. */
export type RunSource = 'live' | 'recorded' | 'authored' | 'fixture';

/** One gate's result as the playground keeps it: the `gate` event shape, with the wider row source. */
export interface RowGate {
  i: number;
  ask_id: SampleAskKey;
  verdict: Verdict;
  model_verdict: Verdict;
  cited: CitedQuote[];
  decided_by: DecidedBy;
  reason_code: ReasonCode;
  reason: string;
  question: GateQuestion | null;
  flags: GateFlag[];
  confidence: number | null;
  ms: number | null;
  source: RowSource;
}

export interface RowError {
  kind: GateErrorKind;
  retry_after_s?: number;
}

export interface Run {
  id: string;
  /** The store's mode: `recorded` for a preset file (authored or model), `live` for /api/try and QA fixtures. */
  mode: 'live' | 'recorded';
  source: RunSource;
  /** The rules this run checked (cited offsets index this text). */
  rules: string;
  preset: PresetId;
  gates: Partial<Record<SampleAskKey, RowGate>>;
  errors: Partial<Record<SampleAskKey, RowError>>;
  wall_ms: number | null;
  cost_usd: number | null;
  /** When the visitor ran it (ISO). */
  ran_at: string;
}

export function cloneRun(run: Run): Run {
  return { ...run, gates: { ...run.gates }, errors: { ...run.errors } };
}

/** True for verdicts a model returned (a live call or a model recording). */
export function isModelSource(source: RowSource | RunSource): boolean {
  return source === 'live' || source === 'recorded';
}

/**
 * The clause check, run again in this tab on a gate's quotes: every quote must be one contiguous span of `rules`
 * (lib/oti/clause.ts, the same function the server runs). A quote that isn't there turns the verdict into a decline
 * by code, whatever the input said.
 */
export function checkGate(gate: RowGate, rules: string): RowGate {
  const cited = checkQuotes(
    rules,
    gate.cited.map((c) => c.text),
  );
  const missing = cited.some((c) => !c.found);
  return {
    ...gate,
    cited,
    decided_by: missing ? 'clause_check' : gate.decided_by,
    verdict: missing ? 'decline' : gate.verdict,
  };
}

/**
 * Keeps the server's offsets for a live gate when they point at the quoted words in `rules`; otherwise finds them
 * again with the same clause finder. A found quote always renders the member's own words.
 */
export function normalizeLiveGate(gate: RowGate, rules: string): RowGate {
  const ok = gate.cited.every((c) => !c.found || (typeof c.start === 'number' && typeof c.end === 'number' && c.start >= 0 && c.end <= rules.length && c.end > c.start));
  if (!ok) return checkGate(gate, rules);
  // The server already declines a quote it couldn't find; the same rule holds here, whatever the event says.
  if (gate.cited.some((c) => !c.found) && gate.decided_by !== 'clause_check') return { ...gate, decided_by: 'clause_check', verdict: 'decline' };
  return gate;
}

/* ------------------------------------------------------------------ *
 * Display verdicts (ux-spec S1, applyCap)
 * ------------------------------------------------------------------ */

export interface RowDisplay {
  display: DisplayVerdict;
  /** 1-based position among the accepts that reach you (“cap 1 of 2”). */
  pos?: number;
  gate: RowGate | null;
  error: RowError | null;
}

export type DisplayMap = Record<SampleAskKey, RowDisplay>;

export interface Displays {
  map: DisplayMap;
  /** Arrival days of the accepts that reached you (“your cap of 2 was used on day 2 and day 4”). */
  reachDays: number[];
}

/** Display verdicts in arrival order. `provisional` while streaming: see applyCap. */
export function computeDisplays(run: Run | null, pending: readonly SampleAskKey[], cap: number, provisional: boolean): Displays {
  const pend = new Set(pending);
  const rows = ASKS.map((a) => {
    const g = run?.gates[a.id];
    const e = run?.errors[a.id];
    return {
      ask_id: a.id,
      day: a.day,
      gate: g ? { verdict: g.verdict, decided_by: g.decided_by } : null,
      error: e ? e.kind : null,
      pending: pend.has(a.id),
    };
  });
  const { results, reachDays } = applyCap(rows, cap, provisional);
  const map = {} as DisplayMap;
  ASKS.forEach((a, i) => {
    const r = results[i] as { display: DisplayVerdict; pos?: number };
    map[a.id] = { display: r.display, pos: r.pos, gate: run?.gates[a.id] ?? null, error: run?.errors[a.id] ?? null };
  });
  return { map, reachDays };
}

export interface Counts extends Record<DisplayVerdict, number> {
  declined: number;
  notChecked: number;
  checked: number;
}

export function countDisplays(map: DisplayMap): Counts {
  const c: Record<DisplayVerdict, number> = { reach: 0, held: 0, ask: 0, decline: 0, code: 0, failed: 0, checking: 0, notrun: 0 };
  for (const id of ASK_IDS) c[map[id].display]++;
  return { ...c, declined: c.decline + c.code, notChecked: c.failed + c.notrun, checked: TOTAL - c.failed - c.notrun - c.checking };
}

export function isResolved(d: DisplayVerdict): boolean {
  return d !== 'notrun' && d !== 'checking';
}

/* ------------------------------------------------------------------ *
 * Row copy: one of three plain outcomes
 * ------------------------------------------------------------------ */

const FAILURE_SHORT: Record<GateErrorKind, string> = {
  timeout: 'no answer in 6 s',
  rate_limited: 'rate-limited',
  overloaded: 'overloaded',
  budget: 'paused for the model budget',
  refused: 'refused to evaluate',
  parse: 'answer didn’t parse',
};

/** The extra sentence a flagged decline carries. */
export function flagLine(flags: readonly GateFlag[]): string | null {
  if (flags.includes('asker_not_founder')) return INVESTOR_FLAG;
  if (flags.includes('instruction_in_ask')) return INJECTION_RESISTED;
  return null;
}

/** The member's own words for each found quote (never the model's copy). */
export function ownQuotes(cited: readonly CitedQuote[], rules: string): string[] {
  return cited.filter((c) => c.found && typeof c.start === 'number' && typeof c.end === 'number').map((c) => rules.slice(c.start, c.end));
}

/** The words on a row: the three outcomes, the limit, and the two states that aren't an outcome yet. */
export const OUTCOME_LABEL = {
  reach: 'Reaches you',
  limit: 'Matches, but you’re at your limit this month',
  question: 'They’d be asked a question first',
  no: 'Not for you',
  failed: 'Not checked',
  checking: 'Checking…',
} as const;

export const QUOTE_NOT_IN_RULES = 'The model quoted words that aren’t in your rules, so code turned it into a no.';

/**
 * What a row says under the ask, in plain words. `quotes` are the member's own lines the gate matched (shown
 * quoted); `text` is the one short reason or the question.
 */
export type Outcome =
  | { kind: 'idle' }
  | { kind: 'checking'; label: string }
  | { kind: 'reach' | 'limit'; label: string; quotes: string[] }
  | { kind: 'question'; label: string; text: string }
  | { kind: 'no'; label: string; text: string | null; quotes: string[] }
  | { kind: 'failed'; label: string; text: string };

export function outcomeOf(d: RowDisplay, rules: string): Outcome {
  const g = d.gate;
  switch (d.display) {
    case 'notrun':
      return { kind: 'idle' };
    case 'checking':
      return { kind: 'checking', label: OUTCOME_LABEL.checking };
    case 'reach':
      return { kind: 'reach', label: OUTCOME_LABEL.reach, quotes: g ? ownQuotes(g.cited, rules) : [] };
    case 'held':
      return { kind: 'limit', label: OUTCOME_LABEL.limit, quotes: g ? ownQuotes(g.cited, rules) : [] };
    case 'ask':
      return { kind: 'question', label: OUTCOME_LABEL.question, text: g?.question?.text ?? '' };
    case 'decline': {
      const quotes = g ? ownQuotes(g.cited, rules) : [];
      const flag = g ? flagLine(g.flags) : null;
      // One short reason: the member's own line when the gate quoted one, else the flag, else “no line covers it”.
      return { kind: 'no', label: OUTCOME_LABEL.no, text: quotes.length ? null : (flag ?? NO_LINE_COVERS), quotes };
    }
    case 'code':
      return { kind: 'no', label: OUTCOME_LABEL.no, text: g ? QUOTE_NOT_IN_RULES : GATE_FAILURE_COPY[d.error?.kind ?? 'parse'], quotes: [] };
    case 'failed':
      return { kind: 'failed', label: OUTCOME_LABEL.failed, text: GATE_FAILURE_COPY[d.error?.kind ?? 'timeout'] };
  }
}

/** “3 would reach you · 9 filtered out”: the one sentence above the rows after a run. */
export function summaryLine(c: Counts): string {
  const parts = [`${c.reach} would reach you`];
  if (c.held) parts.push(`${c.held} over your limit`);
  if (c.ask) parts.push(`${c.ask} question first`);
  if (c.declined) parts.push(`${c.declined} filtered out`);
  if (c.notChecked) parts.push(`${c.notChecked} not checked`);
  return parts.join(' · ');
}

/** Who made the first call, as the chain names it. Hand-written rows never say “model”. */
function chainWho(source: RowSource): string {
  return isModelSource(source) ? 'model' : 'example';
}

function quoteCount(cited: readonly CitedQuote[]): { n: number; found: number } {
  return { n: cited.length, found: cited.filter((c) => c.found).length };
}

/**
 * The decided-by chain inside a row's Details (12 px mono): “model accept → code 2 of 2 quotes found → cap 1 of 2”.
 * Empty for rows that are not resolved.
 */
export function chainText(d: RowDisplay, cap: number): string {
  if (!isResolved(d.display)) return '';
  if (d.display === 'failed') return `model: ${FAILURE_SHORT[d.error?.kind ?? 'timeout']} → not checked, never an accept`;
  const g = d.gate;
  if (!g) return `model ${FAILURE_SHORT[d.error?.kind ?? 'parse']} → code declined it`;
  const { n, found } = quoteCount(g.cited);
  const model = `${chainWho(g.source)} ${g.model_verdict}`;
  const code = n ? `code ${found} of ${n} ${n === 1 ? 'quote' : 'quotes'} found` : 'code: no quote to check';
  const flags = g.flags.length ? ` · flag ${g.flags.join(', ')}` : '';
  switch (d.display) {
    case 'reach':
      return `${model} → ${code} → cap ${d.pos ?? 1} of ${cap}`;
    case 'held':
      return `${model} → ${code} → cap full, ${cap} of ${cap} used`;
    case 'ask':
      return `${model} → ${code} → one question to the founder`;
    case 'decline':
      return `${model} → ${code}${flags}`;
    case 'code':
      return `${model} → ${code} → decline`;
    default:
      return '';
  }
}

/** Details › Why: the gate's own sentence (empty for a row that wasn't checked). */
export function whyText(d: RowDisplay): string {
  return d.gate?.reason ?? '';
}

/** Details › Latency, or null when there is no timing to show (hand-written rows never show one). */
export function latencyText(d: RowDisplay): string | null {
  if (d.display === 'failed') return d.error?.kind === 'timeout' ? 'timed out after 6 s' : null;
  const g = d.gate;
  if (!g) return null;
  if (g.source === 'live') return g.ms !== null ? `${fmtMs(g.ms)} · live` : 'live';
  if (g.source === 'recorded') return g.ms !== null ? `${fmtMs(g.ms)} · recorded` : 'recorded';
  return null;
}

/* ------------------------------------------------------------------ *
 * The sort at done
 * ------------------------------------------------------------------ */

/** reaches you → question first → at your limit → not checked → not for you. */
export function groupOf(id: SampleAskKey, map: DisplayMap): number {
  const v = map[id].display;
  if (v === 'reach') return 0;
  if (v === 'ask') return 1;
  if (v === 'held') return 2;
  if (v === 'failed' || v === 'notrun' || v === 'checking') return 3;
  return 4;
}

/** Each group in arrival order. */
export function sortOrder(map: DisplayMap): SampleAskKey[] {
  return [...ASK_IDS].sort((x, y) => groupOf(x, map) - groupOf(y, map) || askOf(x).day - askOf(y).day);
}

/* ------------------------------------------------------------------ *
 * Small text helpers
 * ------------------------------------------------------------------ */

export function checkingLabel(done: number, total: number): string {
  return `Checking ${done} of ${total}`;
}

export function checkingAnnounce(n: number): string {
  return `Checking ${plural(n, 'ask')}`;
}

/** The one announcement when a run ends. Hand-written and QA verdicts were not checked by a model, so they say so. */
export function summaryAnnounce(c: Counts, model = true): string {
  const tail = `${c.reach} reach you, ${c.held} over your limit, ${c.ask} question first, ${c.declined} filtered out.`;
  return model ? `${c.checked} checked: ${tail}` : `${c.checked} example verdicts: ${tail}`;
}
