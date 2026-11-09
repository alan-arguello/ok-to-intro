import 'server-only';
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, RateLimitError } from '@anthropic-ai/sdk';
import { checkQuotes, norm } from '@/lib/oti/clause';
import { GATE_FAILURE_COPY, NO_LINE_COVERS } from '@/lib/oti/copy';
import { publicId } from '@/lib/oti/ids';
import { ASK_TEXT_MAX, RULES_MAX } from '@/lib/oti/text';
import { PRESET_RECORDINGS, recordedGateEvent } from '@/lib/recorded';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import { presetForRules, PRESETS } from '@/lib/sample/presets';
import type { Preset } from '@/lib/sample/types';
import type {
  AskParts,
  CitedQuote,
  GateDecision,
  GateErrorKind,
  GateFailureKind,
  GateFlag,
  LiveState,
  QuestionType,
  ReasonCode,
  SampleAskKey,
  TryCounts,
  TryEvent,
  TryRequest,
  Verdict,
} from '@/lib/types';
import { recordAudit } from './audit';
import { currentPause, isBudgetStop, nextMonthStartFrom, pauseLive, recordUsage, retryAfterSeconds, usageCost } from './budget';
import { canRunLive, getLiveState, getModelClient, recordModelCall, track } from './live';
import { checkRateLimit } from './ratelimit';
import {
  buildGateRequest,
  GATE_FLAGS,
  GATE_MODEL,
  GATE_TIMEOUT_MS,
  GATES_IN_FLIGHT,
  QUESTION_MAX,
  QUESTION_TYPES,
  QUOTE_MIN_CHARS,
  QUOTES_MAX,
  REASON_CODES,
  REASON_MAX,
  RUN_HARD_STOP_MS,
  SDK_MAX_RETRIES,
  VERDICTS,
} from './rubric';

/**
 * Owner: BE1. The gate: one member's rules × one ask → accept | decline | ask_back with cited quotes, then the
 * code checks. claude-haiku-5-5, structured output (one frozen all-required schema, rubric.ts), thinking off, effort
 * low, the rubric cached ahead of the member's rules, the ask as quoted data, 6 s per gate (retry included), SDK
 * maxRetries 1 and only within 2 s of retry-after (live.ts).
 *
 * Code checks, after every model answer (docs/CONTRACT.md §b “Gate rules every caller can rely on”):
 * - Each quote must be one contiguous span of the member's rules (lib/oti/clause `findClause`: NFKC, straight
 *   quotes, collapsed whitespace, case-folded) and at least 4 characters long. A quote that stops inside a word is
 *   widened to the whole word, so the member always sees whole words of their own text.
 * - A quote not found → the verdict becomes `decline` with `decided_by: 'clause_check'` (`model_verdict` keeps what
 *   the model said). An accept or ask_back with no quote at all → the same.
 * - An ask_back whose question is missing, over 100 characters, or holds a URL, path or email → a decline by code.
 *   (Its type is already one of the 8 by the schema.) `decided_by: 'clause_check'` means “code overrode the model”.
 * - A refusal (`stop_reason: refusal`) or output that doesn't parse (including `max_tokens`) is `{ok:false}` with
 *   `kind: 'refused' | 'parse'` and a `decision`: a decline written by code (`decided_by: 'gate'`, the reason is
 *   GATE_FAILURE_COPY[kind]; tell it apart from a model decline by `kind`).
 * - A timeout, rate limit, overload or budget stop is `{ok:false}` with no decision: NOT CHECKED, never an accept.
 */

export interface GateInput {
  /** The member's rules, exactly the version recorded with the decision. */
  rules: string;
  /** The ask as members see it; quoted to the model as data after the rules, never as instructions. */
  ask: { text: string; subject?: string; parts?: AskParts; asker_stage?: string };
  /** The one rerun after a question: the asker's approved answers. */
  answers?: { type: QuestionType; text: string }[];
}

export interface GateUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type GateResult =
  | { ok: true; decision: GateDecision; ms: number; model: string; request_id: string | null; cost_usd: number | null; usage: GateUsage | null }
  | {
      ok: false;
      kind: GateFailureKind;
      ms: number;
      retry_after_s?: number;
      request_id?: string | null;
      /** refused / parse only: the decline by code that replaces the missing verdict. */
      decision?: GateDecision;
    };

/* ========================================================================== *
 * Code checks
 * ========================================================================== */

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Widens [start, end) so it never starts or ends inside a word of `text`. */
export function snapToWords(text: string, start: number, end: number): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s > 0 && isWordChar(text[s - 1]) && isWordChar(text[s])) s--;
  while (e < text.length && isWordChar(text[e - 1]) && isWordChar(text[e])) e++;
  return { start: s, end: e };
}

/**
 * The clause check: each quote found in the member's ORIGINAL rules text (offsets index it), whole words, at least
 * QUOTE_MIN_CHARS long after normalising. Duplicates (after normalising) collapse; at most QUOTES_MAX are kept.
 */
export function verifyQuotes(rules: string, quotes: readonly string[]): CitedQuote[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of quotes) {
    if (typeof q !== 'string') continue;
    const text = q.trim();
    const key = norm(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
    if (unique.length >= QUOTES_MAX) break;
  }
  return checkQuotes(rules, unique).map((c): CitedQuote => {
    const substance = norm(c.text).replace(/^["']+|["']+$/g, '').trim();
    if (!c.found || c.start === undefined || c.end === undefined || substance.length < QUOTE_MIN_CHARS) return { text: c.text, found: false };
    const r = snapToWords(rules, c.start, c.end);
    return { text: c.text, found: true, start: r.start, end: r.end };
  });
}

const URL_RE = /\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(?:com|io|ai|app|co|org|net|dev|mx|gg|xyz|me|ly)\b/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PATH_RE = /(?:^|\s)(?:~|\.{1,2})?\/[\w.-]+|[\w.-]+\/[\w.-]+\/[\w.-]+|\b[a-z]:\\/i;

/** Why a gate's question breaks the rules (ux-spec S6: 8 types, ≤ 100 characters, no URLs, paths or emails), or null. */
export function questionProblem(question: { type: string; text: string } | null): string | null {
  if (!question) return 'no question';
  if (!(QUESTION_TYPES as readonly string[]).includes(question.type)) return 'type';
  const text = question.text.trim();
  if (!text) return 'empty';
  if (text.length > QUESTION_MAX) return 'too long';
  if (URL_RE.test(text) || EMAIL_RE.test(text) || PATH_RE.test(text)) return 'link';
  return null;
}

/** The model's output after a defensive parse (enums compared case-insensitively, confidence clamped). */
export interface GateOutput {
  verdict: Verdict;
  cited: string[];
  reason_code: ReasonCode;
  reason: string;
  /** As the model wrote it; `type` is checked against the 8 types by `questionProblem`. */
  question: { type: string; text: string } | null;
  flags: GateFlag[];
  confidence: number | null;
}

/**
 * Curly quotes and apostrophes in text the model writes for people (reasons, questions), so it reads like the rest of
 * the product (ux-spec §2.7). Never applied to quotes of the member's or the founder's own words.
 */
export function curly(text: string): string {
  return text
    .replace(/(^|[\s([{\u2014-])"(?=\S)/g, '$1\u201C')
    .replace(/"/g, '\u201D')
    .replace(/([\p{L}\p{N}])'([\p{L}\p{N}])/gu, '$1\u2019$2')
    .replace(/(^|[\s([{\u2014-])'(?=\S)/g, '$1\u2018')
    .replace(/'/g, '\u2019');
}

const lowerEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | null => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
};

/** Parses the gate's JSON. Null when it isn't a usable verdict (→ a decline by code, kind `parse`). */
export function parseGateOutput(text: string): GateOutput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const verdict = lowerEnum(o.verdict, VERDICTS);
  if (!verdict) return null;
  const cited = Array.isArray(o.cited) ? o.cited.filter((c): c is string => typeof c === 'string') : [];
  const reason_code = lowerEnum(o.reason_code, REASON_CODES) ?? (verdict === 'accept' ? 'match' : 'no_rule');
  const reason = typeof o.reason === 'string' ? curly(o.reason.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX)) : '';
  let question: GateOutput['question'] = null;
  if (o.question && typeof o.question === 'object' && !Array.isArray(o.question)) {
    const qo = o.question as Record<string, unknown>;
    const type = typeof qo.type === 'string' ? qo.type.trim().toLowerCase() : '';
    const qtext = typeof qo.text === 'string' ? curly(qo.text.replace(/\s+/g, ' ').trim()) : '';
    question = { type, text: qtext };
  }
  const flags = Array.isArray(o.flags)
    ? [...new Set(o.flags.map((f) => lowerEnum(f, GATE_FLAGS)).filter((f): f is GateFlag => f !== null))]
    : [];
  const c = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : null;
  return { verdict, cited, reason_code, reason, question, flags, confidence: c === null ? null : Math.round(c * 1000) / 1000 };
}

const DEFAULT_REASON: Record<Verdict, string> = {
  accept: 'Matched a line in your rules.',
  decline: NO_LINE_COVERS,
  ask_back: 'One fact the rules need is missing from the ask.',
};

/** The final decision: the model's output after every code check. Pure. */
export function decide(rules: string, out: GateOutput): GateDecision {
  const cited = verifyQuotes(rules, out.cited);
  let reason_code = out.reason_code;
  if (out.verdict === 'decline' && reason_code === 'match') reason_code = 'no_rule';
  if (out.verdict === 'ask_back' && reason_code === 'match') reason_code = 'proof';
  const base: GateDecision = {
    verdict: out.verdict,
    model_verdict: out.verdict,
    cited,
    decided_by: 'gate',
    reason_code,
    reason: out.reason || DEFAULT_REASON[out.verdict],
    question: null,
    flags: out.flags,
    confidence: out.confidence,
  };
  const byCode = (reason: string): GateDecision => ({ ...base, verdict: 'decline', decided_by: 'clause_check', reason_code: 'no_rule', reason, question: null });

  if (cited.some((c) => !c.found)) {
    if (out.verdict === 'accept') return byCode('The gate quoted text that isn’t in your rules, so code changed accept to decline.');
    if (out.verdict === 'ask_back') return byCode('The gate quoted text that isn’t in your rules, so code declined instead of asking.');
    return byCode('The gate quoted text that isn’t in your rules; code declined it.');
  }
  if (out.verdict === 'accept' && cited.length === 0) return byCode('The gate accepted without quoting your rules, so code changed accept to decline.');
  if (out.verdict === 'ask_back' && cited.length === 0) return byCode('The gate asked a question without quoting your rules, so code declined it.');
  if (out.verdict === 'ask_back') {
    if (questionProblem(out.question) || !out.question) return byCode('The gate’s question broke the question rules (8 types, 100 characters, no links), so code declined it.');
    return { ...base, question: { type: out.question.type as QuestionType, text: out.question.text.trim() } };
  }
  return base;
}

/** The decline code writes when the model gave no usable verdict (refusal, unparseable output, max_tokens). */
export function codeDecline(kind: 'refused' | 'parse', flags: GateFlag[] = []): GateDecision {
  return {
    verdict: 'decline',
    model_verdict: 'decline',
    cited: [],
    decided_by: 'gate',
    reason_code: 'no_rule',
    reason: GATE_FAILURE_COPY[kind],
    question: null,
    flags,
    confidence: null,
  };
}

/* ========================================================================== *
 * The model call
 * ========================================================================== */

/** Per-gate timeout and per-run hard stop (ux-spec §8); tests shorten them. */
const timing = { gateTimeoutMs: GATE_TIMEOUT_MS, hardStopMs: RUN_HARD_STOP_MS };

/** For tests: shorter timeouts (pass nothing to restore the spec's 6 s and 12 s). */
export function __setGateTimingForTests(t: { gateTimeoutMs?: number; hardStopMs?: number } = {}): void {
  timing.gateTimeoutMs = t.gateTimeoutMs ?? GATE_TIMEOUT_MS;
  timing.hardStopMs = t.hardStopMs ?? RUN_HARD_STOP_MS;
}

export interface ModelFailure {
  kind: GateFailureKind;
  retry_after_s?: number;
  request_id: string | null;
  status: number | null;
}

/** Maps a thrown SDK error to a failure kind (shared with the compiler). Budget stops are reported, not handled. */
export function classifyModelError(err: unknown, ctx: { deadlineHit: boolean }): ModelFailure {
  const request_id = err instanceof APIError ? (err.requestID ?? null) : null;
  const status = err instanceof APIError && typeof err.status === 'number' ? err.status : null;
  if (ctx.deadlineHit || err instanceof APIUserAbortError || err instanceof APIConnectionTimeoutError) return { kind: 'timeout', request_id, status };
  if (isBudgetStop(err)) return { kind: 'budget', request_id, status };
  if (err instanceof RateLimitError) {
    const wait = retryAfterSeconds(err.headers);
    return wait === null ? { kind: 'rate_limited', request_id, status } : { kind: 'rate_limited', retry_after_s: Math.max(1, Math.ceil(wait)), request_id, status };
  }
  if (err instanceof APIConnectionError) return { kind: 'overloaded', request_id, status };
  if (err instanceof APIError) return { kind: status !== null && status >= 500 ? 'overloaded' : 'unavailable', request_id, status };
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return { kind: 'timeout', request_id, status };
  return { kind: 'unavailable', request_id, status };
}

function usageOf(u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): GateUsage | null {
  if (!u) return null;
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** runGate plus what a run needs to report: the measured cost of every call that returned usage (refusals too). */
export interface GateRun {
  result: GateResult;
  cost_usd: number | null;
  usage: GateUsage | null;
  request_id: string | null;
}

/** Runs one gate. Never throws; never returns an accept it can't back with found quotes. */
export async function runGateDetailed(input: GateInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<GateRun> {
  const started = Date.now();
  const fail = (kind: GateFailureKind, extra: Partial<Extract<GateResult, { ok: false }>> = {}): GateRun => ({
    result: { ok: false, kind, ms: Date.now() - started, ...extra },
    cost_usd: null,
    usage: null,
    request_id: extra.request_id ?? null,
  });

  const client = getModelClient();
  if (!client) return fail('unavailable');
  const rules = typeof input?.rules === 'string' ? input.rules : '';
  const askText = typeof input?.ask?.text === 'string' ? input.ask.text : '';
  if (!rules.trim() || rules.length > RULES_MAX * 2 || !askText.trim() || askText.length > ASK_TEXT_MAX * 2) return fail('unavailable');
  if (options.signal?.aborted) return fail('timeout');
  if (await currentPause(started)) return fail('budget');

  const timeoutMs = options.timeoutMs ?? timing.gateTimeoutMs;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  try {
    const { data, request_id } = await client.messages
      .create(buildGateRequest({ rules, ask: input.ask, answers: input.answers }), { signal, timeout: timeoutMs + 1_000, maxRetries: SDK_MAX_RETRIES })
      .withResponse();
    const ms = Date.now() - started;
    const usage = usageOf(data.usage);
    const cost_usd = usageCost(GATE_MODEL, data.usage);
    recordUsage(cost_usd);
    const rid = request_id ?? null;

    if (data.stop_reason === 'refusal') {
      recordModelCall({ ms, kind: 'refused', gate: true });
      return { result: { ok: false, kind: 'refused', ms, request_id: rid, decision: codeDecline('refused') }, cost_usd, usage, request_id: rid };
    }
    const text = data.content
      .filter((b): b is Extract<(typeof data.content)[number], { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = data.stop_reason === 'max_tokens' ? null : parseGateOutput(text);
    if (!parsed) {
      recordModelCall({ ms, kind: 'parse', gate: true });
      return { result: { ok: false, kind: 'parse', ms, request_id: rid, decision: codeDecline('parse') }, cost_usd, usage, request_id: rid };
    }
    recordModelCall({ ms, kind: null, gate: true });
    const decision = decide(rules, parsed);
    return { result: { ok: true, decision, ms, model: data.model || GATE_MODEL, request_id: rid, cost_usd, usage }, cost_usd, usage, request_id: rid };
  } catch (err) {
    const ms = Date.now() - started;
    const callerLeft = !!options.signal?.aborted && !deadline.aborted;
    const failure = classifyModelError(err, { deadlineHit: deadline.aborted });
    if (failure.kind === 'budget') await pauseLive('anthropic_spend_limit', nextMonthStartFrom());
    if (!callerLeft) recordModelCall({ ms, kind: failure.kind, gate: true });
    if (failure.kind === 'unavailable' || failure.kind === 'overloaded') {
      // Status and type only: never the request body (rules, ask) or the error body.
      console.warn(`[gate] model call failed: ${failure.status ?? 'no status'} ${err instanceof APIError ? `${err.type ?? ''} ${String(err.message ?? '').slice(0, 200)}` : err instanceof Error ? err.name : ''}`.trim());
    }
    return fail(failure.kind, { retry_after_s: failure.retry_after_s, request_id: failure.request_id });
  }
}

/**
 * Runs one gate. Never throws; never returns an accept it can't back with found quotes.
 * A timeout, rate limit, overload or budget stop is `{ok:false}` (the caller shows NOT CHECKED).
 */
export async function runGate(input: GateInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<GateResult> {
  return (await runGateDetailed(input, options)).result;
}

/* ========================================================================== *
 * POST /api/try (and MCP try_rules): the playground's run over the 12 SAMPLE asks
 * ========================================================================== */

/** Why a live run can't start (JSON body of the 400 / 429 / 503 that /api/try returns before streaming). */
export type TryRefusal =
  | { error: 'invalid_rules'; message: string }
  | { error: 'rate_limited'; retry_at: string }
  | { error: 'live_unavailable'; live: LiveState; until: string | null };

export type TryStart = { ok: true; events: AsyncIterable<TryEvent> } | { ok: false; status: 400 | 429 | 503; body: TryRefusal };

/** ux-spec S1 [empty-rules] and [too-long]. */
export const RULES_EMPTY_COPY = 'Write at least one line, or pick a preset.';
export const RULES_TOO_LONG_COPY = 'Keep it under 1,000 characters. Gates read every word on every ask.';

const ASK_INDEX = new Map<SampleAskKey, number>(SAMPLE_ASKS.map((a, i) => [a.id, i]));

/** The asks to run, in arrival order (all 12 by default), or null when `ask_ids` names an unknown ask. */
function resolveAskIds(ids: unknown): SampleAskKey[] | null {
  if (ids === undefined || ids === null) return SAMPLE_ASKS.map((a) => a.id);
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 64) return null;
  const wanted = new Set<SampleAskKey>();
  for (const id of ids) {
    if (typeof id !== 'string' || !ASK_INDEX.has(id as SampleAskKey)) return null;
    wanted.add(id as SampleAskKey);
  }
  return SAMPLE_ASKS.map((a) => a.id).filter((id) => wanted.has(id));
}

/**
 * A try request may carry `mode` (an addition to TryRequest, docs/requests/be1-gates.md):
 * - absent / 'live': live, or a refusal (429 / 503) the caller shows as its own notice. /api/try streams only live
 *   verdicts by default (docs/CONTRACT.md §c), so a client can't mistake a recorded row for a live one.
 * - 'recorded': an unedited preset's recorded run, no model call, labelled by the file's source.
 * - 'auto': live when possible; an unedited preset falls back to its recorded run when live calls can't run or the
 *   address is rate-limited (presets are unlimited). For API callers that render `plan.mode` and each gate's source.
 */
export type TryMode = 'auto' | 'live' | 'recorded';
type TryInput = TryRequest & { mode?: unknown };

function emptyCounts(): TryCounts {
  return { accept: 0, decline: 0, ask_back: 0, failed: 0 };
}

/** The UI's vocabulary for a failed row. `unavailable` (a key or request the API rejected) reads as the API failing. */
function errorKind(kind: GateFailureKind): GateErrorKind {
  return kind === 'unavailable' ? 'overloaded' : kind;
}

/**
 * An unedited preset's recorded run as a stream (mode `recorded`, no model call, never rate-limited). Each gate keeps
 * its file's real source: `authored` (hand-written: no latency, cost or confidence) or `recorded`.
 */
function recordedEvents(preset: Preset, ids: SampleAskKey[]): AsyncIterable<TryEvent> {
  const file = PRESET_RECORDINGS;
  const run = file.runs[preset.id];
  const isModel = file.source === 'model';
  async function* events(): AsyncGenerator<TryEvent> {
    yield {
      event: 'plan',
      data: { run_id: publicId('run'), mode: 'recorded', rules_chars: preset.rules.length, gates: ids.map((id) => ({ i: ASK_INDEX.get(id)!, ask_id: id })), recorded_at: file.recorded_at },
    };
    const counts = emptyCounts();
    for (const id of ids) {
      const gate = run.gates.find((g) => g.ask_id === id);
      if (!gate) continue;
      const ev = recordedGateEvent(gate, ASK_INDEX.get(id)!, file);
      counts[ev.verdict] += 1;
      yield { event: 'gate', data: ev };
    }
    const whole = ids.length === SAMPLE_ASKS.length;
    yield { event: 'done', data: { counts, wall_ms: isModel && whole ? (run.wall_ms ?? 0) : 0, cost_usd: isModel && whole ? run.cost_usd : null } };
  }
  return events();
}

/** A tiny unbounded channel: producers push, the stream's generator takes in order. */
function channel<T>() {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  return {
    push(item: T) {
      items.push(item);
      const w = wake;
      wake = null;
      w?.();
    },
    async take(): Promise<T> {
      while (!items.length) await new Promise<void>((resolve) => (wake = resolve));
      return items.shift() as T;
    },
  };
}

/** Runs `tasks` with at most `limit` in flight. */
async function pool(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++] as () => Promise<void>;
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/**
 * A live run: `plan` at once, then one `gate` or `error` per ask as each model call returns (completion order; rows
 * resolve by `i`), then `done`. Gates stop when the visitor leaves (the playground persists nothing). A budget stop
 * ends the run: one run-level `error {kind: 'budget'}`, then every unresolved row as `budget`. At 12 s every
 * unresolved row is `timeout` (partial results stay).
 */
function liveEvents(rules: string, ids: SampleAskKey[], signal: AbortSignal | undefined): AsyncIterable<TryEvent> {
  async function* events(): AsyncGenerator<TryEvent> {
    const started = Date.now();
    const run_id = publicId('run');
    const controller = new AbortController();
    if (signal?.aborted) return;
    const out = channel<TryEvent | null>();
    // The visitor left: stop every gate and end the stream now (nobody reads the rest).
    const onAbort = () => {
      controller.abort();
      out.push(null);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const resolved = new Set<number>();
    const counts = emptyCounts();
    let cost = 0;
    let costKnown = false;
    let calls = 0;
    let budgetStopped = false;

    const resolveRow = (i: number, ev: TryEvent) => {
      if (resolved.has(i)) return false;
      resolved.add(i);
      out.push(ev);
      if (resolved.size === ids.length) out.push(null);
      return true;
    };
    const failRow = (i: number, ask_id: SampleAskKey, kind: GateErrorKind, retry_after_s?: number) => {
      const data = retry_after_s === undefined ? { i, ask_id, kind } : { i, ask_id, kind, retry_after_s };
      if (resolveRow(i, { event: 'error', data })) {
        if (kind === 'refused' || kind === 'parse') counts.decline += 1;
        else counts.failed += 1;
      }
    };
    const stopForBudget = () => {
      if (budgetStopped) return;
      budgetStopped = true;
      out.push({ event: 'error', data: { kind: 'budget' } });
      controller.abort();
      for (const id of ids) failRow(ASK_INDEX.get(id)!, id, 'budget');
    };

    yield { event: 'plan', data: { run_id, mode: 'live', rules_chars: rules.length, gates: ids.map((id) => ({ i: ASK_INDEX.get(id)!, ask_id: id })) } };

    const hardStop = setTimeout(() => {
      controller.abort();
      for (const id of ids) failRow(ASK_INDEX.get(id)!, id, 'timeout');
    }, timing.hardStopMs);

    const tasks = ids.map((id) => async () => {
      const i = ASK_INDEX.get(id)!;
      if (controller.signal.aborted || resolved.has(i)) return;
      const ask = SAMPLE_ASKS[i]!;
      const run = await runGateDetailed({ rules, ask: { text: ask.text, subject: ask.subject, parts: ask.parts, asker_stage: ask.stage } }, { signal: controller.signal });
      if (run.usage) calls += 1;
      if (run.cost_usd !== null) {
        cost += run.cost_usd;
        costKnown = true;
      }
      const r = run.result;
      if (r.ok) {
        if (resolveRow(i, { event: 'gate', data: { ...r.decision, i, ask_id: id, ms: Date.now() - started, source: 'live' } })) counts[r.decision.verdict] += 1;
      } else if (r.kind === 'budget') stopForBudget();
      else failRow(i, id, errorKind(r.kind), r.retry_after_s);
    });
    const work = pool(tasks, GATES_IN_FLIGHT).catch(() => undefined);

    try {
      for (;;) {
        const ev = await out.take();
        if (ev === null) break;
        yield ev;
      }
      clearTimeout(hardStop);
      const wall_ms = Date.now() - started;
      yield { event: 'done', data: { counts, wall_ms, cost_usd: costKnown ? Math.round(cost * 1e7) / 1e7 : null } };
      console.info(
        `[try] ${run_id} live ${ids.length} gates: ${counts.accept} accept · ${counts.ask_back} ask_back · ${counts.decline} decline · ${counts.failed} failed · ${wall_ms} ms`,
      );
    } finally {
      clearTimeout(hardStop);
      controller.abort();
      signal?.removeEventListener('abort', onAbort);
      track(work.then(() => (calls > 0 ? recordAudit('playground_run', { detail: { gates: calls } }) : undefined)));
    }
  }
  return events();
}

/**
 * Starts a playground run over the 12 SAMPLE asks (all, or `ask_ids` to retry missing rows), checking input, live
 * availability and the rate limit (`clientKey`) first. Custom rules always run live and are never stored or logged;
 * so does an unedited preset (the playground's “Run live”). An unedited preset's recorded file streams instead (mode
 * `recorded`, labelled by the file's source, no model call: presets are unlimited) when the request says
 * `mode: 'recorded'`, or says `mode: 'auto'` and live calls can't run or the address is rate-limited.
 * Events follow ux-spec §8: one `plan`, one `gate` or `error` per ask, then `done`. Used by POST /api/try and the MCP
 * tool try_rules.
 */
export async function startTry(input: TryRequest, context: { clientKey: string | null; signal?: AbortSignal }): Promise<TryStart> {
  const raw = (input ?? {}) as TryInput;
  const rules = typeof raw.rules === 'string' ? raw.rules : '';
  if (!rules.trim()) return { ok: false, status: 400, body: { error: 'invalid_rules', message: RULES_EMPTY_COPY } };
  if (rules.length > RULES_MAX) return { ok: false, status: 400, body: { error: 'invalid_rules', message: RULES_TOO_LONG_COPY } };
  const ids = resolveAskIds(raw.ask_ids);
  if (!ids) return { ok: false, status: 400, body: { error: 'invalid_rules', message: 'ask_ids must name the sample asks a01 to a12.' } };

  const preset = presetForRules(rules);
  const mode: TryMode = raw.mode === 'auto' || raw.mode === 'recorded' ? raw.mode : 'live';
  if (preset && mode === 'recorded') return { ok: true, events: recordedEvents(preset, ids) };
  const fallback = preset && mode === 'auto' ? preset : null;

  const live = await getLiveState();
  if (!canRunLive(live)) {
    if (fallback) return { ok: true, events: recordedEvents(fallback, ids) };
    return { ok: false, status: 503, body: { error: 'live_unavailable', live: live.state, until: live.paused_until } };
  }
  const limit = await checkRateLimit(context.clientKey, 'try');
  if (!limit.ok) {
    if (fallback) return { ok: true, events: recordedEvents(fallback, ids) };
    return { ok: false, status: 429, body: { error: 'rate_limited', retry_at: limit.retry_at } };
  }
  return { ok: true, events: liveEvents(rules, ids, context.signal) };
}

/**
 * One real gate call on a fixed SAMPLE pair, to compile and cache the structured-output grammar after a deploy
 * and twice a day (tech.md: compiled grammars expire after 24 h unused). Used by /api/cron/warm (BE2's route).
 * Never throws; `ok: false` when live calls are unavailable. A refusal or parse failure still warmed the grammar.
 */
export async function warmGate(): Promise<{ ok: boolean; ms: number; kind?: GateFailureKind }> {
  const ask = SAMPLE_ASKS[0]!;
  const { result } = await runGateDetailed({ rules: WARMUP_RULES, ask: { text: ask.text, subject: ask.subject, parts: ask.parts, asker_stage: ask.stage } });
  if (result.ok) return { ok: true, ms: result.ms };
  if (result.kind === 'refused' || result.kind === 'parse') return { ok: true, ms: result.ms, kind: result.kind };
  return { ok: false, ms: result.ms, kind: result.kind };
}

/** The default preset (Engineer) on its first sample ask: the warm-up pair. */
const WARMUP_RULES: string = (PRESETS.find((p) => p.id === 'engineer') ?? PRESETS[0]!).rules;
