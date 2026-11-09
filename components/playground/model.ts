/**
 * S1 playground · the pure model: runs, display verdicts, counts, the copy each row and line shows, the read view,
 * the raw trace and the sort at done. A port of prototype/a.js `Playground()` without DOM, React or network, so
 * every rule here is unit-tested (tests/playground).
 *
 * Honesty rules applied here (docs/CONTRACT.md §e):
 * - Each verdict carries its source: `live` (a model call in this tab), `recorded` (a model recording),
 *   `authored` (hand-written example), `test` (the labelled fake output of “Test the quote check”) or `fixture`
 *   (a QA state's example data). Only `live` and `recorded` rows are ever called “model”; only they show latency.
 * - The cap is applied in the browser with `applyCap`, so its step says “(code)”, never “(Postgres)”.
 * - Cited words are always the member's own text at the offsets code found (`rules.slice(start, end)`).
 */

import { applyCap, DISPLAY_LABEL, type DisplayVerdict } from '@/lib/oti/cap';
import { checkQuotes, readViewLines, ruleLines, type MarkedSegment } from '@/lib/oti/clause';
import { GATE_FAILURE_COPY, INJECTION_RESISTED, INVESTOR_FLAG, NO_LINE_COVERS } from '@/lib/oti/copy';
import { fmtMs, joinAnd, plural, traceTime } from '@/lib/oti/text';
import { SAMPLE_ASKS, TRAP_COUNT } from '@/lib/sample/asks';
import type { SampleAsk } from '@/lib/sample/types';
import type { CitedQuote, DecidedBy, GateErrorKind, GateFlag, GateQuestion, PresetId, ReasonCode, SampleAskKey, Verdict } from '@/lib/types';

/* ------------------------------------------------------------------ *
 * The 12 asks
 * ------------------------------------------------------------------ */

export const ASKS: readonly SampleAsk[] = SAMPLE_ASKS;
export const TOTAL = SAMPLE_ASKS.length;
export const ASK_IDS: readonly SampleAskKey[] = SAMPLE_ASKS.map((a) => a.id);
export const TRAPS = TRAP_COUNT;

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
export type RowSource = 'live' | 'recorded' | 'authored' | 'test' | 'fixture';

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

/** What the raw trace shows, in arrival order. `t` is ms from the start of the run, or null when there is no timing. */
export type TraceEntry =
  | { kind: 'plan'; t: number | null; text: string }
  | { kind: 'gate'; t: number | null; ev: RowGate }
  | { kind: 'error'; t: number | null; id: SampleAskKey; err: RowError }
  | { kind: 'runerror'; t: number | null; err: RowError }
  | { kind: 'lost'; t: number | null; n: number }
  | { kind: 'done'; t: number | null; cost_usd: number | null };

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
  events: TraceEntry[];
  wall_ms: number | null;
  cost_usd: number | null;
  /** When the visitor ran it (ISO). */
  ran_at: string;
}

export function cloneRun(run: Run): Run {
  return { ...run, gates: { ...run.gates }, errors: { ...run.errors }, events: [...run.events] };
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

export const LABEL: Record<DisplayVerdict, string> = DISPLAY_LABEL;

/** Rows a visitor can mark “Disagree” on. */
export const MARKABLE: readonly DisplayVerdict[] = ['reach', 'held', 'ask', 'decline', 'code'];

export function isResolved(d: DisplayVerdict): boolean {
  return d !== 'notrun' && d !== 'checking';
}

/* ------------------------------------------------------------------ *
 * Row copy (ux-spec S1 “Exact row copy by verdict”)
 * ------------------------------------------------------------------ */

export const IN_YOUR_RULES = '✓ in your rules';
export const TEST_LABEL = 'Test of the code check: a fake model output, not a model call.';

const FAILURE_SHORT: Record<GateErrorKind, string> = {
  timeout: 'no answer in 6 s',
  rate_limited: 'rate-limited',
  overloaded: 'overloaded',
  budget: 'paused for the model budget',
  refused: 'refused to evaluate',
  parse: 'answer didn’t parse',
};

const FAILURE_WHY: Record<GateErrorKind, string> = {
  timeout: 'The gate didn’t answer within 6 s, so this ask was not checked.',
  rate_limited: 'The model API rate-limited this check, so this ask was not checked.',
  overloaded: 'The model API was overloaded, so this ask was not checked.',
  budget: 'Live checks were paused for the model budget, so this ask was not checked.',
  refused: GATE_FAILURE_COPY.refused,
  parse: GATE_FAILURE_COPY.parse,
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

export type FootModel =
  | { kind: 'none' }
  /** “Cited” and one quote per line, the last ending “✓ in your rules”; then notes. */
  | { kind: 'cites'; quotes: string[]; notes: string[] }
  | { kind: 'note'; text: string }
  /** Declined by code: the rejected quotes struck through, why, and the test label when it was the quote test. */
  | { kind: 'code'; missing: string[]; note: string; test: boolean };

export function footModel(d: RowDisplay, ctx: { rules: string; cap: number; reachDays: readonly number[] }): FootModel {
  const g = d.gate;
  switch (d.display) {
    case 'reach':
      return g ? { kind: 'cites', quotes: ownQuotes(g.cited, ctx.rules), notes: [] } : { kind: 'none' };
    case 'held':
      return g
        ? {
            kind: 'cites',
            quotes: ownQuotes(g.cited, ctx.rules),
            notes: [`Accepted, but your cap of ${ctx.cap} was used on ${joinAnd(ctx.reachDays.map((x) => `day ${x}`))}.`],
          }
        : { kind: 'none' };
    case 'ask':
      return { kind: 'note', text: `Question first: “${g?.question?.text ?? ''}” Your gate reruns once on the founder’s answer.` };
    case 'decline': {
      if (!g) return { kind: 'none' };
      const quotes = ownQuotes(g.cited, ctx.rules);
      const flag = flagLine(g.flags);
      if (quotes.length) return { kind: 'cites', quotes, notes: flag ? [flag] : [] };
      return { kind: 'note', text: flag ? `${NO_LINE_COVERS} ${flag}` : NO_LINE_COVERS };
    }
    case 'code': {
      if (!g) return { kind: 'note', text: GATE_FAILURE_COPY[d.error?.kind ?? 'parse'] };
      const changed = g.model_verdict === 'accept' ? 'accept to decline.' : g.model_verdict === 'ask_back' ? 'question first to decline.' : 'nothing; still a decline.';
      return {
        kind: 'code',
        missing: g.cited.filter((c) => !c.found).map((c) => c.text),
        note: `Not in your rules, so code changed ${changed}`,
        test: g.source === 'test',
      };
    }
    case 'failed':
      return { kind: 'note', text: GATE_FAILURE_COPY[d.error?.kind ?? 'timeout'] };
    default:
      return { kind: 'none' };
  }
}

/** Who made the first call, as the chain names it. Hand-written rows never say “model”. */
function chainWho(source: RowSource): string {
  if (source === 'test') return 'test output';
  return isModelSource(source) ? 'model' : 'example';
}

function quoteCount(cited: readonly CitedQuote[]): { n: number; found: number } {
  return { n: cited.length, found: cited.filter((c) => c.found).length };
}

/**
 * The decided-by chain on every resolved row (12 px mono): “model accept → code 2 of 2 quotes found → cap 1 of 2”.
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

function factWho(source: RowSource): string {
  if (source === 'test') return 'Test output (not a model call)';
  return isModelSource(source) ? 'Gate (model)' : 'Example verdict (written by hand)';
}

/** The full “Decided by” line in Details. */
export function decidedByText(d: RowDisplay, cap: number): string {
  if (d.display === 'failed') return `Gate (model): ${FAILURE_SHORT[d.error?.kind ?? 'timeout']} → not checked, never an accept`;
  const g = d.gate;
  if (!g) return `Gate (model): ${FAILURE_SHORT[d.error?.kind ?? 'parse']} → decline (code)`;
  const { n, found } = quoteCount(g.cited);
  const who = factWho(g.source);
  const chk = n ? `clause check passed, ${found} of ${n} quotes found (code)` : 'no quote to check (code)';
  switch (d.display) {
    case 'reach':
      return `${who} → ${chk} → cap ${d.pos ?? 1} of ${cap} (code; Postgres enforces the same rule on real offers)`;
    case 'held':
      return `${who} → ${chk} → cap (code)`;
    case 'ask':
      return `${who} → ${chk} → question first`;
    case 'decline':
      return `${who} → ${chk} → decline`;
    case 'code':
      return `${who} → clause check failed, ${found} of ${n} quotes found (code) → decline`;
    default:
      return '';
  }
}

/** Details › Why. */
export function whyText(d: RowDisplay): string {
  if (d.display === 'failed' || (d.display === 'code' && !d.gate)) return FAILURE_WHY[d.error?.kind ?? 'timeout'];
  return d.gate?.reason ?? '';
}

/** Details › Latency, or null when there is no timing to show (hand-written rows never show one). */
export function latencyText(d: RowDisplay): string | null {
  if (d.display === 'failed') return d.error?.kind === 'timeout' ? 'timed out after 6 s' : null;
  const g = d.gate;
  if (!g) return null;
  if (g.source === 'test') return 'test, no model call';
  if (g.source === 'live') return g.ms !== null ? `${fmtMs(g.ms)} · live` : 'live';
  if (g.source === 'recorded') return g.ms !== null ? `${fmtMs(g.ms)} · recorded` : 'recorded';
  return null;
}

/** The row's right-aligned latency on desktop: only for timings that were measured. */
export function asideText(d: RowDisplay): string {
  const g = d.gate;
  if (!g || !isResolved(d.display) || !isModelSource(g.source) || g.ms === null) return '';
  return fmtMs(g.ms);
}

/** Details › Gate output: what the gate returned, before code checked it. */
export function gateOutput(g: RowGate): { summary: string; json: string; note: string } {
  const json = JSON.stringify(
    {
      verdict: g.model_verdict,
      cited: g.cited.map((c) => c.text),
      reason_code: g.reason_code,
      reason: g.reason,
      question: g.question,
      flags: g.flags,
      confidence: g.confidence,
    },
    null,
    2,
  );
  if (g.source === 'test') return { summary: 'Test output (fake, not a model call)', json, note: 'A canned output that quotes words not in your rules, run through the same clause check.' };
  if (!isModelSource(g.source)) return { summary: 'Example output (written by hand, not a model run)', json, note: 'Written by hand to show the output format; it has no confidence.' };
  return { summary: 'Gate output (model)', json, note: 'confidence is model-reported and uncalibrated' };
}

export function arrivedText(ask: SampleAsk): string {
  return `day ${ask.day} of the month · ${ask.stage}`;
}

/** The trap's tell inside the ask, as plain and underlined segments (exact substrings of the ask text). */
export function bodySegments(ask: SampleAsk): { text: string; trap: boolean }[] {
  const t = ask.text;
  const ranges: [number, number][] = [];
  for (const s of ask.trap_spans) {
    const i = t.indexOf(s);
    if (i >= 0) ranges.push([i, i + s.length]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const out: { text: string; trap: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    if (a > pos) out.push({ text: t.slice(pos, a), trap: false });
    out.push({ text: t.slice(a, b), trap: true });
    pos = b;
  }
  if (pos < t.length) out.push({ text: t.slice(pos), trap: false });
  return out;
}

/* ------------------------------------------------------------------ *
 * The list head
 * ------------------------------------------------------------------ */

export function trapsCaught(map: DisplayMap): number {
  return ASKS.filter((a) => a.trap && (map[a.id].display === 'decline' || map[a.id].display === 'code')).length;
}

export interface QuoteCheck {
  quotes: number;
  missing: number;
}

export function quoteCheck(map: DisplayMap): QuoteCheck {
  let quotes = 0;
  let missing = 0;
  for (const id of ASK_IDS) {
    for (const c of map[id].gate?.cited ?? []) {
      quotes++;
      if (!c.found) missing++;
    }
  }
  return { quotes, missing };
}

/** “every quote found in your rules” · “1 quote not in your rules, changed to a decline” · “no quotes to check”. */
export function quoteLine(qc: QuoteCheck): string {
  if (qc.missing) return qc.missing === 1 ? '1 quote not in your rules, changed to a decline' : `${qc.missing} quotes not in your rules, changed to declines`;
  return qc.quotes ? 'every quote found in your rules' : 'no quotes to check';
}

/** Gates that answered (a gate event arrived). */
export function answered(run: Run): number {
  return ASK_IDS.filter((id) => run.gates[id]).length;
}

/* ------------------------------------------------------------------ *
 * Read view of the rules (ux-spec S1 “Read view”)
 * ------------------------------------------------------------------ */

export interface ReadLine {
  index: number;
  segments: MarkedSegment[];
  unused: boolean;
  tally: string;
}

export interface ReadView {
  lines: ReadLine[];
  /** Declines that matched no line. */
  nomatch: number;
  /** Quotes code rejected, as the model wrote them. */
  missing: string[];
}

export function readView(run: Run, map: DisplayMap, running: boolean): ReadView {
  const all = ruleLines(run.rules);
  if (running) {
    return { lines: all.map((l) => ({ index: l.index, segments: [{ text: l.text, mark: false }], unused: false, tally: 'checking…' })), nomatch: 0, missing: [] };
  }
  const ranges: { start: number; end: number; keys: string[] }[] = [];
  for (const a of ASKS) {
    for (const c of map[a.id].gate?.cited ?? []) {
      if (c.found && typeof c.start === 'number' && typeof c.end === 'number') ranges.push({ start: c.start, end: c.end, keys: [a.id] });
    }
  }
  const view = readViewLines(run.rules, ranges);
  const lines = view.map((v): ReadLine => {
    const line = all[v.index] as { start: number; end: number };
    const ids: string[] = [];
    for (const r of ranges) if (r.start < line.end && r.end > line.start && !ids.includes(r.keys[0] as string)) ids.push(r.keys[0] as string);
    let letIn = 0;
    let q = 0;
    let out = 0;
    for (const id of ids) {
      const dv = map[id as SampleAskKey].display;
      if (dv === 'reach' || dv === 'held') letIn++;
      else if (dv === 'ask') q++;
      else if (dv === 'decline') out++;
    }
    const parts: string[] = [];
    if (letIn) parts.push(`${letIn} let in`);
    if (q) parts.push(`${q} question`);
    if (out) parts.push(`${out} kept out`);
    return { index: v.index, segments: v.segments, unused: !parts.length, tally: parts.length ? parts.join(' · ') : 'not used by these 12' };
  });
  const nomatch = ASKS.filter((a) => map[a.id].display === 'decline' && !(map[a.id].gate?.cited ?? []).some((c) => c.found)).length;
  const missing: string[] = [];
  for (const a of ASKS) {
    const d = map[a.id];
    if (d.display === 'code') for (const c of d.gate?.cited ?? []) if (!c.found) missing.push(c.text);
  }
  return { lines, nomatch, missing };
}

export function nomatchText(n: number): string {
  return n === 1 ? '1 ask matched no line, so it was declined.' : `${n} asks matched no line, so they were declined.`;
}

export function missingText(missing: readonly string[]): string {
  return missing.map((m) => `Not in your rules: “${m}”`).join(' · ');
}

/* ------------------------------------------------------------------ *
 * The sort at done (ux-spec S1 “Re-sort once on done”)
 * ------------------------------------------------------------------ */

/** reaches you → question first → over your cap → not checked → trap declines → other declines. */
export function groupOf(id: SampleAskKey, map: DisplayMap): number {
  const v = map[id].display;
  if (v === 'reach') return 0;
  if (v === 'ask') return 1;
  if (v === 'held') return 2;
  if (v === 'failed' || v === 'notrun' || v === 'checking') return 3;
  return askOf(id).trap ? 4 : 5;
}

/** Each group in arrival order. */
export function sortOrder(map: DisplayMap): SampleAskKey[] {
  return [...ASK_IDS].sort((x, y) => groupOf(x, map) - groupOf(y, map) || askOf(x).day - askOf(y).day);
}

export interface Divider {
  id: 'pg-g-traps' | 'pg-g-rest';
  before: SampleAskKey;
  text: string;
}

/** “Traps · 4 of 4 caught” before the first trap decline, “No line matched · 4” (or “Other declines · N”) before the rest. */
export function dividers(order: readonly SampleAskKey[], map: DisplayMap): Divider[] {
  const traps = order.filter((id) => groupOf(id, map) === 4);
  const rest = order.filter((id) => groupOf(id, map) === 5);
  const out: Divider[] = [];
  if (traps.length) out.push({ id: 'pg-g-traps', before: traps[0] as SampleAskKey, text: `Traps · ${traps.length} of ${TRAPS} caught` });
  if (rest.length) {
    const noLine = rest.every((id) => map[id].display === 'decline' && !(map[id].gate?.cited ?? []).length);
    out.push({ id: 'pg-g-rest', before: rest[0] as SampleAskKey, text: `${noLine ? 'No line matched' : 'Other declines'} · ${rest.length}` });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Run diff (ux-spec S1 “Run diff”)
 * ------------------------------------------------------------------ */

export interface Snapshot {
  disp: Record<SampleAskKey, DisplayVerdict>;
  rules: string;
  preset: PresetId;
  source: RunSource;
}

export function snapshotOf(run: Run | null, map: DisplayMap | null): Snapshot | null {
  if (!run || !map) return null;
  const disp = {} as Record<SampleAskKey, DisplayVerdict>;
  for (const id of ASK_IDS) disp[id] = map[id].display;
  return { disp, rules: run.rules, preset: run.preset, source: run.source };
}

/** True when `b` is `a` plus exactly one more non-blank line. */
export function addedOneLine(a: string, b: string): boolean {
  const A = a
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const B = b
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (B.length !== A.length + 1) return false;
  const rest = [...B];
  for (const line of A) {
    const k = rest.indexOf(line);
    if (k < 0) return false;
    rest.splice(k, 1);
  }
  return rest.length === 1;
}

export interface RunDiff {
  changed: Partial<Record<SampleAskKey, DisplayVerdict>>;
  /** Rows that flipped on the same rules between two model runs (model variance). */
  variance: SampleAskKey[];
  diff: string | null;
}

/**
 * Compares a finished run with the previous one by ask id. A run on another preset is a fresh start (no diff).
 * Same rules: a flip between two model runs is model variance; against the hand-written examples it is a
 * difference from the examples, never “variance”.
 */
export function runDiff(prev: Snapshot | null, run: Run, map: DisplayMap): RunDiff {
  if (!prev || prev.preset !== run.preset) return { changed: {}, variance: [], diff: null };
  const changed: Partial<Record<SampleAskKey, DisplayVerdict>> = {};
  const names: string[] = [];
  for (const a of ASKS) {
    const was = prev.disp[a.id];
    const now = map[a.id].display;
    if (was && was !== now && !['notrun', 'checking', 'failed'].includes(was) && !['notrun', 'failed'].includes(now)) {
      changed[a.id] = was;
      names.push(a.company);
    }
  }
  const sameRules = prev.rules === run.rules;
  const vsExamples = sameRules && !isModelSource(prev.source) && isModelSource(run.source);
  if (names.length) {
    if (vsExamples) return { changed, variance: [], diff: `${names.length} ${names.length === 1 ? 'differs' : 'differ'} from the hand-written examples: ${joinAnd(names)}.` };
    const variance = sameRules && isModelSource(prev.source) && isModelSource(run.source) ? (Object.keys(changed) as SampleAskKey[]) : [];
    return { changed, variance, diff: `${names.length} changed since your last run: ${joinAnd(names)}.` };
  }
  if (vsExamples) return { changed, variance: [], diff: 'Every verdict matches the hand-written examples.' };
  return { changed, variance: [], diff: `No verdict changed.${addedOneLine(prev.rules, run.rules) ? ' That line did not decide any of these 12 asks.' : ''}` };
}

/* ------------------------------------------------------------------ *
 * The raw trace (ux-spec S1 “Raw trace”)
 * ------------------------------------------------------------------ */

export type TraceTone = 'dim' | 'ok' | 'wait' | 'no' | 'attn';
export interface TraceSeg {
  text: string;
  tone?: TraceTone;
}
export interface TraceRow {
  /** The padded time column (“+1290 ms  ”), or null when the run has no timing. */
  time: string | null;
  segs: TraceSeg[];
}

/**
 * Every gate line is followed by what code did with its quotes and, for accepts, what the cap did. Model runs sort
 * by time; runs without timing keep arrival order and drop the time column.
 */
export function traceRows(run: Run, map: DisplayMap, cap: number, reachDays: readonly number[]): TraceRow[] {
  type Line = { t: number | null; order: number; segs: TraceSeg[] };
  const lines: Line[] = [];
  let order = 0;
  const push = (t: number | null, segs: TraceSeg[]) => lines.push({ t, order: order++, segs });
  const company = (id: SampleAskKey) => askOf(id).company;
  const num = (id: SampleAskKey) => `#${indexOf(id) + 1}`;

  const gateLine = (ev: RowGate, t: number | null, test: boolean) => {
    const who = `${num(ev.ask_id)} ${company(ev.ask_id)} `;
    const segs: TraceSeg[] = [{ text: test ? 'test  ' : 'gate  ' }, { text: who }];
    if (ev.model_verdict === 'accept') segs.push({ text: 'accept', tone: 'ok' });
    else if (ev.model_verdict === 'ask_back') segs.push({ text: 'ask_back', tone: 'wait' }, { text: ` ${ev.question?.type ?? ''}` });
    else segs.push({ text: `decline · ${ev.reason_code}${ev.flags.length ? ` · flag ${ev.flags.join(', ')}` : ''}` });
    if (test) segs.push({ text: ' · fake model output, not a model call' });
    push(t, segs);
    const { n, found } = quoteCount(ev.cited);
    if (n) {
      const segsC: TraceSeg[] = [{ text: `check ${num(ev.ask_id)} quotes ` }];
      if (found === n) segsC.push({ text: `${found}/${n} found` });
      else segsC.push({ text: `${found}/${n} found`, tone: 'no' }, { text: ' · declined by code' });
      segsC.push({ text: ' ' }, { text: '(code)', tone: 'dim' });
      push(t === null ? null : t + 1, segsC);
    }
  };

  for (const e of run.events) {
    if (e.kind === 'plan') push(e.t, [{ text: `plan  ${e.text}` }]);
    else if (e.kind === 'gate') {
      gateLine(e.ev, e.t, false);
      // The quote test swaps one row's output after the run: the trace keeps the real gate line, then shows the test.
      const current = run.gates[e.ev.ask_id];
      const d = map[e.ev.ask_id];
      if (current && current.source === 'test') gateLine(current, e.t === null ? null : e.t + 2, true);
      else if (d.display === 'reach' || d.display === 'held') {
        const segs: TraceSeg[] = [{ text: `cap   ${num(e.ev.ask_id)} ` }];
        if (d.display === 'reach') segs.push({ text: 'reach', tone: 'attn' }, { text: ` · ${d.pos ?? 1} of ${cap}` });
        else segs.push({ text: `over_cap · used ${reachDays.map((x) => `day ${x}`).join(', ')}` });
        segs.push({ text: ' ' }, { text: '(code)', tone: 'dim' });
        push(e.t === null ? null : e.t + 2, segs);
      }
    } else if (e.kind === 'error') {
      const k = e.err.kind;
      const tail = k === 'refused' || k === 'parse' ? ' · declined by code' : ' · not checked, never an accept';
      push(e.t, [{ text: `error ${num(e.id)} ${company(e.id)} ` }, { text: k === 'timeout' ? 'timeout' : k, tone: 'no' }, { text: `${k === 'timeout' ? ' after 6 s' : ''}${tail}` }]);
    } else if (e.kind === 'runerror') {
      push(e.t, [{ text: 'error ' }, { text: e.err.kind, tone: 'no' }, { text: ' · the gates still waiting were not checked, never an accept' }]);
    } else if (e.kind === 'lost') {
      push(e.t, [{ text: 'lost', tone: 'no' }, { text: `  stream closed after ${e.n} of ${TOTAL} gates · retry asks only for the missing ${TOTAL - e.n}` }]);
    } else if (e.kind === 'done') {
      let acc = 0;
      let ab = 0;
      let dec = 0;
      let fail = 0;
      for (const id of ASK_IDS) {
        const g = run.gates[id];
        const er = run.errors[id];
        if (er) {
          if (er.kind === 'refused' || er.kind === 'parse') dec++;
          else fail++;
        } else if (g) {
          if (g.verdict === 'accept') acc++;
          else if (g.verdict === 'ask_back') ab++;
          else dec++;
        } else fail++;
      }
      let cost = '';
      if (run.source === 'fixture') cost = ' · QA fixture, no model cost';
      else if (isModelSource(run.source) && e.cost_usd !== null) cost = ` · $${e.cost_usd.toFixed(4)}`;
      push(e.t, [{ text: `done  ${acc} accept · ${ab} ask_back · ${dec} decline · ${fail} failed${cost}` }]);
    }
  }

  const timed = isModelSource(run.source) && lines.every((l) => l.t !== null);
  if (timed) lines.sort((x, y) => (x.t as number) - (y.t as number) || x.order - y.order);
  return lines.map((l) => ({ time: timed ? traceTime(l.t as number) : null, segs: l.segs }));
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
  const tail = `${c.reach} reach you, ${c.held} over your cap, ${c.ask} question first, ${c.declined} declined.`;
  return model ? `${c.checked} checked: ${tail}` : `${c.checked} example verdicts: ${tail}`;
}
