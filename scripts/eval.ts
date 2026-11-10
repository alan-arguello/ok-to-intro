/**
 * npm run eval — the gate eval (owner: BE1).
 *
 *   npm run eval                        held-out set: data/eval/heldout.json, frozen by its hash → data/eval/heldout-summary.json
 *   npm run eval -- --set sample        the SAMPLE set (12 sample asks × 3 presets) → data/eval/sample-summary.json
 *   npm run eval -- --freeze            freeze data/eval/heldout.json before any tuning (writes data/eval/heldout.lock.json)
 *   npm run eval -- --write-sample      regenerate data/eval/sample-cases.json from lib/sample
 *   npm run eval -- --baseline-only     the keyword baseline alone (no key needed; writes nothing)
 *   options: --runs 3 (default 3) · --concurrency 8 · --dry-run (print, write nothing)
 *
 * Runs the production gate (lib/server/gate.ts, the exact code /api/try runs) over every case 3 times, plus a keyword
 * baseline, and prints the table the board shows: case type · n · run 1 · run 2 · run 3 · keyword baseline, the
 * wrongly let through / wrongly blocked counts, and every miss. A gate that fails counts as not checked (wrong).
 *
 * Honesty: the held-out file is written by someone who didn't see the rubric or the gate prompt, and it is frozen
 * by its sha256 before tuning; the script refuses to run a held-out file whose hash changed. The SAMPLE set is
 * labelled SAMPLE everywhere: its expected verdicts are the hand-written literal reading the rubric was written
 * next to, so it is not held out. Only `npm run eval` on the held-out set writes the file the board reads.
 * Needs ANTHROPIC_API_KEY (except --freeze, --write-sample and --baseline-only); refuses to run without it.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_ASKS } from '../lib/sample/asks';
import { PRESETS } from '../lib/sample/presets';
import { AUTHORED_VERDICTS } from '../lib/sample/verdicts';
import type { AskParts, EvalCaseType, EvalSummary, Verdict } from '../lib/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = join(root, 'data', 'eval');
export const PATHS = {
  sampleCases: join(EVAL_DIR, 'sample-cases.json'),
  sampleSummary: join(EVAL_DIR, 'sample-summary.json'),
  heldout: join(EVAL_DIR, 'heldout.json'),
  heldoutLock: join(EVAL_DIR, 'heldout.lock.json'),
  heldoutSummary: join(EVAL_DIR, 'heldout-summary.json'),
};

/* ========================================================================== *
 * Files
 * ========================================================================== */

export interface EvalCase {
  /** Unique within the file, ≤ 40 characters. */
  id: string;
  case_type: EvalCaseType;
  /** The member's rules (fictional), 1..1000 characters. */
  rules: string;
  /** The ask as members see it. */
  ask: { text: string; subject?: string; parts?: AskParts; asker_stage?: string };
  /** The label a person wrote: what a literal reading of the rules decides. */
  expected: Verdict;
  notes?: string;
}

export interface EvalFile {
  set: 'sample' | 'heldout';
  /** Shown above the table. SAMPLE files say SAMPLE. */
  label: string;
  /** Who wrote the cases and the labels. */
  author: string;
  /** e.g. “(Alan’s cofounder), who didn’t see the rubric or the gate prompt”. */
  author_note?: string;
  created_at: string;
  cases: EvalCase[];
}

export interface HeldoutLock {
  sha256: string;
  frozen_at: string;
  cases: number;
}

export const CASE_TYPES: readonly EvalCaseType[] = ['fits', 'wrong_stage', 'investor', 'injection', 'polite_spam', 'other'];
export const CASE_TYPE_LABEL: Record<EvalCaseType, string> = {
  fits: 'Fits the rules',
  wrong_stage: 'Right topic, wrong stage',
  investor: 'Investor posing as a founder',
  injection: 'Prompt injection',
  polite_spam: 'Polite spam',
  other: 'Other',
};

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const TRAP_TYPE: Record<string, EvalCaseType> = { 'wrong stage': 'wrong_stage', investor: 'investor', injection: 'injection', 'polite spam': 'polite_spam' };

/** The SAMPLE set: the 12 sample asks × the 3 presets, expected = the hand-written literal reading (lib/sample). */
export function buildSampleCases(): EvalFile {
  const cases: EvalCase[] = [];
  for (const preset of PRESETS) {
    for (const v of AUTHORED_VERDICTS[preset.id]) {
      const ask = SAMPLE_ASKS.find((a) => a.id === v.ask_id)!;
      const case_type: EvalCaseType = ask.trap ? (TRAP_TYPE[ask.trap] ?? 'other') : v.verdict === 'accept' ? 'fits' : 'other';
      cases.push({
        id: `sample-${preset.id}-${ask.id}`,
        case_type,
        rules: preset.rules,
        ask: { text: ask.text, subject: ask.subject, parts: { ...ask.parts }, asker_stage: ask.stage },
        expected: v.verdict,
        notes: `${preset.label} preset × ${ask.company} (${ask.topic})${ask.trap ? ` · trap: ${ask.trap}` : ''}`,
      });
    }
  }
  return {
    set: 'sample',
    label: 'SAMPLE eval: the 12 sample asks × the 3 presets. Expected verdicts are the hand-written literal reading in lib/sample, the same reading the gate rubric was written next to, so this set is not held out.',
    author: 'Alan Arguello',
    author_note: '(hand-written SAMPLE expectations, ported from the prototype’s data.js)',
    created_at: '2026-11-09',
    cases,
  };
}

/** Shape problems in an eval file (empty when valid). */
export function evalFileProblems(json: unknown): string[] {
  const f = json as Partial<EvalFile> | null;
  if (!f || typeof f !== 'object') return ['not an object'];
  const problems: string[] = [];
  if (f.set !== 'sample' && f.set !== 'heldout') problems.push('set must be "sample" or "heldout"');
  if (typeof f.author !== 'string' || !f.author.trim()) problems.push('author is required');
  if (!Array.isArray(f.cases) || !f.cases.length) return [...problems, 'cases must be a non-empty list'];
  const ids = new Set<string>();
  f.cases.forEach((c, n) => {
    const at = `cases[${n}]`;
    if (!c || typeof c !== 'object') return problems.push(`${at} is not an object`);
    if (typeof c.id !== 'string' || !c.id || c.id.length > 40) problems.push(`${at}.id`);
    else if (ids.has(c.id)) problems.push(`${at}.id ${c.id} is repeated`);
    else ids.add(c.id);
    if (!CASE_TYPES.includes(c.case_type)) problems.push(`${at}.case_type`);
    if (typeof c.rules !== 'string' || !c.rules.trim() || c.rules.length > 1000) problems.push(`${at}.rules (1..1000 characters)`);
    if (!c.ask || typeof c.ask.text !== 'string' || !c.ask.text.trim() || c.ask.text.length > 1000) problems.push(`${at}.ask.text (1..1000 characters)`);
    if (!['accept', 'decline', 'ask_back'].includes(c.expected)) problems.push(`${at}.expected must be accept, decline or ask_back (a person labels every case)`);
    return undefined;
  });
  return problems;
}

/* ========================================================================== *
 * The keyword baseline
 * ========================================================================== */

const STOP = new Set(
  'about after also and any are ask asks been before but can could does for from founder founders happy has have help how into just like more need not only other our out over please some such talk than that the their them they this those very want was what when where which while who will with would you your minutes min offer tried someone people real yet get got'.split(' '),
);

function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+]*/gu) ?? []) {
    const w = raw.length > 4 ? raw.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')) : raw;
    if (w.length >= 3 && !STOP.has(w) && !STOP.has(raw)) out.add(w);
  }
  return out;
}

/**
 * What a keyword filter would decide (the comparison the board prints next to each run): decline when a word of a
 * “No …” line appears in the ask; accept when any other line shares a keyword with the ask; decline otherwise.
 * It never asks a question and ignores “Only if …” conditions, which is the point of the comparison.
 */
export function keywordBaseline(rules: string, askText: string): Verdict {
  const ask = keywords(askText);
  const lines = rules.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.filter((l) => /^no\b/i.test(l))) {
    for (const k of keywords(line.replace(/^no\b/i, ''))) if (ask.has(k)) return 'decline';
  }
  for (const line of lines.filter((l) => !/^(no|only)\b/i.test(l))) {
    for (const k of keywords(line)) if (ask.has(k)) return 'accept';
  }
  return 'decline';
}

/* ========================================================================== *
 * Scoring
 * ========================================================================== */

export type Actual = Verdict | 'not_checked';

export interface CaseResult {
  /** One per run. */
  actual: Actual[];
  /** Quotes the gate cited in each run (the member's words where code found them). */
  cited: string[][];
  baseline: Verdict;
}

/** The board's eval file (EvalSummary) from the per-case results. */
export function summarize(file: EvalFile, results: CaseResult[], meta: { ran_at: string; model: string; rubric_hash: string; header: string }): EvalSummary {
  const runs = results[0]?.actual.length ?? 0;
  const zero = () => Array.from({ length: runs }, () => 0);
  const rows = CASE_TYPES.filter((t) => file.cases.some((c) => c.case_type === t)).map((case_type) => {
    const idx = file.cases.map((c, i) => (c.case_type === case_type ? i : -1)).filter((i) => i >= 0);
    const perRun = zero();
    let baseline = 0;
    for (const i of idx) {
      const c = file.cases[i]!;
      const r = results[i]!;
      r.actual.forEach((a, k) => {
        if (a === c.expected) perRun[k]! += 1;
      });
      if (r.baseline === c.expected) baseline += 1;
    }
    return { case_type, label: CASE_TYPE_LABEL[case_type], n: idx.length, runs: perRun, baseline };
  });
  const totals = { n: file.cases.length, runs: zero(), baseline: 0 };
  const letThrough = { runs: zero(), baseline: 0 };
  const blocked = { runs: zero(), baseline: 0 };
  const misses: EvalSummary['misses'] = [];
  file.cases.forEach((c, i) => {
    const r = results[i]!;
    r.actual.forEach((a, k) => {
      if (a === c.expected) totals.runs[k]! += 1;
      if (a === 'accept' && c.expected !== 'accept') letThrough.runs[k]! += 1;
      if (c.expected === 'accept' && a !== 'accept') blocked.runs[k]! += 1;
    });
    if (r.baseline === c.expected) totals.baseline += 1;
    if (r.baseline === 'accept' && c.expected !== 'accept') letThrough.baseline += 1;
    if (c.expected === 'accept' && r.baseline !== 'accept') blocked.baseline += 1;
    const firstMiss = r.actual.findIndex((a) => a !== c.expected);
    if (firstMiss >= 0) {
      misses.push({
        case_id: c.id,
        case_type: c.case_type,
        ask: c.ask.text,
        rules_excerpt: c.rules.length > 240 ? `${c.rules.slice(0, 237).replace(/\s+\S*$/, '')}…` : c.rules,
        expected: c.expected,
        actual: [...r.actual],
        cited: [...(r.cited[firstMiss] ?? [])],
      });
    }
  });
  return {
    source: 'eval',
    ran_at: meta.ran_at,
    model: meta.model,
    rubric_hash: meta.rubric_hash,
    header: meta.header,
    rows,
    totals,
    wrongly_let_through: letThrough,
    wrongly_blocked: blocked,
    misses,
  };
}

/** The table as the board prints it, for the terminal. */
export function formatSummary(s: EvalSummary, title: string): string {
  const runs = s.totals?.runs.length ?? 0;
  const head = ['Case type'.padEnd(30), 'n'.padStart(3), ...Array.from({ length: runs }, (_, k) => `Run ${k + 1}`.padStart(7)), 'Keyword baseline'.padStart(18)].join(' ');
  const line = (label: string, n: number, r: number[], b: number) => [label.padEnd(30), String(n).padStart(3), ...r.map((x) => String(x).padStart(7)), String(b).padStart(18)].join(' ');
  const out = [title, s.header ?? '', '', head];
  for (const row of s.rows) out.push(line(row.label, row.n, row.runs, row.baseline));
  if (s.totals) out.push(line('Total', s.totals.n, s.totals.runs, s.totals.baseline));
  if (s.wrongly_let_through && s.wrongly_blocked) {
    const part = (r: number[], b: number) => (r.length ? `${r.join(' · ')} (baseline ${b})` : `baseline ${b}`);
    out.push('', `Wrongly let through: ${part(s.wrongly_let_through.runs, s.wrongly_let_through.baseline)}. Wrongly blocked: ${part(s.wrongly_blocked.runs, s.wrongly_blocked.baseline)}.`);
  }
  const missCount = s.misses.reduce((n, m) => n + m.actual.filter((a) => a !== m.expected).length, 0);
  if (runs) out.push(`Misses: ${s.misses.length} cases (${missCount} misses across ${runs} runs).`);
  for (const m of s.misses) {
    out.push(`  ${m.case_id.padEnd(28)} ${m.case_type.padEnd(12)} expected ${m.expected} · got ${m.actual.join(', ')}${m.cited.length ? ` · cited ${m.cited.map((c) => `“${c}”`).join(' ')}` : ''}`);
  }
  return out.join('\n');
}

/* ========================================================================== *
 * Running
 * ========================================================================== */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Next's `server-only` guard throws outside the react-server condition; this script runs server code on purpose. */
function allowServerOnly() {
  const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === 'server-only') return join(root, 'node_modules', 'server-only', 'empty.js');
    return original.call(this, request, ...rest);
  };
}

function loadEnvFiles() {
  for (const f of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(join(root, f));
    } catch {
      /* missing file */
    }
  }
}

async function pool<T>(items: T[], limit: number, work: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await work(items[i] as T, i);
      }
    }),
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

async function main() {
  loadEnvFiles();
  allowServerOnly();

  if (flag('write-sample')) {
    mkdirSync(EVAL_DIR, { recursive: true });
    const file = buildSampleCases();
    writeFileSync(PATHS.sampleCases, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`Wrote ${PATHS.sampleCases}: ${file.cases.length} SAMPLE cases.`);
    return;
  }

  if (flag('freeze')) {
    if (!existsSync(PATHS.heldout)) {
      console.error(`No held-out file at ${PATHS.heldout}. The person writing the cases saves it there first (format: data/eval/README.md).`);
      process.exit(1);
    }
    const text = readFileSync(PATHS.heldout, 'utf8');
    const problems = evalFileProblems(JSON.parse(text));
    if (problems.length) {
      console.error(`The held-out file has problems:\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    if (existsSync(PATHS.heldoutLock) && !flag('refreeze')) {
      const lock = readJson<HeldoutLock>(PATHS.heldoutLock);
      console.error(`Already frozen on ${lock.frozen_at} (sha256 ${lock.sha256.slice(0, 12)}). A frozen set never changes; pass --refreeze only for a new set written before any tuning.`);
      process.exit(1);
    }
    const lock: HeldoutLock = { sha256: sha256(text), frozen_at: new Date().toISOString(), cases: (JSON.parse(text) as EvalFile).cases.length };
    writeFileSync(PATHS.heldoutLock, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`Froze ${lock.cases} held-out cases: sha256 ${lock.sha256}`);
    return;
  }

  const set = arg('set') === 'sample' ? 'sample' : 'heldout';
  const path = set === 'sample' ? PATHS.sampleCases : PATHS.heldout;
  if (!existsSync(path)) {
    console.error(set === 'heldout' ? `No held-out set yet (${PATHS.heldout}). Run the SAMPLE set with: npm run eval -- --set sample` : `Missing ${path}: npm run eval -- --write-sample`);
    process.exit(1);
  }
  const text = readFileSync(path, 'utf8');
  const file = JSON.parse(text) as EvalFile;
  const problems = evalFileProblems(file);
  if (problems.length) {
    console.error(`${path} has problems:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  let frozenAt: string | null = null;
  if (set === 'heldout') {
    if (!existsSync(PATHS.heldoutLock)) {
      console.error('The held-out set is not frozen. Freeze it before any tuning: npm run eval -- --freeze');
      process.exit(1);
    }
    const lock = readJson<HeldoutLock>(PATHS.heldoutLock);
    if (lock.sha256 !== sha256(text)) {
      console.error(`Refusing to run: data/eval/heldout.json changed after it was frozen on ${lock.frozen_at} (sha256 ${lock.sha256.slice(0, 12)} → ${sha256(text).slice(0, 12)}).`);
      process.exit(1);
    }
    frozenAt = lock.frozen_at;
  }

  const baseline = file.cases.map((c) => keywordBaseline(c.rules, c.ask.text));
  if (flag('baseline-only')) {
    const results: CaseResult[] = file.cases.map((_, i) => ({ actual: [], cited: [], baseline: baseline[i]! }));
    const s = summarize(file, results, { ran_at: new Date().toISOString(), model: 'keyword baseline', rubric_hash: '', header: file.label });
    console.log(formatSummary(s, `${set === 'sample' ? 'SAMPLE' : 'Held-out'} eval · keyword baseline only (no model calls)`));
    return;
  }

  const { flags } = await import('../lib/env');
  if (!flags.hasAnthropic) {
    console.error('SKIPPED: ANTHROPIC_API_KEY is not set. The eval runs the production gate; add the key to .env.local (or run --baseline-only).');
    process.exit(2);
  }
  const { runGateDetailed } = await import('../lib/server/gate');
  const { GATE_MODEL, RUBRIC_HASH, RUBRIC_HASH_SHORT } = await import('../lib/server/rubric');
  const { settleBackground } = await import('../lib/server/live');

  const runs = Math.max(1, Math.min(5, Number(arg('runs') ?? 3) || 3));
  const concurrency = Math.max(1, Math.min(16, Number(arg('concurrency') ?? 8) || 8));
  const results: CaseResult[] = file.cases.map((_, i) => ({ actual: [], cited: [], baseline: baseline[i]! }));
  let cost = 0;
  const started = Date.now();
  for (let k = 0; k < runs; k++) {
    await pool(file.cases, concurrency, async (c, i) => {
      const run = await runGateDetailed({ rules: c.rules, ask: c.ask });
      cost += run.cost_usd ?? 0;
      const r = run.result;
      const actual: Actual = r.ok ? r.decision.verdict : r.decision ? r.decision.verdict : 'not_checked';
      const cited = r.ok ? r.decision.cited.map((q) => (q.found && q.start !== undefined && q.end !== undefined ? c.rules.slice(q.start, q.end) : q.text)) : [];
      results[i]!.actual[k] = actual;
      results[i]!.cited[k] = cited;
    });
    console.log(`run ${k + 1} of ${runs} done (${Math.round((Date.now() - started) / 1000)} s)`);
  }
  await settleBackground();

  const ranAt = new Date().toISOString();
  const header =
    set === 'heldout'
      ? `${file.cases.length} cases written by ${file.author}${file.author_note ? ` ${file.author_note}` : ''} · frozen ${fmtDate(frozenAt!)} before tuning · ${GATE_MODEL} · rubric ${RUBRIC_HASH_SHORT}`
      : `SAMPLE · ${file.cases.length} cases (12 sample asks × 3 presets), expected verdicts written by hand · not held out · ${GATE_MODEL} · rubric ${RUBRIC_HASH_SHORT}`;
  const summary = summarize(file, results, { ran_at: ranAt, model: GATE_MODEL, rubric_hash: RUBRIC_HASH, header });
  console.log(`\n${formatSummary(summary, set === 'heldout' ? 'Held-out eval' : 'SAMPLE eval (not held out)')}`);
  console.log(`\n${file.cases.length * runs} gate calls · about $${cost.toFixed(4)} measured from usage · ${Math.round((Date.now() - started) / 1000)} s`);
  if (flag('dry-run')) {
    console.log('dry run: nothing written');
    return;
  }
  const out = set === 'heldout' ? PATHS.heldoutSummary : PATHS.sampleSummary;
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Wrote ${out}`);
}

if (!process.env.VITEST) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'eval failed');
    process.exit(1);
  });
}
