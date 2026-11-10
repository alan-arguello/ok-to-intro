/**
 * The offer page (/o/[token], ux-spec S4) as data: what the URL asks for, which view a state renders, and where each
 * POST lands. Pure and serializable; the server page builds an `OfferPageModel`, the client screen renders it, and
 * the server actions use the same URL builders so GET and POST agree. Safe in client and server code.
 *
 * URL parameters (all optional):
 * - `choice=ok|answer|no` preselects from the email's buttons: OK opens the confirm, Answer opens the composer,
 *   No moves the page's primary to No. A GET never changes anything.
 * - `done=ok|answer|no` says the member just acted (the next view comes from the offer's state, not from this).
 * - `why=area|stage|vague|busy|other` and `step=applied|undone|kept|cap|pause|saved`: the private “Why?” after a No.
 * - `error=server|input`: a POST that reached the server but didn't go through.
 * - SAMPLE only: `ask=<sa_…|a01…>` or `from=playground` (the card comes from the visitor's own tab).
 * - QA only (`qaEnabled()`): `state=<prototype state>` renders that state from the fixed example, plus `why`, `did`.
 */

import type { Fact, NoReason, OfferAction, OfferView } from '@/lib/types';
import { QA_STATES, type QaState } from '@/lib/qa';
import { isSampleAskId } from '@/lib/oti/ids';
import { upper1 } from '@/lib/oti/text';

export type OfferMode = 'sample' | 'example' | 'real';

export type OfferScreenView =
  | 'open'
  | 'confirm'
  | 'answer'
  | 'ok-sent'
  | 'answer-sent'
  | 'no'
  | 'already-acted'
  | 'expired'
  | 'withdrawn'
  | 'invalid'
  | 'unconfigured'
  | 'broken';

/** Views where the decision is over: no bar, no header meta, the card shown below in panel style. */
export const DONE_VIEWS: readonly OfferScreenView[] = ['ok-sent', 'answer-sent', 'no', 'already-acted', 'expired', 'withdrawn', 'invalid', 'unconfigured', 'broken'];
/** Views without a card at all. */
export const CARDLESS_VIEWS: readonly OfferScreenView[] = ['invalid', 'unconfigured', 'broken'];

export function isDoneView(v: OfferScreenView): boolean {
  return DONE_VIEWS.includes(v);
}

export type WhyKey = 'area' | 'stage' | 'vague' | 'busy' | 'other';
export type WhyStep = 'applied' | 'undone' | 'kept' | 'cap' | 'pause' | 'saved';

/** The five reasons, in order (ux-spec S4 [no-done]). */
export const WHY_OPTIONS: readonly (readonly [WhyKey, string])[] = [
  ['area', 'Not my area'],
  ['stage', 'Wrong stage'],
  ['vague', 'Not specific'],
  ['busy', 'No time this month'],
  ['other', 'Other'],
];

export const WHY_TO_REASON: Readonly<Record<WhyKey, NoReason>> = {
  area: 'not_my_area',
  stage: 'wrong_stage',
  vague: 'not_specific',
  busy: 'no_time',
  other: 'other',
};

export const REASON_TO_WHY: Readonly<Record<NoReason, WhyKey>> = {
  not_my_area: 'area',
  wrong_stage: 'stage',
  not_specific: 'vague',
  no_time: 'busy',
  other: 'other',
};

const ACTIONS: readonly OfferAction[] = ['ok', 'answer', 'no'];
const WHYS: readonly WhyKey[] = ['area', 'stage', 'vague', 'busy', 'other'];
const STEPS: readonly WhyStep[] = ['applied', 'undone', 'kept', 'cap', 'pause', 'saved'];

export type Params = Record<string, string | string[] | undefined>;

export function param(sp: Params, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s !== '' ? s : null;
}

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** A SAMPLE ask id the offer page accepts: `sa_…` (S2) or a playground ask `a01`…`a12`. */
export function isLoopAskId(id: string | null): id is string {
  return !!id && (isSampleAskId(id) || /^a(0[1-9]|1[0-2])$/.test(id));
}

export interface OfferQuery {
  qa: QaState<'offer'> | null;
  choice: OfferAction | null;
  done: OfferAction | null;
  why: WhyKey | null;
  step: WhyStep | null;
  error: 'server' | 'input' | null;
  did: OfferAction | null;
  ask: string | null;
  from: 'playground' | null;
}

export function parseOfferQuery(sp: Params, qaOn: boolean): OfferQuery {
  const ask = param(sp, 'ask');
  return {
    qa: qaOn ? pick(param(sp, 'state'), QA_STATES.offer) : null,
    choice: pick(param(sp, 'choice'), ACTIONS),
    done: pick(param(sp, 'done'), ACTIONS),
    why: pick(param(sp, 'why'), WHYS),
    step: pick(param(sp, 'step'), STEPS),
    error: pick(param(sp, 'error'), ['server', 'input'] as const),
    did: pick(param(sp, 'did'), ACTIONS),
    ask: isLoopAskId(ask) ? ask : null,
    from: param(sp, 'from') === 'playground' ? 'playground' : null,
  };
}

/** The view state the screen renders. */
export interface OfferUi {
  view: OfferScreenView;
  /** Arrived with `?choice=no`: “One tap on No passes.”, and No becomes the page's primary. */
  nohint: boolean;
  failed: 'client' | 'server' | 'input' | null;
  /** The member paused after this offer arrived (S4 [paused-member]). */
  paused: boolean;
  why: WhyKey | null;
  step: WhyStep | null;
  /** For [already-acted]: what the member did. */
  did: OfferAction;
}

const BASE_UI: OfferUi = { view: 'open', nohint: false, failed: null, paused: false, why: null, step: null, did: 'ok' };

function openViews(q: OfferQuery): Pick<OfferUi, 'view' | 'nohint'> {
  if (q.choice === 'ok') return { view: 'confirm', nohint: false };
  if (q.choice === 'answer') return { view: 'answer', nohint: false };
  return { view: 'open', nohint: q.choice === 'no' };
}

/** SAMPLE and the QA example: no database, so the URL is the whole state. */
export function uiFromQuery(q: OfferQuery): OfferUi {
  const failed = q.error;
  if (q.qa) return uiFromQa(q);
  if (q.done === 'ok') return { ...BASE_UI, view: 'ok-sent' };
  if (q.done === 'answer') return { ...BASE_UI, view: 'answer-sent' };
  if (q.done === 'no') return { ...BASE_UI, view: 'no', why: q.why, step: q.why ? q.step : null, failed: q.why ? failed : null };
  return { ...BASE_UI, ...openViews(q), failed };
}

/** The prototype's QA states (lib/qa.ts QA_STATES.offer), refined by `why`, `step`, `did`, `choice`. */
function uiFromQa(q: OfferQuery): OfferUi {
  const s = q.qa as QaState<'offer'>;
  switch (s) {
    case 'confirm-ok':
      return { ...BASE_UI, view: 'confirm' };
    case 'answer':
      return { ...BASE_UI, view: 'answer' };
    case 'ok-sent':
    case 'answer-sent':
    case 'already-acted':
    case 'expired':
    case 'withdrawn':
    case 'invalid':
      return { ...BASE_UI, view: s, did: q.did ?? 'ok' };
    case 'no-done':
      return { ...BASE_UI, view: 'no', why: q.why, step: q.why ? q.step : null, failed: q.why ? q.error : null };
    case 'no-reason-diff':
      return { ...BASE_UI, view: 'no', why: q.why === 'area' ? 'area' : 'stage', step: q.step === 'kept' || q.step === 'undone' ? q.step : null, failed: q.error };
    case 'no-reason-busy':
      return { ...BASE_UI, view: 'no', why: 'busy', step: q.step === 'cap' || q.step === 'pause' ? q.step : null, failed: q.error };
    case 'diff-applied':
      return { ...BASE_UI, view: 'no', why: q.why === 'area' ? 'area' : 'stage', step: 'applied' };
    case 'paused-member':
      return { ...BASE_UI, ...openViews(q), paused: true };
    case 'post-failed':
      return { ...BASE_UI, ...openViews(q), failed: 'client' };
    case 'open':
    case 'sample':
    default:
      return { ...BASE_UI, ...openViews(q), failed: q.error };
  }
}

/**
 * REAL: the offer's state in the database decides; the URL only picks between “you just did this” and “you did
 * this before”. An offer past its deadline reads as expired even if the lazy expiry hasn't written it yet.
 */
export function uiFromRecord(offer: OfferView, q: OfferQuery, now: number): OfferUi {
  switch (offer.state) {
    case 'pending': {
      if (offer.ask_withdrawn_at) return { ...BASE_UI, view: 'withdrawn' };
      if (Date.parse(offer.expires_at) <= now) return { ...BASE_UI, view: 'expired' };
      const paused = !!offer.paused_until && Date.parse(offer.paused_until) > now;
      return { ...BASE_UI, ...openViews(q), paused, failed: q.error };
    }
    case 'ok':
      return q.done === 'ok' ? { ...BASE_UI, view: 'ok-sent' } : { ...BASE_UI, view: 'already-acted', did: 'ok' };
    case 'answered':
      return q.done === 'answer' ? { ...BASE_UI, view: 'answer-sent' } : { ...BASE_UI, view: 'already-acted', did: 'answer' };
    case 'passed': {
      if (q.done !== 'no') return { ...BASE_UI, view: 'already-acted', did: 'no' };
      // The reason picked in this visit (URL) wins; otherwise the one already recorded.
      const why = q.why ?? (offer.no_reason ? REASON_TO_WHY[offer.no_reason] : null);
      return { ...BASE_UI, view: 'no', why, step: q.why ? q.step : null, failed: why ? q.error : null };
    }
    case 'expired':
      return { ...BASE_UI, view: 'expired' };
    case 'withdrawn':
      return { ...BASE_UI, view: 'withdrawn' };
  }
}

/* ---------- URLs ---------- */

/** `/o/<ref>` plus the given query (null and empty values dropped), in a stable order. */
export function offerHref(ref: string, query: Record<string, string | null | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/o/${encodeURIComponent(ref)}${s ? `?${s}` : ''}`;
}

/** Query a SAMPLE page keeps across its own forms (the loop's ask, or the playground). */
export function sampleKeep(q: Pick<OfferQuery, 'ask' | 'from'>): Record<string, string> {
  if (q.ask) return { ask: q.ask };
  if (q.from) return { from: q.from };
  return {};
}

/** Where a result lands on SAMPLE and REAL: `done`, `why`, `step`, `error`, `choice` plus the kept query. */
export function resultHref(ref: string, keep: Record<string, string>, r: { done?: OfferAction; why?: WhyKey | null; step?: WhyStep | null; error?: 'server' | 'input' | null; choice?: OfferAction | null }): string {
  return offerHref(ref, { ...keep, choice: r.choice ?? null, done: r.done ?? null, why: r.why ?? null, step: r.step ?? null, error: r.error ?? null });
}

/** Where a result lands on the QA example: the prototype's state names, so a reload shows the same state. */
export function exampleHref(ref: string, r: { done?: OfferAction; why?: WhyKey | null; step?: WhyStep | null; error?: 'server' | 'input' | null; choice?: OfferAction | null }): string {
  if (r.error) return offerHref(ref, { state: 'post-failed', choice: r.choice ?? null });
  if (r.done === 'ok') return offerHref(ref, { state: 'ok-sent' });
  if (r.done === 'answer') return offerHref(ref, { state: 'answer-sent' });
  const why = r.why ?? null;
  if (r.step === 'applied' && (why === 'area' || why === 'stage')) return offerHref(ref, { state: 'diff-applied', why });
  if (why === 'area' || why === 'stage') return offerHref(ref, { state: 'no-reason-diff', why, step: r.step === 'kept' || r.step === 'undone' ? r.step : null });
  if (why === 'busy') return offerHref(ref, { state: 'no-reason-busy', step: r.step === 'cap' || r.step === 'pause' ? r.step : null });
  return offerHref(ref, { state: 'no-done', why, step: why ? (r.step ?? null) : null });
}

/** Idempotency key for one action on one offer (CONTRACT §forms: token + action; the raw token is never stored). */
export function idempotencyKey(offerId: string, action: OfferAction): string {
  return `${offerId}:${action}`;
}

/* ---------- the card ---------- */

export interface OfferCardModel {
  title: string;
  /** “Maya Bennett · Oakline Health · Seed · Chicago”. */
  from: string;
  /** The member's own words at the offsets code found, or null. */
  matched: string | null;
  /** Problem, Needs (as the founder wrote it), Tried, By, Offers, Price. */
  facts: Fact[];
  /** First name of the asker, or “the founder” on SAMPLE loops. */
  who: string;
  cap: number;
  nth: number;
}

export function capText(c: Pick<OfferCardModel, 'cap' | 'nth'>): string {
  return `${c.nth} of your ${c.cap} this month`;
}

export function fineText(c: OfferCardModel): string {
  return `${upper1(c.who)} sees your name only if you choose OK. A No is private. This counts as ${c.nth} of your ${c.cap} whatever you answer.`;
}

/** The answer composer's rules: 280 characters and at most 2 line breaks (3 lines). */
export const ANSWER_MAX = 280;

/** Folds a 4th line and later into the 3rd (prototype b.js `syncAnswer`). */
export function clampAnswerLines(text: string): string {
  const parts = text.split('\n');
  return parts.length > 3 ? `${parts.slice(0, 3).join('\n')} ${parts.slice(3).join(' ')}` : text;
}

/** Server-side check of a 2-line answer: trimmed, 1..280 characters, at most 2 line breaks. */
export function normalizeAnswer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = clampAnswerLines(raw.replace(/\r\n?/g, '\n')).trim();
  if (!text || text.length > ANSWER_MAX) return null;
  return text;
}

/** A private note after “Other” (140 characters, one line). */
export const NOTE_MAX = 140;

export function normalizeNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > NOTE_MAX) return null;
  return text;
}

/** Removes the last rules line equal to `line` (trimmed), for Undo after “Add to my rules”; null when it isn't there. */
export function withoutLine(rules: string, line: string): string | null {
  const lines = rules.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] as string).trim() === line.trim()) {
      lines.splice(i, 1);
      return lines.join('\n').replace(/\n+$/, '');
    }
  }
  return null;
}

/* ---------- the page model the server hands the client ---------- */

/** A time shown on the page: the ISO instant plus its server label (network time, used without JS). */
export interface TimeLabel {
  iso: string;
  text: string;
}

/** Where the card comes from on SAMPLE: the canonical sample, the S2 loop's ask, or the playground's top row. */
export type SampleSource = { kind: 'none' } | { kind: 'canonical' } | { kind: 'ask'; id: string } | { kind: 'playground' };

export interface OfferEditModel {
  /** A line already in the member's rules (diff context), or null. */
  context: string | null;
  add: string;
  /** “Expected on the 12 sample asks (written by hand, not a model run): …” or SUGGESTED_EDIT_UNTESTED. */
  caption: string;
}

export interface OfferForms {
  /** The URL segment: the link token, an `o_…` id, or `sample`. */
  ref: string;
  csrf: string;
  mode: OfferMode;
  /** For idempotency keys (`o_…:ok`). */
  offerId: string;
  /** Query the GET forms keep (SAMPLE: `ask` / `from`; QA: `state` is replaced by the view). */
  keep: Record<string, string>;
}

export interface OfferPageModel {
  /** Changes on every server render, so the client screen starts fresh after a POST lands. */
  nonce: string;
  /** This page's own path and query (“Try again”). */
  self: string;
  mode: OfferMode;
  ui: OfferUi;
  card: OfferCardModel | null;
  source: SampleSource;
  /** “71 h left”. */
  hours: number | null;
  /** “Dec 1” when the member paused after the offer arrived. */
  pausedUntil: string | null;
  /** “Dec 1”: when “Pause until …” would end (the next cap month). */
  pauseUntil: string;
  /** The templated No edit for `why` area/stage (null: nothing to suggest). */
  edit: OfferEditModel | null;
  /** “Rules updated, version 4.” */
  rulesVersion: number | null;
  /** [already-acted]. */
  acted: TimeLabel | null;
  /** [ok-sent] “We emailed you and Maya at 21:16”. */
  okAt: TimeLabel | null;
  /** [expired] “on Thu Nov 12 at 21:04”. */
  expiredAt: TimeLabel | null;
  /** [withdrawn] “on Tue Nov 10”. */
  withdrawnOn: TimeLabel | null;
  /** [ok-sent] “with your scheduling link”. */
  scheduling: boolean;
  /** True on the canonical SAMPLE card and the QA example (Priya's rules): the hand-written edits apply. */
  base: boolean;
  forms: OfferForms | null;
  /** The page was reached by a POST (focus moves to the result, which is announced). */
  justActed: boolean;
}
