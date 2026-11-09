import 'server-only';
import { flags } from '@/lib/env';
import { applyCap, type CapRow, DEFAULT_CAP } from '@/lib/oti/cap';
import { NOTHING_SENT, REAL_ASK_COPY } from '@/lib/oti/copy';
import { isRealAskId, isSampleAskId } from '@/lib/oti/ids';
import { suggestRuleEdit } from '@/lib/oti/rule-edits';
import { ANSWER_MAX, NOTE_MAX, RULES_MAX } from '@/lib/oti/text';
import { fmtDay, NETWORK_TZ, toMs } from '@/lib/oti/time';
import {
  alreadySentText,
  answerReceipt,
  dataText,
  draftReceipt,
  draftRefusedReceipt,
  ERRORS,
  errorText,
  type MyAskRow,
  myAsksReceipt,
  outcomeReceipt,
  pendingReceipt,
  respondReceipt,
  sendRealReceipt,
  sendSampleReceipt,
  setRulesReceipt,
  type TryRowResult,
  tryRulesReceipt,
} from '@/lib/receipts';
import { PRESET_RECORDINGS } from '@/lib/recorded';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import { sampleNetworkAskById } from '@/lib/sample/network';
import { presetById, presetForRules } from '@/lib/sample/presets';
import { absoluteUrl } from '@/lib/site';
import { canAskReal, createAsk, getAskerView, listMyAsks } from '@/lib/server/asks';
import { saveCheckin } from '@/lib/server/checkins';
import { startCompile } from '@/lib/server/compiler';
import { answerSampleQuestion, startSampleSendWith, startSend } from '@/lib/server/dispatch';
import { startTry } from '@/lib/server/gate';
import { localDayAt } from '@/lib/server/intros';
import { canRunLive, getLiveState } from '@/lib/server/live';
import { getMemberProfile, saveRules } from '@/lib/server/member';
import { listPendingForMember, respondToOffer, setNoReason } from '@/lib/server/offers';
import { answerQuestion } from '@/lib/server/questions';
import type {
  CheckinAnswer,
  CompileErrorKind,
  CompileEvent,
  D14Outcome,
  FanoutEvent,
  GateErrorKind,
  LiveState,
  NoReason,
  OfferAction,
  PartKey,
  PresetId,
  TryEvent,
  TryGateEvent,
  WontHappenReason,
} from '@/lib/types';
import { optionalMember, requireMember } from './auth';
import type { McpRequestContext } from './context';
import {
  compiledOf,
  DRAFT_ID_RE,
  DRAFT_TTL_MS,
  type DraftRecord,
  draftStatus,
  loadDraft,
  loadDraftByAsk,
  mergeAnswers,
  missingLabels,
  partsFromCompile,
  partViews,
  saveDraft,
  type SourceNote,
} from './drafts';
import { canonicalSampleId, questionTypeFor, recallSampleSend, rememberSampleSend, sampleCompiled, sampleQuestionText, sampleSendView } from './sample';

/**
 * The 9 tools' behaviour, as plain functions over the request context (lib/mcp/server.ts registers them with
 * mcp-handler). Every result is a receipt from lib/receipts.ts; failures are isError results of at most 3 lines that
 * end with the next step. Nothing here logs arguments, asks, rules, answers or tokens.
 */

export interface ToolText {
  text: string;
  isError: boolean;
}

const ok = (text: string): ToolText => ({ text, isError: false });
const fail = (text: string): ToolText => ({ text, isError: true });

/** Time budgets per call: Claude Code moves calls past 2 minutes to the background; keep each well under 15 s. */
export const BUDGET_MS = { try: 20_000, compile: 20_000, sample: 14_000, real: 13_000 } as const;

/* ---------- streams ---------- */

/** Reads a stream until it ends or `budgetMs` passes; `stop` is aborted on timeout (live work stops with it). */
export async function collect<T>(events: AsyncIterable<T>, budgetMs: number, stop?: AbortController): Promise<{ items: T[]; finished: boolean }> {
  const it = events[Symbol.asyncIterator]();
  const items: T[] = [];
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const left = deadline - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(0, left));
    });
    const step = await Promise.race([it.next(), timeout]).catch(() => ({ done: true, value: undefined }) as IteratorReturnResult<undefined>);
    clearTimeout(timer);
    if (step === 'timeout') {
      stop?.abort();
      void Promise.resolve(it.return?.()).catch(() => undefined);
      return { items, finished: false };
    }
    if (step.done) return { items, finished: true };
    items.push(step.value);
  }
}

function linked(signal: AbortSignal | undefined): AbortController {
  const c = new AbortController();
  if (signal) {
    if (signal.aborted) c.abort();
    else signal.addEventListener('abort', () => c.abort(), { once: true });
  }
  return c;
}

/* ---------- copy for live availability ---------- */

function untilDay(iso: string | null): string {
  return iso ? fmtDay(toMs(iso), NETWORK_TZ) : 'tomorrow';
}

/** One sentence: why live calls can't run right now (never “down” for an instance without a key). */
export function liveUnavailableSentence(state: LiveState, until: string | null): string {
  if (state === 'off') return 'Live checks are off on this instance: no model API key is set.';
  if (state === 'budget') return `Live checks are paused until ${untilDay(until)}: this demo reached its model budget.`;
  return 'Live checks are paused: the model API isn’t answering.';
}

/** Why a compile stopped (CompileEvent `error.kind`), one sentence. */
export function compileStatusCopy(kind: CompileErrorKind): string {
  const copy: Record<CompileErrorKind, string> = {
    timeout: 'The compiler took longer than 15 s.',
    rate_limited: 'The model API rate-limited the compiler.',
    overloaded: 'The model API was overloaded.',
    refused: 'The model refused to draft this ask.',
    budget: 'Live checks are paused: this demo reached its model budget.',
    parse: 'The compiler’s answer didn’t parse.',
    unavailable: 'The compiler couldn’t reach the model.',
  };
  return copy[kind];
}

/* ========================================================================== *
 * try_rules (open)
 * ========================================================================== */

export interface TryRulesArgs {
  rules?: string;
  preset?: PresetId;
  cap?: number;
}

export async function tryRules(args: TryRulesArgs, ctx: McpRequestContext, signal?: AbortSignal): Promise<ToolText> {
  const rules = typeof args.rules === 'string' && args.rules.trim() ? args.rules : args.preset ? presetById(args.preset).rules : '';
  if (!rules.trim()) return fail(errorText('Write at least one line of rules, or pass preset "engineer", "health" or "founder".', 'next: call try_rules again with rules.'));
  if (rules.length > RULES_MAX) return fail(errorText(`Keep the rules under ${RULES_MAX.toLocaleString('en-US')} characters (these have ${rules.length.toLocaleString('en-US')}). Gates read every word on every ask.`, 'next: shorten them and call try_rules again.'));
  const preset = presetForRules(rules);
  const cap = Number.isInteger(args.cap) && (args.cap as number) >= 1 && (args.cap as number) <= 5 ? (args.cap as number) : (preset?.cap ?? DEFAULT_CAP);

  const before = await getLiveState();
  const stop = linked(signal);
  const start = await startTry({ rules, mode: 'auto' }, { clientKey: ctx.clientKey, signal: stop.signal });
  if (!start.ok) {
    const b = start.body;
    if (b.error === 'invalid_rules') return fail(errorText(b.message, 'next: fix the rules and call try_rules again.'));
    if (b.error === 'rate_limited') return fail(errorText(ERRORS.rateLimited(b.retry_at), 'next: rules identical to a preset (preset "engineer", "health" or "founder") still run without a limit.'));
    return fail(
      errorText(
        `${liveUnavailableSentence(b.live, b.until)} Your rules weren’t stored or sent anywhere.`,
        'next: call try_rules with preset "engineer", "health" or "founder" to see a sample member’s rules checked.',
      ),
    );
  }
  const { items, finished } = await collect<TryEvent>(start.events, BUDGET_MS.try, stop);
  const results: (TryRowResult | null)[] = SAMPLE_ASKS.map(() => null);
  let mode: 'live' | 'recorded' = 'live';
  let recordedAt: string | null = null;
  let source: 'live' | 'recorded' | 'authored' = 'live';
  let wall: number | null = null;
  for (const e of items) {
    if (e.event === 'plan') {
      mode = e.data.mode;
      recordedAt = e.data.recorded_at ?? null;
    } else if (e.event === 'gate') {
      results[e.data.i] = { kind: 'gate', decision: e.data };
      source = (e.data as TryGateEvent).source;
    } else if (e.event === 'error' && typeof e.data.i === 'number') results[e.data.i] = { kind: 'error', error: e.data.kind };
    else if (e.event === 'done') wall = e.data.wall_ms;
  }
  if (!finished) for (let i = 0; i < results.length; i++) results[i] ??= { kind: 'error', error: 'timeout' as GateErrorKind };
  if (mode === 'live') source = 'live';
  let why: string | null = null;
  if (mode === 'recorded') {
    why = canRunLive(before) ? 'Live runs from this address are rate-limited for a few minutes; presets are unlimited' : liveUnavailableSentence(before.state, before.paused_until).replace(/\.$/, '');
  }
  return ok(
    tryRulesReceipt({
      rules,
      cap,
      results,
      source,
      wall_ms: source === 'authored' ? null : wall,
      recorded_at: source === 'recorded' ? recordedAt : null,
      model: source === 'recorded' ? PRESET_RECORDINGS.model : null,
      why_not_live: why,
      join_open: flags.hasSupabase,
    }),
  );
}

/* ========================================================================== *
 * draft_ask (open)
 * ========================================================================== */

export interface DraftAskArgs {
  text?: string;
  draft_id?: string;
  answers?: Partial<Record<PartKey, string>>;
  sources?: SourceNote[];
}

function cleanSources(raw: unknown): SourceNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is SourceNote => !!s && typeof s === 'object' && typeof (s as SourceNote).text === 'string' && typeof (s as SourceNote).from === 'string')
    .slice(0, 12)
    .map((s) => ({ text: s.text.slice(0, 300), from: s.from.slice(0, 120) }));
}

function draftText(d: DraftRecord, problem: string | null = null): string {
  const status = draftStatus(d);
  return draftReceipt({
    id: d.id,
    parts: partViews(d.parts),
    subject: d.subject ?? '',
    text: compiledOf(d).text,
    network: d.network,
    problem: problem ?? status.problem,
  });
}

export async function draftAsk(args: DraftAskArgs, ctx: McpRequestContext, signal?: AbortSignal): Promise<ToolText> {
  const sources = cleanSources(args.sources);
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  const now = Date.now();

  // Continue a draft: merge the user's answers into the stored parts.
  if (args.draft_id) {
    if (!DRAFT_ID_RE.test(args.draft_id)) return fail(ERRORS.draftExpired());
    const loaded = await loadDraft(args.draft_id, now);
    if (!loaded.ok) return fail(ERRORS.dbDown());
    const d = loaded.draft;
    if (d && (!text || text === d.raw.trim())) {
      if (d.state === 'sent') return ok(alreadySentText(d.ask_id ?? d.id, d.updated_at, d.network === 'sample' || (d.ask_id ?? '').startsWith('sa_')));
      const merged = mergeAnswers(d.parts, args.answers, sources);
      const next: DraftRecord = { ...d, parts: merged.parts };
      const status = draftStatus(next);
      next.state = status.ready ? 'ready' : 'missing';
      if (!(await saveDraft(next))) return fail(ERRORS.dbDown());
      return ok(draftText(next, merged.problems[0]?.message ?? null));
    }
    if (!d && !text) return fail(ERRORS.draftExpired());
    // A new text with an old id: draft it from scratch below.
  }

  if (!text) return fail(errorText('Write the ask first: what is blocked, what was tried, who could unblock it, by when, and what you offer back.', 'next: call draft_ask with text.'));
  const owner = await optionalMember(ctx);
  const network: 'sample' | 'real' = owner ? 'real' : 'sample';
  const stop = linked(signal);
  const start = await startCompile({ text, network }, { clientKey: ctx.clientKey, signal: stop.signal });
  if (!start.ok) {
    const b = start.body;
    if (b.error === 'invalid_text') return fail(errorText(b.message, 'next: call draft_ask again with the ask in plain words.'));
    if (b.error === 'rate_limited') return fail(ERRORS.rateLimited(b.retry_at, 'drafts'));
    return fail(errorText(`Drafting needs the compiler model. ${liveUnavailableSentence(b.live, b.until)} Nothing was stored.`, 'next: try again later; try_rules with a preset works meanwhile.'));
  }
  const { items, finished } = await collect<CompileEvent>(start.events, BUDGET_MS.compile, stop);
  let id: string | null = null;
  for (const e of items) {
    if (e.event === 'plan') id = e.data.draft_id;
    else if (e.event === 'refused') return ok(draftRefusedReceipt(e.data.kind, text));
    else if (e.event === 'error') return fail(errorText(`${compileStatusCopy(e.data.kind)} Nothing was stored.`, 'next: try draft_ask again in a minute.'));
    else if (e.event === 'done') {
      const parts = partsFromCompile(e.data.parts, sources);
      const merged = mergeAnswers(parts, args.answers, sources);
      const d: DraftRecord = {
        id: e.data.draft_id || id || '',
        owner_id: owner?.id ?? null,
        network,
        raw: text,
        parts: merged.parts,
        subject: e.data.subject,
        topic: e.data.topic,
        state: 'missing',
        ask_id: null,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        expires_at: new Date(now + DRAFT_TTL_MS).toISOString(),
      };
      d.state = draftStatus(d).ready ? 'ready' : 'missing';
      if (!(await saveDraft(d))) return fail(ERRORS.dbDown());
      return ok(draftText(d, merged.problems[0]?.message ?? null));
    }
  }
  return fail(errorText(finished ? 'The compiler stopped without an answer. Nothing was stored.' : 'The compiler took longer than 20 s. Nothing was stored.', 'next: try draft_ask again in a minute.'));
}

/* ========================================================================== *
 * send_ask (open on SAMPLE; token for REAL)
 * ========================================================================== */

export interface SendAskArgs {
  draft_id: string;
  network?: 'sample' | 'real';
}

export async function sendAsk(args: SendAskArgs, ctx: McpRequestContext, signal?: AbortSignal): Promise<ToolText> {
  if (!DRAFT_ID_RE.test(String(args.draft_id ?? ''))) return fail(ERRORS.draftExpired());
  const loaded = await loadDraft(args.draft_id);
  if (!loaded.ok) return fail(ERRORS.dbDown());
  const d = loaded.draft;
  if (!d) return fail(ERRORS.draftExpired());
  const network: 'sample' | 'real' = args.network ?? (ctx.tokenState === 'none' ? 'sample' : 'real');
  if (d.state === 'sent' && d.ask_id) return ok(alreadySentText(d.ask_id, d.updated_at, d.ask_id.startsWith('sa_')));
  if (d.state === 'refused') return fail(errorText('That draft was refused. Nothing was sent to anyone.', 'next: call draft_ask with a new ask.'));
  const status = draftStatus(d);
  if (!status.ready) {
    const missing = missingLabels(d.parts);
    return fail(
      errorText(
        missing.length ? `That draft isn’t ready: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing. ${NOTHING_SENT}` : `That draft isn’t ready: ${status.problem ?? 'a part needs fixing'}. ${NOTHING_SENT}`,
        `next: call draft_ask with draft_id ${d.id} and the user’s answers first.`,
      ),
    );
  }
  const compiled = compiledOf(d);
  return network === 'sample' ? sendSample(d, compiled, ctx, signal) : sendReal(d, compiled, ctx, signal);
}

async function sendSample(d: DraftRecord, compiled: ReturnType<typeof compiledOf>, ctx: McpRequestContext, signal?: AbortSignal): Promise<ToolText> {
  const started = Date.now();
  const stop = linked(signal);
  const start = await startSampleSendWith(
    { sample_ask_id: canonicalSampleId(d.raw), text: d.raw, compiled, you: null },
    { clientKey: ctx.clientKey, signal: stop.signal },
    { replay: false },
  );
  if (!start.ok) {
    const b = start.body;
    if (b.error === 'rate_limited' && b.retry_at) return fail(errorText(b.message, 'next: wait until then; the draft stays ready.'));
    if (b.error === 'live_unavailable') {
      return fail(errorText(`${b.message.replace(/ Try one of the 3 sample asks; they run from their example results\./, '')}`, 'next: SAMPLE sends of your own text need live checks; the draft stays ready until it expires.'));
    }
    return fail(errorText(b.message, 'next: call draft_ask again with the full ask.'));
  }
  const { items, finished } = await collect<FanoutEvent>(start.events, BUDGET_MS.sample, stop);
  const view = sampleSendView(items, Date.now() - started);
  if (!finished) {
    return fail(errorText(`The SAMPLE send stopped after ${Math.round(BUDGET_MS.sample / 1000)} s with ${view.cells.length} of ${view.total} members checked. ${NOTHING_SENT}`, 'next: try send_ask again in a minute.'));
  }
  rememberSampleSend(view.id, compiled, view.question_list.map((q) => ({ qid: q.qid, type: q.type, text: q.text })));
  await saveDraft({ ...d, state: 'sent', ask_id: view.id });
  return ok(sendSampleReceipt(view));
}

async function openAskIds(member: { id: string; email: string }): Promise<string[]> {
  const list = await listMyAsks(member);
  if (!list.ok) return [];
  const open = new Set(['ready', 'gating', 'offered', 'question', 'answered']);
  return list.items.filter((a) => open.has(a.outcome)).map((a) => a.id).slice(0, 3);
}

async function sendReal(d: DraftRecord, compiled: ReturnType<typeof compiledOf>, ctx: McpRequestContext, signal?: AbortSignal): Promise<ToolText> {
  const auth = await requireMember(ctx, 'send_ask on the real network');
  if (!auth.ok) return fail(auth.text);
  const member = auth.member;
  if (d.owner_id && d.owner_id !== member.id) return fail(ERRORS.draftExpired());
  const access = await canAskReal(member);
  if (!access.allowed) {
    const copy =
      access.reason === 'not_invited'
        ? REAL_ASK_COPY.notInvited
        : access.reason === 'profile_incomplete'
          ? REAL_ASK_COPY.profileIncomplete
          : access.reason === 'not_configured'
            ? REAL_ASK_COPY.notConfigured
            : `Something broke on our side.`;
    return fail(errorText(`${copy} ${NOTHING_SENT}`, access.reason === 'profile_incomplete' ? `next: the user adds them at ${absoluteUrl('/me#settings')}, then call send_ask again.` : 'next: send it to the SAMPLE network with network "sample", or try again later.'));
  }
  const created = await createAsk(member, { text: d.raw, compiled, idempotency_key: d.id });
  if (!created.ok) {
    if (created.reason === 'db_down') return fail(ERRORS.dbDown());
    return fail(errorText(created.message, created.reason === 'too_soon' ? 'next: send it after that date, or as a new ask.' : 'next: call draft_ask with a new ask.'));
  }
  if (created.status === 'queued') {
    const ids = (await openAskIds(member)).filter((x) => x !== created.id);
    await saveDraft({ ...d, state: 'sent', ask_id: created.id, owner_id: member.id, network: 'real' });
    return fail(errorText(ERRORS.tooManyOpen(ids), `next: it is saved as ${created.id} and sends on its own; my_asks shows it.`));
  }
  const started = Date.now();
  const stop = linked(signal);
  const start = await startSend(created.id, member, { clientKey: ctx.clientKey, signal: stop.signal });
  if (!start.ok) {
    const b = start.body;
    if (b.error === 'already_sent') {
      await saveDraft({ ...d, state: 'sent', ask_id: created.id, owner_id: member.id, network: 'real' });
      return ok(alreadySentText(created.id, created.created_at, false));
    }
    if (b.error === 'queued') return fail(errorText(ERRORS.tooManyOpen(await openAskIds(member)), `next: it is saved as ${created.id}; my_asks shows it.`));
    return fail(errorText(b.message, `next: the ask is saved as ${created.id}; my_asks shows its status.`));
  }
  await saveDraft({ ...d, state: 'sent', ask_id: created.id, owner_id: member.id, network: 'real' });
  // The REAL fan-out runs detached on the server: leaving the stream early never stops it (BE2 startSend).
  const { items, finished } = await collect<FanoutEvent>(start.events, BUDGET_MS.real);
  let total = 0;
  let offer: { reply_by: string } | null = null;
  let done: Extract<FanoutEvent, { event: 'done' }>['data'] | null = null;
  const questions: { qid: string; type: import('@/lib/types').QuestionType; text: string; gates: number }[] = [];
  const counts = { offered: 0, next: 0, question: 0, nothistime: 0 };
  for (const e of items) {
    if (e.event === 'plan') total = e.data.total;
    else if (e.event === 'cell') {
      const s = (e.data as { state: string }).state;
      if (s === 'offered' || s === 'next' || s === 'question' || s === 'nothistime') counts[s] += 1;
    } else if (e.event === 'question') questions.push({ qid: e.data.qid, type: e.data.type, text: e.data.text, gates: e.data.gates });
    else if (e.event === 'offer') offer = { reply_by: e.data.expires_at };
    else if (e.event === 'done') done = e.data;
    else if (e.event === 'error' && !finished) break;
  }
  if (!finished && done === null && items.length === 0) return fail(ERRORS.modelSlow());
  return ok(
    sendRealReceipt({
      id: created.id,
      total,
      counts: done ? done.counts : counts,
      offer,
      people_interrupted: done ? done.people_interrupted : offer ? 1 : 0,
      question_list: questions,
      failed: done?.gates_failed ?? 0,
      failed_closed: done?.failed_closed ?? false,
      wall_ms: Date.now() - started,
      still_sending: !finished,
    }),
  );
}

/* ========================================================================== *
 * answer_question (open on SAMPLE ids; token for REAL)
 * ========================================================================== */

export interface AnswerArgs {
  ask_id: string;
  question_id: string;
  answer: string;
}

export async function answerAsk(args: AnswerArgs, ctx: McpRequestContext, signal?: AbortSignal): Promise<ToolText> {
  const answer = String(args.answer ?? '').replace(/\s+/g, ' ').trim();
  if (!answer || answer.length > ANSWER_MAX) return fail(errorText(`An answer is 1 to ${ANSWER_MAX} characters. Nothing was sent.`, 'next: shorten it with the user and call answer_question again.'));
  const askId = String(args.ask_id ?? '');
  const questionId = String(args.question_id ?? '');
  const started = Date.now();

  if (isSampleAskId(askId)) {
    const type = questionTypeFor(askId, questionId);
    if (!type) return fail(errorText(`No question ${dataText(questionId, 24)} on the SAMPLE ask ${askId}.`, 'next: the send_ask receipt names the question id.'));
    let compiled = recallSampleSend(askId)?.compiled ?? null;
    if (!compiled) {
      const byAsk = await loadDraftByAsk(askId);
      if (byAsk.ok && byAsk.draft) compiled = compiledOf(byAsk.draft);
    }
    if (!compiled) {
      const sa = sampleNetworkAskById(askId);
      if (sa) compiled = sampleCompiled(sa);
    }
    if (!compiled) return fail(errorText(`This sample ask is no longer on the server. ${NOTHING_SENT}`, 'next: send the draft again with send_ask.'));
    const res = await answerSampleQuestion(
      { sample_ask_id: askId, compiled, you: null, question: { type, text: sampleQuestionText(askId, type) }, answer },
      { clientKey: ctx.clientKey, signal },
    );
    if (!res.ok) return fail(errorText(res.body.message, res.body.error === 'rate_limited' ? 'next: wait until then and answer again.' : 'next: send the draft again with send_ask.'));
    const authored = res.cells.length > 0 && res.cells.every((c) => c.source === 'authored');
    return ok(
      answerReceipt({
        ask_id: askId,
        network: 'sample',
        question: sampleQuestionText(askId, type),
        answer,
        reran: res.reran,
        accepted: res.accepted,
        offered_now: !!res.offer,
        authored,
        wall_ms: authored ? null : Date.now() - started,
      }),
    );
  }

  if (!isRealAskId(askId)) return fail(errorText(`No ask has the id ${dataText(askId, 24)}.`, 'next: my_asks lists your asks and their question ids.'));
  const auth = await requireMember(ctx, 'answer_question on a real ask');
  if (!auth.ok) return fail(auth.text);
  const before = await getAskerView(askId, auth.member);
  const res = await answerQuestion({ ask_id: askId, question_id: questionId, answer, user: auth.member, idempotency_key: `mcp:${askId}:${questionId}` });
  if (!res.ok) {
    const copy: Record<typeof res.reason, string> = {
      not_found: 'No question with that id on an ask of yours.',
      already_answered: 'That question already has an answer. Nothing new was sent.',
      bad_input: `An answer is 1 to ${ANSWER_MAX} characters. Nothing was sent.`,
      not_configured: `${REAL_ASK_COPY.notConfigured} ${NOTHING_SENT}`,
      db_down: `Something broke on our side. ${NOTHING_SENT}`,
      live_unavailable: `The gates that asked can’t rerun right now (live checks are unavailable). ${NOTHING_SENT} Your answer wasn’t saved.`,
    };
    return fail(errorText(copy[res.reason], 'next: my_asks shows the ask and its open questions.'));
  }
  const after = await getAskerView(askId, auth.member);
  const was = before.ok ? before.view.people_interrupted : 0;
  const now = after.ok ? after.view.people_interrupted : was;
  return ok(
    answerReceipt({
      ask_id: askId,
      network: 'real',
      question: res.question.text,
      answer: res.question.answer ?? answer,
      reran: res.reran,
      accepted: res.accepted,
      offered_now: now > was,
      authored: false,
      wall_ms: Date.now() - started,
      repeated: res.repeated,
    }),
  );
}

/* ========================================================================== *
 * my_asks, pending_for_me (token, read-only)
 * ========================================================================== */

export async function myAsks(ctx: McpRequestContext): Promise<ToolText> {
  const auth = await requireMember(ctx, 'my_asks');
  if (!auth.ok) return fail(auth.text);
  const list = await listMyAsks(auth.member);
  if (!list.ok) return fail(list.reason === 'not_configured' ? errorText(`${REAL_ASK_COPY.notConfigured}`, 'next: try_rules and draft_ask work without it.') : ERRORS.dbDown());
  const rows: MyAskRow[] = list.items.map((a) => ({ id: a.id, subject: a.subject, outcome: a.outcome, status: a.status_line }));
  // The open question on the first asks that wait on one (its id is what answer_question needs).
  for (const row of rows.filter((r) => r.outcome === 'question').slice(0, 3)) {
    const view = await getAskerView(row.id, auth.member);
    const q = view.ok ? view.view.questions.find((x) => !x.answer) : null;
    if (q) row.question = { id: q.id, type: q.type, text: q.text };
  }
  return ok(myAsksReceipt(rows));
}

export async function pendingForMe(args: { offer_id?: string }, ctx: McpRequestContext): Promise<ToolText> {
  const auth = await requireMember(ctx, 'pending_for_me');
  if (!auth.ok) return fail(auth.text);
  const res = await listPendingForMember(auth.member.id);
  if (!res.ok) return fail(res.reason === 'not_configured' ? errorText(REAL_ASK_COPY.notConfigured, 'next: try_rules and draft_ask work without it.') : ERRORS.dbDown());
  const p = res.pending;
  return ok(
    pendingReceipt({
      offers: p.offers.map((o) => ({
        offer_id: o.offer_id,
        title: o.title,
        asker: o.asker,
        matched: o.matched,
        ask_text: o.ask_text,
        price: o.facts.find(([label]) => label === 'Price')?.[1] ?? null,
        expires_at: o.expires_at,
      })),
      questions: p.questions,
      checkins: p.checkins,
      cap: p.cap,
      now: Date.now(),
      focus: args.offer_id ?? null,
    }),
  );
}

/* ========================================================================== *
 * respond (token; a person approves every call)
 * ========================================================================== */

export interface RespondArgs {
  offer_id: string;
  action: OfferAction;
  text?: string;
  reason?: NoReason;
  note?: string;
}

const REASON_WORDS: Readonly<Record<NoReason, string>> = {
  not_my_area: 'not my area',
  wrong_stage: 'wrong stage',
  not_specific: 'not specific',
  no_time: 'no time',
  other: 'other',
};

export async function respond(args: RespondArgs, ctx: McpRequestContext): Promise<ToolText> {
  const auth = await requireMember(ctx, 'respond');
  if (!auth.ok) return fail(auth.text);
  const member = auth.member;
  const offerId = String(args.offer_id ?? '');
  if (!/^o_[0-9A-Za-z]{3,16}$/.test(offerId)) return fail(errorText('No offer of yours has that id.', 'next: pending_for_me lists your offers.'));
  const action = args.action;
  const text = typeof args.text === 'string' ? args.text.replace(/\r\n?/g, '\n').trim() : '';
  if (action === 'answer' && (!text || text.length > ANSWER_MAX || text.split('\n').length > 3)) {
    return fail(errorText(`An answer is 1 to ${ANSWER_MAX} characters, at most 3 lines, without your name. Nothing was sent.`, 'next: write it with the user and call respond again.'));
  }
  const ref = { offer_id: offerId, member_id: member.id };
  const res = await respondToOffer(ref, action, { answer: action === 'answer' ? text : undefined, idempotency_key: `mcp:${offerId}:${action}` });
  if (!res.ok) {
    const o = res.offer;
    const copy: Record<typeof res.reason, string> = {
      invalid: 'No offer of yours has that id.',
      expired: `That offer expired: 72 hours passed without a reply, so it moved to the next person in line.${o ? ` It still counted as ${o.nth} of your ${o.cap} this month.` : ''}`,
      already_acted: `You already answered this offer${o?.responded_at ? ` at ${fmtDay(toMs(o.responded_at), NETWORK_TZ)}` : ''}. Nothing changed.`,
      withdrawn: 'The asker withdrew this ask; it’s no longer needed. Nothing changed.',
      bad_input: `An answer is 1 to ${ANSWER_MAX} characters, at most 3 lines. Nothing was sent.`,
      not_configured: `${REAL_ASK_COPY.notConfigured} Nothing changed.`,
      db_down: `Something broke on our side. Nothing changed.`,
    };
    return fail(errorText(copy[res.reason], 'next: pending_for_me shows what still waits on you.'));
  }
  const offer = res.offer;
  const at = offer.responded_at ?? new Date().toISOString();
  let edit: { context: string | null; add: string } | null = null;
  let reasonWords: string | null = null;
  if (action === 'no' && args.reason) {
    const note = typeof args.note === 'string' ? args.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : null;
    const saved = await setNoReason(ref, args.reason, note || null);
    if (saved.ok) {
      reasonWords = REASON_WORDS[args.reason];
      const profile = await getMemberProfile(member.id);
      if (profile.ok && profile.member) {
        edit = suggestRuleEdit(args.reason, {
          rules: profile.member.rules,
          matchedLine: offer.matched?.line ?? null,
          topic: offer.topic,
          askText: offer.facts.map(([, v]) => v).join(' '),
          companies: [offer.asker.company],
        });
      }
    }
  }
  return ok(
    respondReceipt({
      offer_id: offer.offer_id,
      action,
      at,
      asker: { name: offer.asker.name, first: offer.asker.first },
      scheduling_url: offer.scheduling_url,
      cap: offer.cap,
      nth: offer.nth,
      emailed: flags.hasResend,
      checkins: action === 'ok' ? { d1: localDayAt(toMs(at), 1, 10).toISOString(), d14: localDayAt(toMs(at), 14, 10).toISOString() } : null,
      edit,
      reason: reasonWords,
      repeated: res.repeated,
    }),
  );
}

/* ========================================================================== *
 * set_rules (token)
 * ========================================================================== */

export async function setRules(args: { rules: string }, ctx: McpRequestContext, signal?: AbortSignal): Promise<ToolText> {
  const rules = typeof args.rules === 'string' ? args.rules.trim() : '';
  if (!rules) return fail(errorText('Write at least one rule. Nothing was saved.', 'next: call set_rules with the rules the user approved.'));
  if (rules.length > RULES_MAX) return fail(errorText(`Rules are at most ${RULES_MAX.toLocaleString('en-US')} characters. Nothing was saved.`, 'next: shorten them with the user.'));
  const auth = await requireMember(ctx, 'set_rules');
  if (!auth.ok) return fail(auth.text);
  const profileBefore = await getMemberProfile(auth.member.id);
  const cap = profileBefore.ok && profileBefore.member ? profileBefore.member.cap : DEFAULT_CAP;

  // Test on the 12 SAMPLE asks first (live when it can run; a preset's recorded file otherwise).
  let test: Parameters<typeof setRulesReceipt>[0]['test'] = { not_tested: 'live checks are unavailable' };
  const stop = linked(signal);
  const start = await startTry({ rules, mode: 'auto' }, { clientKey: ctx.clientKey, signal: stop.signal });
  if (start.ok) {
    const { items } = await collect<TryEvent>(start.events, BUDGET_MS.try, stop);
    const rows: CapRow[] = SAMPLE_ASKS.map((a) => ({ ask_id: a.id, day: a.day, gate: null, error: null }));
    let source: 'live' | 'recorded' | 'authored' = 'live';
    let mode: 'live' | 'recorded' = 'live';
    for (const e of items) {
      if (e.event === 'plan') mode = e.data.mode;
      else if (e.event === 'gate') {
        const r = rows[e.data.i];
        if (r) r.gate = { verdict: e.data.verdict, decided_by: e.data.decided_by };
        source = e.data.source;
      } else if (e.event === 'error' && typeof e.data.i === 'number') {
        const r = rows[e.data.i];
        if (r) r.error = e.data.kind;
      }
    }
    if (mode === 'live') source = 'live';
    const display = applyCap(rows, cap).results.map((r) => r.display);
    const n = (k: string) => display.filter((d) => d === k).length;
    test = { reach: n('reach'), held: n('held'), ask: n('ask'), declined: n('decline') + n('code'), failed: n('failed') + n('notrun'), source };
  } else if (start.body.error === 'live_unavailable') test = { not_tested: liveUnavailableSentence(start.body.live, start.body.until).replace(/\.$/, '').toLowerCase() };
  else if (start.body.error === 'rate_limited') test = { not_tested: 'live runs from this address are rate-limited for a few minutes' };

  const saved = await saveRules(auth.member.id, rules, 'mcp');
  if (!saved.ok) {
    if (saved.reason === 'bad_input') return fail(errorText(saved.message ?? 'Those rules can’t be saved.', 'next: fix them with the user.'));
    if (saved.reason === 'not_configured') return fail(errorText(`${REAL_ASK_COPY.notConfigured} Nothing was saved.`, 'next: try_rules works without it.'));
    return fail(ERRORS.dbDown());
  }
  const profile = await getMemberProfile(auth.member.id);
  const m = profile.ok ? profile.member : null;
  const unchanged = profileBefore.ok && !!profileBefore.member && profileBefore.member.rules_version === saved.version;
  return ok(
    setRulesReceipt({
      version: saved.version,
      at: m?.rules_saved_at ?? new Date().toISOString(),
      lines: rules.split('\n').filter((l) => l.trim()).length,
      cap: m?.cap ?? cap,
      show_matched: m?.show_matched ?? false,
      guests: m?.accept_guests ?? false,
      unchanged,
      test,
    }),
  );
}

/* ========================================================================== *
 * record_outcome (token)
 * ========================================================================== */

export interface OutcomeArgs {
  checkin_id: string;
  rating?: number;
  not_yet?: boolean;
  wont_happen?: boolean;
  reason?: WontHappenReason;
  outcome?: D14Outcome;
  note?: string;
}

export function outcomeAnswer(args: OutcomeArgs): CheckinAnswer | null {
  const given = [args.rating !== undefined, !!args.not_yet, !!args.wont_happen, args.outcome !== undefined].filter(Boolean).length;
  if (given !== 1) return null;
  if (args.rating !== undefined) return Number.isInteger(args.rating) && args.rating >= 1 && args.rating <= 5 ? { kind: 'd1', rating: args.rating as 1 | 2 | 3 | 4 | 5 } : null;
  if (args.not_yet) return { kind: 'd1', not_yet: true };
  if (args.wont_happen) return { kind: 'd1', wont_happen: true, reason: args.reason ?? null };
  const note = typeof args.note === 'string' ? args.note.replace(/\s+/g, ' ').trim() : '';
  return { kind: 'd14', outcome: args.outcome as D14Outcome, note: note ? note.slice(0, NOTE_MAX) : null };
}

export async function recordOutcome(args: OutcomeArgs, ctx: McpRequestContext): Promise<ToolText> {
  const answer = outcomeAnswer(args);
  if (!answer) {
    return fail(
      errorText(
        'Send exactly one answer: rating 1 to 5 (the call happened), not_yet, or wont_happen for a +1 day check-in; outcome for a +14 day one. Nothing was saved.',
        'next: pending_for_me lists the check-ins and their kind.',
      ),
    );
  }
  const auth = await requireMember(ctx, 'record_outcome');
  if (!auth.ok) return fail(auth.text);
  const checkinId = String(args.checkin_id ?? '');
  const res = await saveCheckin({ checkin_id: checkinId, member_id: auth.member.id }, answer, `mcp:${checkinId}`);
  if (!res.ok) {
    const copy: Record<typeof res.reason, string> = {
      invalid: 'No check-in of yours has that id.',
      closed: 'That check-in closed 30 days after the intro. Nothing was saved.',
      bad_input: res.checkin ? `That answer doesn’t fit a ${res.checkin.kind === 'd1' ? '+1 day check-in (rating, not_yet or wont_happen)' : '+14 day check-in (outcome)'}. Nothing was saved.` : 'That answer doesn’t fit this check-in. Nothing was saved.',
      not_configured: `${REAL_ASK_COPY.notConfigured} Nothing was saved.`,
      db_down: 'Something broke on our side. Nothing was saved.',
    };
    return fail(errorText(copy[res.reason], 'next: pending_for_me lists the check-ins that are due.'));
  }
  const c = res.checkin;
  return ok(
    outcomeReceipt({
      checkin_id: c.checkin_id,
      at: c.answered_at ?? new Date().toISOString(),
      kind: c.kind,
      role: c.role,
      answer: c.answer ?? answer,
      reminder_at: c.reminder_at,
      repeated: res.repeated,
    }),
  );
}

