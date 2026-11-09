/**
 * The board's view model (S7, ux-spec S7): pure functions from what the database and the eval file say to every
 * string /board prints. No React, no server-only imports, so the page (server) and the QA examples (client) share
 * it, and tests read it directly.
 *
 * Rules this file enforces (ux-spec S7, docs/CONTRACT.md §e):
 * - Every number has its denominator, and every number carries its definition: the SQL it comes from
 *   (`public.board_snapshot()`), shown as a title on desktop and under “How this is counted” at every width.
 * - A denominator under 20 adds one “Small samples: n < 20.” note under its section heading, never one per row.
 * - Below 3 useful outcomes the headline never shows a ratio.
 * - A demand topic is listed only with 3 or more different founders (SQL already filters; checked again here).
 * - The board never shows a member's rules, an ask, or a name. The clause-check example is SAMPLE data, run
 *   through the real clause finder and labelled as a fake model output.
 * - The median time to answer an offer needs 3 answered offers, so one member's answer time is never on a
 *   public page by itself (the same threshold of 3 the asker serializer uses for reasons).
 * - Eval numbers come only from data/eval/heldout-summary.json with `source: "eval"`; otherwise “No eval run yet”.
 */

import { checkQuotes } from '@/lib/oti/clause';
import { CAP_CHOICES } from '@/lib/oti/cap';
import { fmtDay, NETWORK_TZ, zonedParts } from '@/lib/oti/time';
import { fmtN, plural } from '@/lib/oti/text';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import { COST } from '@/lib/sample/cost';
import { PRESETS } from '@/lib/sample/presets';
import { CLAUSE_CHECK_TEST_OUTPUT } from '@/lib/sample/verdicts';
import type { EvalSummary, Verdict } from '@/lib/types';
import { BOARD_COPY } from './copy';
import { fmtUsdAbout, fmtUsdConst } from './format';

/* ========================================================================== *
 * The snapshot (public.board_snapshot(), supabase/migrations/0001_init.sql)
 * ========================================================================== */

export interface DemandTopic {
  topic: string;
  asks: number;
  /** Asks on this topic that reached a person. */
  reached: number;
  /** Distinct founders who asked about it (always ≥ 3 when listed). */
  askers: number;
}

/** Every number the board prints, as `public.board_snapshot()` returns it. Times are ISO strings. */
export interface BoardSnapshot {
  /** The instant the counts describe. */
  as_of: string;
  /** The first member_joined fact, or null before anyone joined. */
  since: string | null;
  members_with_rules: number;
  asks_sent: number;
  compile_refused: number;
  gate_checks: number;
  gate_checks_stopped: number;
  gate_reruns: number;
  /** Gate checks code overruled (`decided_by = 'clause_check'`): a quote not in the rules, no quote, or a broken question. */
  quotes_not_found: number;
  asks_reached_person: number;
  /** Offers delivered: each used a cap slot, including passes and expiries. */
  interrupted: number;
  offers_ok: number;
  offers_answered: number;
  offers_passed: number;
  offers_expired: number;
  intros: number;
  d1_answered: number;
  calls_happened: number;
  useful: number;
  d14_answered: number;
  median_hours_to_answer: number | null;
  offers_answered_count: number;
  offers_per_member_max: number;
  offers_per_member_median: number;
  cap_overruns: number;
  members_paused: number;
  members_deleted: number;
  playground_runs: number;
  playground_gate_calls: number;
  sample_asks_sent: number;
  demand: DemandTopic[];
  demand_other_asks: number;
}

const COUNT_KEYS = [
  'members_with_rules', 'asks_sent', 'compile_refused', 'gate_checks', 'gate_checks_stopped', 'gate_reruns', 'quotes_not_found',
  'asks_reached_person', 'interrupted', 'offers_ok', 'offers_answered', 'offers_passed', 'offers_expired', 'intros', 'd1_answered',
  'calls_happened', 'useful', 'd14_answered', 'offers_answered_count', 'offers_per_member_max', 'offers_per_member_median',
  'cap_overruns', 'members_paused', 'members_deleted', 'playground_runs', 'playground_gate_calls', 'sample_asks_sent',
  'demand_other_asks',
] as const satisfies readonly (keyof BoardSnapshot)[];

/** bigint counts arrive as JSON numbers; percentile_cont as a double; a numeric string is accepted too. */
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isoOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return undefined;
  return new Date(v).toISOString();
}

/**
 * Validates the jsonb `board_snapshot()` returns. Returns null when a count is missing or not a number: the board
 * then says it can't read the counts, rather than print a 0 that was never counted.
 */
export function parseBoardSnapshot(raw: unknown): BoardSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const asOf = isoOrNull(o.as_of);
  const since = isoOrNull(o.since ?? null);
  if (!asOf || since === undefined) return null;
  const out: Record<string, unknown> = { as_of: asOf, since };
  for (const key of COUNT_KEYS) {
    const n = num(o[key]);
    if (n === null) return null;
    out[key] = n;
  }
  const median = o.median_hours_to_answer;
  out.median_hours_to_answer = median === null || median === undefined ? null : num(median);
  if (!Array.isArray(o.demand)) return null;
  const demand: DemandTopic[] = [];
  for (const d of o.demand) {
    if (!d || typeof d !== 'object') return null;
    const t = d as Record<string, unknown>;
    const asks = num(t.asks);
    const reached = num(t.reached);
    const askers = num(t.askers);
    if (typeof t.topic !== 'string' || !t.topic.trim() || asks === null || reached === null || askers === null) return null;
    demand.push({ topic: t.topic.trim(), asks, reached, askers });
  }
  out.demand = demand;
  return out as unknown as BoardSnapshot;
}

/* ========================================================================== *
 * The view
 * ========================================================================== */

/** A run of text; numbers carry their definition as a title, some are bold. */
export interface Seg {
  text: string;
  title?: string;
  strong?: boolean;
}
export type Line = (string | Seg)[];

export interface StatRow {
  label: string;
  value: string;
  note: string;
  /** The SQL definition (title on the value, and a row under “How this is counted”). */
  def: string;
  /** The denominator, when the value is “x of n”: under 20 it is a small sample. */
  den: number | null;
}

export type Headline = { kind: 'ratio'; ratio: string; ratioTitle: string; line: Line } | { kind: 'text'; line: Line };

export interface DemandRow {
  topic: string;
  line: Line;
}

export interface EvalMissView {
  caseType: string;
  where: string;
  ask: string;
  rules: string;
  expected: string;
  got: string;
  cited: string[];
}

export interface EvalView {
  state: 'none' | 'ran';
  header: string;
  note: string | null;
  runLabels: string[];
  rows: { label: string; n: number; runs: number[]; baseline: number }[];
  totals: { n: number; runs: number[]; baseline: number } | null;
  errors: string | null;
  missesSummary: string | null;
  misses: EvalMissView[];
}

export interface ClauseExampleView {
  company: string;
  what: string;
  quoted: { text: string; found: boolean }[];
  found: number;
  total: number;
  change: string;
}

export interface BoardView {
  /** `counts`: numbers from the database. `not_configured`: no database on this instance. `db_down`: none readable. */
  mode: 'counts' | 'not_configured' | 'db_down';
  /** QA example numbers (rendered only with an explicit ?state=, next to the dashed prototype note). */
  example: boolean;
  lede: string;
  /** “Nov 10, 14:02”: what the stale notice says the counts are from. */
  updated: string | null;
  /** The QA [stale] state; live pages learn it from /api/health on the client. */
  stale: boolean;
  /** A designed notice above the sections (database down with no counts to show). */
  notice: string | null;
  /** Null when there is nothing to put in the headline panel (database down). */
  headline: Headline | null;
  headlineDef: string;
  /** Funnel, protection, demand, clause check and playground render only with counts. */
  sections: boolean;
  funnel: StatRow[];
  funnelSmall: boolean;
  protection: StatRow[];
  protectionSmall: boolean;
  /** “How this is counted”: one entry per number, then the notes. */
  defs: { label: string; def: string }[];
  defsNotes: string[];
  demand: { rows: DemandRow[]; other: Line | null; empty: string | null };
  eval: EvalView;
  clause: { line: Line };
  clauseExample: ClauseExampleView;
  playground: Line;
}

/* ---------- copy and definitions ---------- */

export { BOARD_COPY };

/** The SQL each number comes from (public.board_snapshot(); facts live in the append-only `audit` table). */
export const DEFS = {
  members: 'count(*) from members where a rules row exists',
  asks: "count(*) from audit where action = 'ask_sent'",
  refused: "count(*) from audit where action = 'compile_refused'",
  checks: "count(*) from audit where action = 'gate_checked': one per member per ask after SQL skips, plus reruns",
  reruns: "count(*) from audit where action = 'gate_checked' and detail->>'attempt' = '2'",
  reached: "count(distinct ask_id) from audit where action = 'offer_delivered' ÷ asks sent",
  interrupted: "count(*) from audit where action = 'offer_delivered'",
  ok: "count(*) from audit where action = 'offer_ok' ÷ offers delivered",
  answered: "count(*) from audit where action = 'offer_answered' ÷ offers delivered",
  calls: "count(distinct ask_id) from audit where action = 'checkin_answered' and detail->>'kind' = 'd1' and detail ? 'rating' ÷ count(distinct ask_id) from audit where action = 'intro_made'",
  d1: "count(distinct ask_id) from audit where action = 'checkin_answered' and detail->>'kind' = 'd1'",
  useful: "count(distinct ask_id) rated 4–5 at +1 day (detail->>'rating') or with a +14 day outcome other than 'nothing_yet' ÷ intros",
  d14: "count(distinct ask_id) from audit where action = 'checkin_answered' and detail->>'kind' = 'd14' and detail->>'role' = 'asker' ÷ intros",
  stopped: "count(*) from audit where action = 'gate_checked' and detail->>'verdict' <> 'accept' ÷ gate checks",
  perMember:
    "median and max, over members with rules, of count(*) from audit where action = 'offer_delivered' since the 1st of the month in Mexico City, per member",
  overruns: 'count(*) of (member, month) pairs in offers with more offers than that member’s cap',
  overruled: "count(*) from audit where action = 'gate_checked' and detail->>'decided_by' = 'clause_check' ÷ gate checks",
  median: "percentile_cont(0.5) of (answered at − delivered at) over audit 'offer_ok', 'offer_answered' and 'offer_passed'",
  pausedDeleted: "count(*) from members where status = 'paused' · count(*) from audit where action = 'member_deleted'",
  usefulOutcomes:
    "count(distinct ask_id) from audit 'checkin_answered' where (kind = 'd1' and rating >= 4) or (kind = 'd14' and outcome <> 'nothing_yet')",
  ratio: 'people interrupted ÷ useful outcomes',
  demandAsks: "count(*) from audit where action = 'ask_sent' and detail->>'topic' = this topic",
  demandAskers: 'count(distinct asker_id) of those asks (a topic is listed only at 3 or more)',
  demandNobody: "asks on this topic with no 'offer_delivered' fact",
  demandOther: 'count(*) of asks whose topic has fewer than 3 distinct askers',
  playRuns: "count(*) from audit where action = 'playground_run'",
  playCalls: "sum((detail->>'gates')::int) from audit where action = 'playground_run'",
  playRules: 'Playground rules are never written to the database: there is no table for them',
  playAsks: "count(*) from audit where action = 'sample_ask_sent'",
} as const;

/* ---------- formatting ---------- */

/** “Nov 10, 14:02 CST” in the network's zone (server pages pass NETWORK_TZ; so do QA examples). */
export function fmtUpdated(iso: string, tz: string = NETWORK_TZ, withZone = true): string {
  const ms = Date.parse(iso);
  const p = zonedParts(ms, tz);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${p.monthShort} ${p.day}, ${hh}:${mm}${withZone ? ` ${p.zone}` : ''}`;
}

/** “Nov 9, 2026”. */
export function fmtSince(iso: string, tz: string = NETWORK_TZ): string {
  const ms = Date.parse(iso);
  return `${fmtDay(ms, tz)}, ${zonedParts(ms, tz).year}`;
}

/** 3.1 → “3.1 h”; 0.4 → “24 min”; 26.4 → “26 h”. */
export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`;
}

/** 0 → “0”, 0.5 → “0.5”, 2 → “2”. */
function fmtStat(n: number): string {
  return Number.isInteger(n) ? fmtN(n) : n.toFixed(1);
}

export { fmtUsdAbout, fmtUsdConst };

/** “7 of 11 offers” (unit pluralised by the denominator); a 0 denominator prints the count alone. */
export function frac(n: number, den: number, unit = ''): string {
  if (den <= 0) return fmtN(n);
  const u = unit ? ` ${den === 1 ? unit.replace(/s$/, '') : unit}` : '';
  return `${fmtN(n)} of ${fmtN(den)}${u}`;
}

function isSmall(rows: readonly StatRow[]): boolean {
  return rows.some((r) => r.den !== null && r.den > 0 && r.den < 20);
}

/* ---------- sections ---------- */

function funnelRows(s: BoardSnapshot): StatRow[] {
  const bound = s.asks_sent * s.members_with_rules + s.gate_reruns;
  const checksNote =
    s.asks_sent === 0
      ? ''
      : s.gate_checks <= bound
        ? `at most ${fmtN(s.asks_sent)} ${s.asks_sent === 1 ? 'ask' : 'asks'} × ${fmtN(s.members_with_rules)} ${s.members_with_rules === 1 ? 'member' : 'members'}, plus ${plural(s.gate_reruns, 'rerun')}`
        : `one per member per ask after SQL skips, plus ${plural(s.gate_reruns, 'rerun')}`;
  return [
    { label: 'Members with rules', value: fmtN(s.members_with_rules), note: '', def: DEFS.members, den: null },
    { label: 'Asks sent', value: fmtN(s.asks_sent), note: s.compile_refused ? `+${fmtN(s.compile_refused)} refused by the compiler` : '', def: `${DEFS.asks}; refused: ${DEFS.refused}`, den: null },
    { label: 'Gate checks', value: fmtN(s.gate_checks), note: checksNote, def: DEFS.checks, den: null },
    { label: 'Asks that reached a person', value: frac(s.asks_reached_person, s.asks_sent), note: '', def: DEFS.reached, den: s.asks_sent },
    { label: 'People interrupted (offers delivered)', value: fmtN(s.interrupted), note: 'includes passes and expiries', def: DEFS.interrupted, den: null },
    { label: 'OK to intro', value: frac(s.offers_ok, s.interrupted, 'offers'), note: '', def: DEFS.ok, den: s.interrupted },
    { label: 'Answered in 2 lines', value: frac(s.offers_answered, s.interrupted, 'offers'), note: '', def: DEFS.answered, den: s.interrupted },
    {
      label: 'Call happened',
      value: frac(s.calls_happened, s.intros, 'intros'),
      note: s.intros ? `${frac(s.d1_answered, s.intros)} answered the +1 day check-in` : '',
      def: `${DEFS.calls}; answered: ${DEFS.d1}`,
      den: s.intros,
    },
    { label: 'Useful outcomes', value: frac(s.useful, s.intros, 'intros'), note: 'rated 4–5 at +1 day, or a +14 day outcome', def: DEFS.useful, den: s.intros },
    { label: '+14 day outcomes', value: frac(s.d14_answered, s.intros, 'intros'), note: 'the founder is asked 14 days after the intro', def: DEFS.d14, den: s.intros },
  ];
}

function protectionRows(s: BoardSnapshot): StatRow[] {
  const medianShown = s.offers_answered_count >= 3 && s.median_hours_to_answer !== null;
  return [
    { label: 'Gate checks that stopped an ask', value: frac(s.gate_checks_stopped, s.gate_checks), note: '', def: DEFS.stopped, den: s.gate_checks },
    {
      label: 'Offers per member this month',
      value: `median ${fmtStat(s.offers_per_member_median)} · max ${fmtStat(s.offers_per_member_max)}`,
      note: `each member sets a cap of ${CAP_CHOICES[0]} to ${CAP_CHOICES[CAP_CHOICES.length - 1]}`,
      def: DEFS.perMember,
      den: null,
    },
    { label: 'Cap overruns', value: fmtN(s.cap_overruns), note: 'tested by npm run race: 20 concurrent asks, 1 free slot', def: DEFS.overruns, den: null },
    { label: 'Verdicts overruled by code', value: frac(s.quotes_not_found, s.gate_checks), note: s.quotes_not_found === 1 ? 'declined by code' : 'each declined by code', def: DEFS.overruled, den: s.gate_checks },
    {
      label: 'Median time to answer an offer',
      value: medianShown ? fmtHours(s.median_hours_to_answer as number) : '—',
      note: medianShown ? `${plural(s.offers_answered_count, 'offer')} answered` : 'shown from 3 answered offers',
      def: DEFS.median,
      den: null,
    },
    { label: 'Members who paused · deleted', value: `${fmtN(s.members_paused)} · ${fmtN(s.members_deleted)}`, note: '', def: DEFS.pausedDeleted, den: null },
  ];
}

function headlineOf(s: BoardSnapshot): Headline {
  const people: Seg = { text: plural(s.interrupted, 'person', 'people'), title: DEFS.interrupted };
  const useful: Seg = { text: plural(s.useful, 'useful outcome'), title: DEFS.usefulOutcomes };
  if (s.intros === 0 && s.interrupted === 0) return { kind: 'text', line: [BOARD_COPY.noIntros] };
  if (s.useful < 3) return { kind: 'text', line: ['Not enough outcomes yet: ', people, ' interrupted, ', useful, ' so far.'] };
  return {
    kind: 'ratio',
    ratio: (s.interrupted / s.useful).toFixed(1),
    ratioTitle: DEFS.ratio,
    line: [people, ' interrupted ÷ ', useful],
  };
}

function headlineDef(s: BoardSnapshot | null): string {
  return s && s.interrupted < 20 ? `${BOARD_COPY.headlineDef} ${BOARD_COPY.headlineSmall}` : BOARD_COPY.headlineDef;
}

function demandOf(s: BoardSnapshot): BoardView['demand'] {
  // SQL lists a topic only with 3+ distinct askers; filtering again here keeps the rule if the SQL ever changes.
  const listed = s.demand.filter((d) => d.askers >= 3);
  const rows: DemandRow[] = listed.map((d) => ({
    topic: d.topic,
    line: [
      { text: plural(d.asks, 'ask'), title: DEFS.demandAsks },
      ' from ',
      { text: plural(d.askers, 'founder'), title: DEFS.demandAskers },
      ' · ',
      { text: frac(d.asks - d.reached, d.asks), strong: true, title: DEFS.demandNobody },
      ' reached nobody',
    ],
  }));
  const other: Line | null =
    rows.length || s.demand_other_asks ? ['Other topics (fewer than 3 founders each): ', { text: plural(s.demand_other_asks, 'ask'), title: DEFS.demandOther }] : null;
  return { rows, other, empty: rows.length ? null : BOARD_COPY.demandEmpty };
}

function clauseLine(s: BoardSnapshot): Line {
  if (!s.gate_checks) return [BOARD_COPY.noVerdicts];
  return [
    { text: fmtN(s.quotes_not_found), title: "count(*) from audit where action = 'gate_checked' and detail->>'decided_by' = 'clause_check'" },
    ' of ',
    { text: fmtN(s.gate_checks), title: "count(*) from audit where action = 'gate_checked'" },
    ' gate verdicts didn’t pass the code check (a quote not in the member’s rules, no quote, or a question outside the rules), so code declined ',
    s.quotes_not_found === 1 ? 'it.' : s.quotes_not_found === 2 ? 'both.' : 'each one.',
  ];
}

function playgroundLine(s: BoardSnapshot): Line {
  return [
    { text: plural(s.playground_runs, 'playground run'), title: DEFS.playRuns },
    ' · ',
    { text: plural(s.playground_gate_calls, 'live gate call'), title: DEFS.playCalls },
    ` (about ${fmtUsdAbout(s.playground_gate_calls * COST.perGate)} at ${fmtUsdConst(COST.perGate)} a call) · `,
    { text: '0 rules stored', title: DEFS.playRules },
    ' · ',
    { text: plural(s.sample_asks_sent, 'sample ask'), title: DEFS.playAsks },
    ' sent',
  ];
}

/* ---------- the eval (data/eval/heldout-summary.json) ---------- */

const VERDICT_WORD: Record<Verdict | 'not_checked', string> = {
  accept: 'accept',
  decline: 'decline',
  ask_back: 'question first',
  not_checked: 'not checked',
};

function runsWhere(idx: number[]): string {
  const ns = idx.map((i) => String(i + 1));
  if (ns.length === 1) return `run ${ns[0]}`;
  return `runs ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/** “1 · 0 · 1 (baseline 4)”. */
function perRun(x: { runs: number[]; baseline: number }): string {
  return `${x.runs.map((n) => fmtN(n)).join(' · ')} (baseline ${fmtN(x.baseline)})`;
}

export function evalView(summary: EvalSummary): EvalView {
  if (summary.source !== 'eval' || !summary.rows.length) {
    return { state: 'none', header: BOARD_COPY.evalNone, note: BOARD_COPY.evalNoneNote, runLabels: [], rows: [], totals: null, errors: null, missesSummary: null, misses: [] };
  }
  const runs = Math.max(...summary.rows.map((r) => r.runs.length), summary.totals?.runs.length ?? 0);
  const misses: EvalMissView[] = summary.misses.map((m) => {
    const wrong = m.actual.map((a, i) => (a !== m.expected ? i : -1)).filter((i) => i >= 0);
    const got = [...new Set(wrong.map((i) => VERDICT_WORD[m.actual[i] as Verdict | 'not_checked']))];
    const label = summary.rows.find((r) => r.case_type === m.case_type)?.label ?? m.case_type;
    return { caseType: label, where: runsWhere(wrong), ask: m.ask, rules: m.rules_excerpt, expected: VERDICT_WORD[m.expected], got: got.join(' or '), cited: m.cited };
  });
  const missCount = summary.misses.reduce((n, m) => n + m.actual.filter((a) => a !== m.expected).length, 0);
  const errors =
    summary.wrongly_let_through && summary.wrongly_blocked
      ? `Wrongly let through: ${perRun(summary.wrongly_let_through)}. Wrongly blocked: ${perRun(summary.wrongly_blocked)}.`
      : null;
  return {
    state: 'ran',
    header: summary.header ?? `${summary.totals?.n ?? 0} held-out cases · ${summary.model ?? ''}`.trim(),
    note: null,
    runLabels: Array.from({ length: runs }, (_, i) => `Run ${i + 1}`),
    rows: summary.rows.map((r) => ({ label: r.label, n: r.n, runs: r.runs, baseline: r.baseline })),
    totals: summary.totals,
    errors,
    missesSummary: misses.length
      ? `See the ${plural(misses.length, 'case')} missed (${plural(missCount, 'miss', 'misses')} across ${plural(runs, 'run')})`
      : null,
    misses,
  };
}

/* ---------- the SAMPLE clause-check example (real clause finder, fake model output) ---------- */

export function clauseExample(): ClauseExampleView {
  const t = CLAUSE_CHECK_TEST_OUTPUT;
  const rules = PRESETS.find((p) => p.id === 'engineer')?.rules ?? '';
  const ask = SAMPLE_ASKS.find((a) => a.id === t.ask_id);
  const cited = checkQuotes(rules, t.cited);
  const found = cited.filter((c) => c.found).length;
  return {
    company: ask?.company ?? 'Mezquite Health',
    what: 'the ask told the gate what to quote',
    quoted: cited.map((c) => ({ text: c.text, found: c.found })),
    found,
    total: cited.length,
    change: found === cited.length ? `${t.verdict} (kept)` : `${t.verdict} → decline (code)`,
  };
}

/* ---------- the whole board ---------- */

export interface BoardInput {
  snapshot: BoardSnapshot;
  /** `checkpoint`: counts as of the last 09:00 / 21:00 checkpoint; `read`: as of the moment they were read. */
  asOfKind: 'checkpoint' | 'read';
  evalSummary: EvalSummary;
  tz?: string;
  example?: boolean;
  stale?: boolean;
}

function defsOf(funnel: StatRow[], protection: StatRow[]): { label: string; def: string }[] {
  return [...funnel, ...protection].map((r) => ({ label: r.label, def: r.def }));
}

export function boardView(input: BoardInput): BoardView {
  const { snapshot: s, evalSummary, tz = NETWORK_TZ } = input;
  const funnel = funnelRows(s);
  const protection = protectionRows(s);
  const updated = fmtUpdated(s.as_of, tz);
  const since = s.since ? `Real counts since ${fmtSince(s.since, tz)}. ` : 'Real counts. ';
  return {
    mode: 'counts',
    example: Boolean(input.example),
    lede: `${since}${BOARD_COPY.denominators} Last update ${updated}.`,
    updated: fmtUpdated(s.as_of, tz, false),
    stale: Boolean(input.stale),
    notice: null,
    headline: headlineOf(s),
    headlineDef: headlineDef(s),
    sections: true,
    funnel,
    funnelSmall: isSmall(funnel),
    protection,
    protectionSmall: isSmall(protection),
    defs: defsOf(funnel, protection),
    defsNotes: [
      BOARD_COPY.defsNoteTopics,
      BOARD_COPY.defsNoteSmall,
      BOARD_COPY.defsNoteMedian,
      ...(input.asOfKind === 'checkpoint' ? [BOARD_COPY.defsNoteCheckpoint] : []),
    ],
    demand: demandOf(s),
    eval: evalView(evalSummary),
    clause: { line: clauseLine(s) },
    clauseExample: clauseExample(),
    playground: playgroundLine(s),
  };
}

/** A snapshot of zeros: only its labels and definitions are used (the not-connected board's “How this is counted”). */
const ZERO_SNAPSHOT: BoardSnapshot = {
  as_of: new Date(0).toISOString(),
  since: null,
  ...(Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as Record<(typeof COUNT_KEYS)[number], number>),
  median_hours_to_answer: null,
  demand: [],
};

/** The board without counts: no database on this instance, or none readable when the page was built. */
export function emptyBoardView(reason: 'not_configured' | 'db_down', evalSummary: EvalSummary): BoardView {
  const notConfigured = reason === 'not_configured';
  return {
    mode: reason,
    example: false,
    lede: BOARD_COPY.emptyLede,
    updated: null,
    stale: false,
    notice: notConfigured ? null : BOARD_COPY.dbDown,
    headline: notConfigured ? { kind: 'text', line: [BOARD_COPY.notConnected] } : null,
    headlineDef: BOARD_COPY.headlineDef,
    sections: false,
    funnel: [],
    funnelSmall: false,
    protection: [],
    protectionSmall: false,
    // What the board will count once connected (labels and SQL only, no numbers).
    defs: notConfigured ? defsOf(funnelRows(ZERO_SNAPSHOT), protectionRows(ZERO_SNAPSHOT)) : [],
    defsNotes: notConfigured ? [BOARD_COPY.defsNoteTopics, BOARD_COPY.defsNoteSmall, BOARD_COPY.defsNoteMedian] : [],
    demand: { rows: [], other: null, empty: null },
    eval: evalView(evalSummary),
    clause: { line: [] },
    clauseExample: clauseExample(),
    playground: [],
  };
}

/** Plain text of a line (tests, aria). */
export function lineText(line: Line): string {
  return line.map((s) => (typeof s === 'string' ? s : s.text)).join('');
}
