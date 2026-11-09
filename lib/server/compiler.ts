import 'server-only';
import { APIError, BadRequestError } from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { isYcApplicationAsk, PART_MAX, TOPIC_MAX, YC_APPLICATION_REFUSAL } from '@/lib/oti/ask';
import { findClause, norm } from '@/lib/oti/clause';
import { publicId } from '@/lib/oti/ids';
import { ASK_TEXT_MAX, stripEnd, SUBJECT_MAX, upper1, wordCount } from '@/lib/oti/text';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { PART_KEYS } from '@/lib/types';
import type { CitedQuote, CompiledPart, CompileEvent, CompileRefusalKind, CompileRequest, LiveState, Network, PartKey } from '@/lib/types';
import { isBudgetStop, nextMonthStartFrom, pauseLive, recordUsage, usageCost, type UsageLike } from './budget';
import { classifyModelError, curly, snapToWords } from './gate';
import { canRunLive, getLiveState, getModelClient, recordModelCall } from './live';
import { checkRateLimit } from './ratelimit';
import { buildCompileRequest, COMPILER_FALLBACK_BETA, COMPILER_MODEL, COMPILER_TIMEOUT_MS, PART_QUESTIONS, SDK_MAX_RETRIES } from './rubric';

/**
 * Owner: BE1. The 5-part compiler (claude-sonnet-5-5, effort low): marks each part found (the founder's own
 * words, verified as a span of their text), suggested (only `needs`, citing its source spans) or missing (a
 * question, never an invented fact); refuses vague asks and anything about YC applications; writes a subject of
 * at most 45 characters and a coarse topic for the board's unanswered-demand view.
 *
 * The stream (ux-spec S2): `plan` at once; the model's JSON streams and each part is checked and sent the moment it
 * is complete (first part ≤ 2 s); a correction is re-sent by index if the final answer differs; then `done`.
 * Or `refused` (vague / yc_application), or `error` (timeout at 15 s, rate_limited, overloaded, refused, budget,
 * parse, unavailable), after which the page shows the manual 5-part form.
 *
 * Code decides before any model call, with or without a key: an ask about a YC application (lib/oti/ask
 * `isYcApplicationAsk`, the same check every send path runs) and an ask that can't name a blocker (fewer than 6
 * words, or a SAMPLE “Vague” chip) are refused with the copy in ux-spec S2. Nothing else is decided without the
 * model: the “Missing 2 parts” and “Complete” chips compile live like any text. Without live calls, /ask shows its
 * manual form, prefilled for a chip from lib/sample and labelled as hand-written (docs/CONTRACT.md §14).
 *
 * After the model, code checks every part (facts are never invented):
 * - found: must be a span of the founder's text (lib/oti clause finder, widened to whole words); else it is missing.
 * - suggested: only `needs`, and only with at least one source span found in the text; any other suggested part is
 *   missing.
 * - missing: the fixed question for that part (rubric.ts PART_QUESTIONS).
 * The founder's text is never stored or logged.
 */

export type CompileRefusal =
  | { error: 'invalid_text'; message: string }
  | { error: 'rate_limited'; retry_at: string }
  | { error: 'live_unavailable'; live: LiveState; until: string | null };

export type CompileStart = { ok: true; events: AsyncIterable<CompileEvent> } | { ok: false; status: 400 | 429 | 503; body: CompileRefusal };

/** ux-spec S2 “Refusals”. */
export const VAGUE_COPY = 'Too vague to send. It doesn’t say what’s blocked or who could unblock it. Add one line on each; the rest can be drafted.';
export const REFUSAL_COPY: Record<CompileRefusalKind, string> = { vague: VAGUE_COPY, yc_application: YC_APPLICATION_REFUSAL };
export const TEXT_EMPTY_COPY = 'Write what you need first: what’s blocked, what you tried, and who could unblock it.';
export const TEXT_TOO_LONG_COPY = `Keep it under ${ASK_TEXT_MAX} characters.`;

/** Fewer words than this can't name a blocker and a person: refused by code, no model call. */
export const MIN_WORDS = 6;

const VAGUE_SAMPLES = new Set(Object.values(SAMPLE_NETWORK_ASKS).map((s) => norm(s.vague)));

/** The refusals code makes on its own (no model call), or null. */
export function codeRefusal(text: string): CompileRefusalKind | null {
  if (isYcApplicationAsk(text)) return 'yc_application';
  if (VAGUE_SAMPLES.has(norm(text)) || wordCount(text) < MIN_WORDS) return 'vague';
  return null;
}

/* ========================================================================== *
 * Part checks
 * ========================================================================== */

/** A quote's span in the founder's text: whole words, no trailing punctuation, at most PART_MAX characters. */
export function locateSpan(text: string, quote: unknown): { start: number; end: number } | null {
  if (typeof quote !== 'string') return null;
  const q = quote.trim();
  if (norm(q).replace(/^["']+|["']+$/g, '').length < 3) return null;
  const found = findClause(text, q);
  if (!found) return null;
  let { start, end } = snapToWords(text, found.start, found.end);
  const trimEnd = () => {
    while (end > start && /[\s.,;:!?]/.test(text[end - 1] as string)) end--;
  };
  while (start < end && /\s/.test(text[start] as string)) start++;
  trimEnd();
  if (end - start > PART_MAX) {
    let cut = start + PART_MAX;
    while (cut > start && !/\s/.test(text[cut] as string)) cut--;
    end = cut > start ? cut : start + PART_MAX;
    trimEnd();
  }
  return end > start ? { start, end } : null;
}

function quoteAt(text: string, span: { start: number; end: number }): CitedQuote {
  return { text: text.slice(span.start, span.end), found: true, start: span.start, end: span.end };
}

function missingPart(key: PartKey): CompiledPart {
  return { key, state: 'missing', text: '', source: [], question: PART_QUESTIONS[key] };
}

/** One part as the model wrote it, after the code checks. */
export function normalizePart(key: PartKey, raw: unknown, founderText: string): CompiledPart {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { state?: unknown; text?: unknown; sources?: unknown };
  const state = typeof o.state === 'string' ? o.state.trim().toLowerCase() : '';
  if (state === 'found') {
    const span = locateSpan(founderText, o.text);
    if (span) {
      const q = quoteAt(founderText, span);
      return { key, state: 'found', text: q.text, source: [q], question: null };
    }
  }
  if (key === 'needs' && (state === 'suggested' || state === 'found')) {
    const text = curly(clip(typeof o.text === 'string' ? o.text : '', PART_MAX));
    const spans = (Array.isArray(o.sources) ? o.sources : [])
      .map((s) => locateSpan(founderText, s))
      .filter((s): s is { start: number; end: number } => s !== null)
      .map((s) => quoteAt(founderText, s));
    const unique = spans.filter((s, i) => spans.findIndex((t) => t.start === s.start && t.end === s.end) === i).slice(0, 3);
    if (text && unique.length) return { key, state: 'suggested', text, source: unique, question: null };
  }
  return missingPart(key);
}

/** Collapses whitespace, drops wrapping quotes and trailing punctuation, and cuts at a word boundary. */
function clip(value: string, max: number): string {
  let s = value.replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '');
  s = stripEnd(s);
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1).replace(/\s+\S*$/, '');
  return stripEnd(cut || s.slice(0, max));
}

const FILLER_END = /(\s+(at|the|a|an|of|for|to|in|on|with|and|or|is|are|from|by))+$/i;

/**
 * The subject members see in their inbox (≤ 45 characters, one line, “…, 20 min?”). The model's when it fits;
 * otherwise derived from the challenge the way the prototype did.
 */
export function normalizeSubject(raw: unknown, challenge: string | null): string {
  const s = typeof raw === 'string' ? curly(raw.replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '')) : '';
  if (s && s.length <= SUBJECT_MAX) {
    if (/,\s*20 min\?$/i.test(s)) return s;
    const withSuffix = `${stripEnd(s)}, 20 min?`;
    return withSuffix.length <= SUBJECT_MAX ? withSuffix : s;
  }
  let t = String(challenge || s || 'Your ask').replace(/^(our|we|my|i)\s+/i, '');
  if (t.length > 36) t = t.slice(0, 37).replace(/\s+\S*$/, '');
  t = t.replace(FILLER_END, '').replace(/[,;:.\s]+$/, '');
  return `${upper1(t || 'Your ask')}, 20 min?`;
}

/** The board's coarse topic: ≤ 80 characters, no line breaks; null when empty. */
export function normalizeTopic(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = curly(clip(raw, TOPIC_MAX));
  return t ? t : null;
}

/* ========================================================================== *
 * Streaming JSON: top-level values as they complete
 * ========================================================================== */

/**
 * Scans a JSON object as its text arrives and calls `onValue(key, rawJson)` for each top-level property as soon as
 * its value is complete (strings, numbers, literals, nested objects and arrays). Chunk boundaries can fall anywhere,
 * inside strings and escapes included. The model emits properties in schema order, so parts arrive one by one.
 */
export function createTopLevelScanner(onValue: (key: string, raw: string) => void): { push(text: string): void } {
  let buf = '';
  let i = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  type Phase = 'key' | 'key_str' | 'colon' | 'value' | 'val_str' | 'val_nested' | 'val_prim' | 'after' | 'done';
  let phase: Phase = 'key';
  let keyStart = -1;
  let key = '';
  let valueStart = -1;

  const emit = (raw: string) => {
    try {
      onValue(key, raw);
    } catch {
      /* a bad value is the final parse's problem */
    }
  };

  return {
    push(text: string) {
      buf += text;
      for (; i < buf.length; i++) {
        const c = buf[i] as string;
        if (inString) {
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') {
            inString = false;
            if (depth === 1 && phase === 'key_str') {
              try {
                key = JSON.parse(buf.slice(keyStart, i + 1)) as string;
              } catch {
                key = '';
              }
              phase = 'colon';
            } else if (depth === 1 && phase === 'val_str') {
              emit(buf.slice(valueStart, i + 1));
              phase = 'after';
            }
          }
          continue;
        }
        if (phase === 'done') continue;
        switch (c) {
          case '"':
            inString = true;
            if (depth === 1 && phase === 'key') {
              phase = 'key_str';
              keyStart = i;
            } else if (depth === 1 && phase === 'value') {
              phase = 'val_str';
              valueStart = i;
            }
            break;
          case '{':
          case '[':
            if (depth === 0) {
              if (c === '{') {
                depth = 1;
                phase = 'key';
              }
              break;
            }
            if (depth === 1 && phase === 'value') {
              phase = 'val_nested';
              valueStart = i;
            }
            depth++;
            break;
          case '}':
          case ']':
            if (depth === 1) {
              if (phase === 'val_prim') emit(buf.slice(valueStart, i).trim());
              depth = 0;
              phase = 'done';
              break;
            }
            depth--;
            if (depth === 1 && phase === 'val_nested') {
              emit(buf.slice(valueStart, i + 1));
              phase = 'after';
            }
            break;
          case ':':
            if (depth === 1 && phase === 'colon') phase = 'value';
            break;
          case ',':
            if (depth === 1) {
              if (phase === 'val_prim') emit(buf.slice(valueStart, i).trim());
              phase = 'key';
            }
            break;
          default:
            if (depth === 1 && phase === 'value' && !/\s/.test(c)) {
              phase = 'val_prim';
              valueStart = i;
            }
        }
      }
    },
  };
}

/* ========================================================================== *
 * The model call
 * ========================================================================== */

/** The stream events this module reads (beta and regular Messages streams share these shapes). */
type StreamEvent =
  | { type: 'message_start'; message: { model?: string; usage?: UsageLike | null } }
  | { type: 'content_block_start'; index: number; content_block: { type: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: string | null }; usage?: UsageLike | null }
  | { type: 'message_stop' }
  | { type: string };

/** Set once the API rejects the fallback beta header for this key; later compiles go without it. */
let fallbackUnsupported = false;
/** The compile deadline (ux-spec S2: the manual form at 15 s); tests shorten it. */
let compilerTimeoutMs = COMPILER_TIMEOUT_MS;

async function openStream(client: Anthropic, text: string, signal: AbortSignal): Promise<{ events: AsyncIterable<StreamEvent>; request_id: string | null }> {
  const base = buildCompileRequest(text);
  const options = { signal, timeout: compilerTimeoutMs + 1_000, maxRetries: SDK_MAX_RETRIES };
  if (!fallbackUnsupported) {
    try {
      // Server-side refusal fallback (Claude API): a policy decline is retried on the server's default fallback model.
      const { data, request_id } = await client.beta.messages
        .create({ ...base, stream: true, betas: [COMPILER_FALLBACK_BETA], fallbacks: 'default' }, options)
        .withResponse();
      return { events: data as unknown as AsyncIterable<StreamEvent>, request_id: request_id ?? null };
    } catch (err) {
      const message = err instanceof APIError ? `${err.apiMessage ?? ''} ${err.message}` : '';
      if (!(err instanceof BadRequestError) || isBudgetStop(err) || !/anthropic-beta|fallback/i.test(message)) throw err;
      fallbackUnsupported = true;
      console.warn('[compile] the refusal-fallback beta was rejected; compiling without it');
    }
  }
  const { data, request_id } = await client.messages.create({ ...base, stream: true }, options).withResponse();
  return { events: data as unknown as AsyncIterable<StreamEvent>, request_id: request_id ?? null };
}

function addUsage(into: UsageLike, from: UsageLike | null | undefined) {
  if (!from) return;
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const) {
    const v = from[k];
    if (typeof v === 'number' && Number.isFinite(v)) into[k] = v;
  }
}

function liveCompile(text: string, network: Network, signal: AbortSignal | undefined): AsyncIterable<CompileEvent> {
  async function* events(): AsyncGenerator<CompileEvent> {
    const started = Date.now();
    const draft_id = publicId('draft');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const deadline = AbortSignal.timeout(compilerTimeoutMs);
    const combined = AbortSignal.any([controller.signal, deadline]);

    yield { event: 'plan', data: { draft_id, words: wordCount(text), network } };

    const client = getModelClient();
    if (!client) {
      yield { event: 'error', data: { kind: 'unavailable' } };
      return;
    }

    const usage: UsageLike = {};
    const sent = new Map<PartKey, string>();
    const blocks = new Map<number, string>();
    let lastText = -1;
    let stopReason: string | null = null;
    /** Set when the streamed `decision` already refused (the refusal went out before the parts). */
    const state: { refused: CompileRefusalKind | null } = { refused: null };
    const pending: CompileEvent[] = [];
    let scanner = newScanner();

    function sendPart(key: PartKey, part: CompiledPart) {
      const json = JSON.stringify(part);
      if (sent.get(key) === json) return;
      sent.set(key, json);
      pending.push({ event: 'part', data: { i: PART_KEYS.indexOf(key), part } });
    }
    function newScanner() {
      return createTopLevelScanner((key, raw) => {
        if (state.refused) return;
        if (key === 'decision') {
          const decision = String(JSON.parse(raw)).toLowerCase();
          if (decision === 'vague' || decision === 'yc_application') {
            state.refused = decision;
            pending.push({ event: 'refused', data: { kind: decision, message: REFUSAL_COPY[decision] } });
          }
          return;
        }
        if ((PART_KEYS as readonly string[]).includes(key)) sendPart(key as PartKey, normalizePart(key as PartKey, JSON.parse(raw), text));
      });
    }

    try {
      const stream = await openStream(client, text, combined);
      for await (const ev of stream.events) {
        if (ev.type === 'message_start') addUsage(usage, (ev as Extract<StreamEvent, { type: 'message_start' }>).message?.usage);
        else if (ev.type === 'content_block_start') {
          const e = ev as Extract<StreamEvent, { type: 'content_block_start' }>;
          if (e.content_block.type === 'text') {
            blocks.set(e.index, '');
            lastText = e.index;
            scanner = newScanner();
          } else if (e.content_block.type === 'fallback') {
            // The requested model declined and a fallback model takes over: its text block replaces everything.
            state.refused = null;
          }
        } else if (ev.type === 'content_block_delta') {
          const e = ev as Extract<StreamEvent, { type: 'content_block_delta' }>;
          if (e.delta.type === 'text_delta' && typeof e.delta.text === 'string' && blocks.has(e.index)) {
            blocks.set(e.index, (blocks.get(e.index) as string) + e.delta.text);
            if (e.index === lastText) scanner.push(e.delta.text);
          }
        } else if (ev.type === 'message_delta') {
          const e = ev as Extract<StreamEvent, { type: 'message_delta' }>;
          if (e.delta?.stop_reason) stopReason = e.delta.stop_reason;
          addUsage(usage, e.usage);
        }
        while (pending.length) yield pending.shift() as CompileEvent;
      }

      const ms = Date.now() - started;
      const cost = usageCost(COMPILER_MODEL, usage);
      recordUsage(cost);

      if (stopReason === 'refusal') {
        recordModelCall({ ms, kind: 'refused', gate: false });
        yield { event: 'error', data: { kind: 'refused' } };
        return;
      }
      let final: Record<string, unknown> | null = null;
      if (stopReason !== 'max_tokens') {
        try {
          const parsed = JSON.parse(blocks.get(lastText) ?? '') as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) final = parsed as Record<string, unknown>;
        } catch {
          final = null;
        }
      }
      const result = final;
      const decision = result ? String(result.decision ?? '').toLowerCase() : '';
      if (!result || !['compile', 'vague', 'yc_application'].includes(decision)) {
        recordModelCall({ ms, kind: 'parse', gate: false });
        if (!state.refused) yield { event: 'error', data: { kind: 'parse' } };
        return;
      }
      recordModelCall({ ms, kind: null, gate: false });
      if (decision === 'vague' || decision === 'yc_application') {
        if (!state.refused) yield { event: 'refused', data: { kind: decision, message: REFUSAL_COPY[decision] } };
        return;
      }
      if (state.refused) return;
      const parts = PART_KEYS.map((key) => normalizePart(key, result[key], text));
      for (const part of parts) sendPart(part.key, part);
      while (pending.length) yield pending.shift() as CompileEvent;
      const challenge = parts[0]?.state === 'found' ? parts[0].text : null;
      yield {
        event: 'done',
        data: { draft_id, subject: normalizeSubject(result.subject, challenge), topic: normalizeTopic(result.topic), parts, ms: Date.now() - started },
      };
    } catch (err) {
      const ms = Date.now() - started;
      const callerLeft = controller.signal.aborted && !deadline.aborted;
      if (callerLeft) return;
      const failure = classifyModelError(err, { deadlineHit: deadline.aborted });
      if (failure.kind === 'budget') await pauseLive('anthropic_spend_limit', nextMonthStartFrom());
      recordModelCall({ ms, kind: failure.kind, gate: false });
      if (failure.kind === 'unavailable' || failure.kind === 'overloaded') {
        console.warn(`[compile] model call failed: ${failure.status ?? 'no status'} ${err instanceof APIError ? (err.type ?? '') : err instanceof Error ? err.name : ''}`.trim());
      }
      while (pending.length) yield pending.shift() as CompileEvent;
      yield { event: 'error', data: failure.retry_after_s === undefined ? { kind: failure.kind } : { kind: failure.kind, retry_after_s: failure.retry_after_s } };
    } finally {
      controller.abort();
      signal?.removeEventListener('abort', onAbort);
    }
  }
  return events();
}

function refusedEvents(kind: CompileRefusalKind, text: string, network: Network): AsyncIterable<CompileEvent> {
  async function* events(): AsyncGenerator<CompileEvent> {
    yield { event: 'plan', data: { draft_id: publicId('draft'), words: wordCount(text), network } };
    yield { event: 'refused', data: { kind, message: REFUSAL_COPY[kind] } };
  }
  return events();
}

/**
 * Starts a compile stream (plan → part × 5 → done, or refused, or error). Used by POST /api/compile and the
 * MCP tool draft_ask. Checks input (1..600 characters), the rate limit and live availability first.
 */
export async function startCompile(input: CompileRequest, context: { clientKey: string | null; signal?: AbortSignal }): Promise<CompileStart> {
  const text = typeof input?.text === 'string' ? input.text : '';
  if (!text.trim()) return { ok: false, status: 400, body: { error: 'invalid_text', message: TEXT_EMPTY_COPY } };
  if (text.length > ASK_TEXT_MAX) return { ok: false, status: 400, body: { error: 'invalid_text', message: TEXT_TOO_LONG_COPY } };
  const network: Network = input.network === 'real' ? 'real' : 'sample';

  const refusal = codeRefusal(text);
  if (refusal) return { ok: true, events: refusedEvents(refusal, text, network) };

  const live = await getLiveState();
  if (!canRunLive(live)) return { ok: false, status: 503, body: { error: 'live_unavailable', live: live.state, until: live.paused_until } };
  const limit = await checkRateLimit(context.clientKey, 'compile');
  if (!limit.ok) return { ok: false, status: 429, body: { error: 'rate_limited', retry_at: limit.retry_at } };
  return { ok: true, events: liveCompile(text, network, context.signal) };
}

/** For tests: forget that the fallback beta was rejected, and set (or restore) the compile deadline. */
export function __resetCompilerForTests(timeoutMs: number = COMPILER_TIMEOUT_MS): void {
  fallbackUnsupported = false;
  compilerTimeoutMs = timeoutMs;
}
