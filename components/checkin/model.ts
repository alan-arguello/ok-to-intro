/**
 * The check-in page (/c/[token], ux-spec S5) as data. GET preselects from the email's link (`?v=4`), one POST
 * saves (and can change the answer until the window closes). Pure and serializable; safe in client and server code.
 *
 * URL parameters: `v` (1–5 | notyet | wont for +1 day; unblocked | customer | hire | investor | nothing_yet for
 * +14 days), `why` (no_reply | wrong_person | timing, after “It won’t happen”), `done=1` (just saved), `change=1`
 * (answer again), `error=server|input`. SAMPLE adds `kind=14d`, `who=asker|member` (or `role=`) and `ask=<id>`;
 * QA adds `state=<prototype state>`.
 */

import { QA_STATES, type QaState } from '@/lib/qa';
import type { CheckinAnswer, CheckinKind, CheckinRole, CheckinView, D14Outcome, WontHappenReason } from '@/lib/types';
import { isLoopAskId, param, type Params } from '@/components/offer/model';

export type CheckinMode = 'sample' | 'example' | 'real';
export type CheckinScreenView = 'form' | 'saved' | 'already' | 'closed' | 'invalid' | 'unconfigured' | 'broken';

export const D1_VALUES = ['1', '2', '3', '4', '5', 'notyet', 'wont'] as const;
export type D1Value = (typeof D1_VALUES)[number];
export const D14_VALUES: readonly D14Outcome[] = ['unblocked', 'customer', 'hire', 'investor', 'nothing_yet'];

export const D14_LABEL: Readonly<Record<D14Outcome, string>> = {
  unblocked: 'Unblocked',
  customer: 'A customer',
  hire: 'A hire',
  investor: 'An investor',
  nothing_yet: 'Nothing yet',
};

export const WONT_REASONS: readonly (readonly [WontHappenReason, string])[] = [
  ['no_reply', 'No reply'],
  ['wrong_person', 'Wrong person'],
  ['timing', 'Timing'],
];

/** A value valid for this kind (`nothing` is accepted for `nothing_yet`), or null. */
export function checkinValue(raw: string | null, kind: CheckinKind): string | null {
  if (!raw) return null;
  if (kind === 'd1') return (D1_VALUES as readonly string[]).includes(raw) ? raw : null;
  const v = raw === 'nothing' ? 'nothing_yet' : raw;
  return (D14_VALUES as readonly string[]).includes(v) ? v : null;
}

export function wontReason(raw: string | null): WontHappenReason | null {
  return WONT_REASONS.find(([k]) => k === raw)?.[0] ?? null;
}

/** The answer a POST records, or null when the value doesn't fit the kind. */
export function toAnswer(kind: CheckinKind, value: string | null, reason: string | null, note: string | null): CheckinAnswer | null {
  const v = checkinValue(value, kind);
  if (!v) return null;
  if (kind === 'd14') {
    const n = (note ?? '').replace(/\s+/g, ' ').trim();
    return { kind: 'd14', outcome: v as D14Outcome, note: n ? n.slice(0, 140) : null };
  }
  if (v === 'notyet') return { kind: 'd1', not_yet: true };
  if (v === 'wont') return { kind: 'd1', wont_happen: true, reason: wontReason(reason) };
  return { kind: 'd1', rating: Number(v) as 1 | 2 | 3 | 4 | 5 };
}

/** The `v=` value of a saved answer. */
export function answerValue(a: CheckinAnswer | null): string | null {
  if (!a) return null;
  if (a.kind === 'd14') return a.outcome;
  if ('rating' in a) return String(a.rating);
  if ('not_yet' in a) return 'notyet';
  return 'wont';
}

/** “4 of 5”, “we haven’t talked yet”, “it won’t happen”, “A customer” ([already-answered]). */
export function answerText(kind: CheckinKind, value: string | null): string {
  if (!value) return '';
  if (kind === 'd14') return D14_LABEL[value as D14Outcome] ?? '';
  if (/^[1-5]$/.test(value)) return `${value} of 5`;
  return value === 'notyet' ? 'we haven’t talked yet' : 'it won’t happen';
}

/** “Save: 4 of 5” · “Save: not yet” · “Save: won’t happen” · “Save”. */
export function saveLabel(kind: CheckinKind, value: string | null): string {
  if (kind === 'd14' || !value) return 'Save';
  if (/^[1-5]$/.test(value)) return `Save: ${value} of 5`;
  return value === 'notyet' ? 'Save: not yet' : 'Save: won’t happen';
}

export interface CheckinQuery {
  qa: QaState<'checkin'> | null;
  v: string | null;
  why: WontHappenReason | null;
  done: boolean;
  change: boolean;
  error: 'server' | 'input' | null;
  /** SAMPLE and QA only (REAL reads both from the check-in). */
  kind: CheckinKind | null;
  role: CheckinRole | null;
  ask: string | null;
}

export function parseCheckinQuery(sp: Params, qaOn: boolean): CheckinQuery {
  const kindRaw = param(sp, 'kind');
  const roleRaw = param(sp, 'who') ?? param(sp, 'role');
  const ask = param(sp, 'ask');
  const state = param(sp, 'state');
  return {
    qa: qaOn && state && (QA_STATES.checkin as readonly string[]).includes(state) ? (state as QaState<'checkin'>) : null,
    v: param(sp, 'v'),
    why: wontReason(param(sp, 'why')),
    done: param(sp, 'done') === '1',
    change: param(sp, 'change') === '1',
    error: param(sp, 'error') === 'server' ? 'server' : param(sp, 'error') === 'input' ? 'input' : null,
    kind: kindRaw === '14d' || kindRaw === 'd14' ? 'd14' : kindRaw === '1d' || kindRaw === 'd1' ? 'd1' : null,
    role: roleRaw === 'member' ? 'member' : roleRaw === 'asker' ? 'asker' : null,
    ask: isLoopAskId(ask) ? ask : null,
  };
}

export interface CheckinUi {
  view: CheckinScreenView;
  kind: CheckinKind;
  role: CheckinRole;
  /** The selected (form) or saved (result) value. */
  value: string | null;
  reason: WontHappenReason | null;
  failed: 'client' | 'server' | 'input' | null;
}

/** The prototype's default preselection (an email link always carries `v`). */
function defaultValue(kind: CheckinKind): string {
  return kind === 'd14' ? 'customer' : '4';
}

/** SAMPLE and the QA example: the URL is the whole state. */
export function uiFromQuery(q: CheckinQuery): CheckinUi {
  if (q.qa) return uiFromQa(q);
  const kind = q.kind ?? 'd1';
  const role: CheckinRole = q.role ?? 'asker';
  const value = checkinValue(q.v, kind) ?? defaultValue(kind);
  const reason = value === 'wont' ? q.why : null;
  if (q.done && !q.change) return { view: 'saved', kind, role, value, reason, failed: null };
  return { view: 'form', kind, role, value, reason, failed: q.error };
}

function uiFromQa(q: CheckinQuery): CheckinUi {
  const s = q.qa as QaState<'checkin'>;
  const base = (kind: CheckinKind, role: CheckinRole, view: CheckinScreenView, fallback?: string): CheckinUi => {
    const value = checkinValue(q.v, kind) ?? fallback ?? defaultValue(kind);
    return { view, kind, role, value, reason: value === 'wont' ? q.why : null, failed: null };
  };
  switch (s) {
    case 'd1-preselected':
      return base('d1', 'asker', 'form');
    case 'member-d1':
      return base('d1', 'member', 'form');
    case 'd14-preselected':
      return base('d14', q.role ?? 'asker', 'form');
    case 'd1-saved':
      return base('d1', q.role ?? 'asker', 'saved');
    case 'd1-notyet':
      return { ...base('d1', q.role ?? 'asker', 'saved'), value: 'notyet', reason: null };
    case 'd1-wont':
      return { ...base('d1', 'asker', 'saved'), value: 'wont', reason: q.why };
    case 'd14-saved':
      return base('d14', q.role ?? 'asker', 'saved');
    case 'already-answered':
      return base(q.kind ?? 'd1', q.role ?? 'asker', 'already');
    case 'closed':
      return base(q.kind ?? 'd1', q.role ?? 'asker', 'closed');
    case 'invalid':
      return base('d1', 'asker', 'invalid');
    case 'save-failed':
      return { ...base(q.kind ?? 'd1', q.role ?? 'asker', 'form'), failed: 'client' };
  }
}

/**
 * REAL: the check-in in the database decides. A closed window reads “closed” (unless this POST just saved);
 * an answered check-in reads “You answered on …” unless the person asked to change it.
 */
export function uiFromRecord(c: CheckinView, q: CheckinQuery, now: number): CheckinUi {
  const kind = c.kind;
  const role = c.role;
  const saved = answerValue(c.answer);
  const savedReason = c.answer && c.answer.kind === 'd1' && 'wont_happen' in c.answer ? c.answer.reason : null;
  const closed = Date.parse(c.closes_at) <= now;
  if (q.done && saved) return { view: 'saved', kind, role, value: saved, reason: savedReason, failed: null };
  if (closed) return { view: 'closed', kind, role, value: saved, reason: savedReason, failed: null };
  if (saved && !q.change) return { view: 'already', kind, role, value: saved, reason: savedReason, failed: null };
  const value = checkinValue(q.v, kind) ?? saved;
  const reason = value === 'wont' ? (q.why ?? savedReason) : null;
  return { view: 'form', kind, role, value, reason, failed: q.error };
}

/** Which QA state shows a saved answer (the QA example's POSTs land there). */
export function savedQaState(kind: CheckinKind, role: CheckinRole, value: string): QaState<'checkin'> {
  if (kind === 'd14') return 'd14-saved';
  if (value === 'notyet') return 'd1-notyet';
  if (value === 'wont' && role === 'asker') return 'd1-wont';
  return 'd1-saved';
}

/** `/c/<ref>` plus the given query (empty values dropped). */
export function checkinHref(ref: string, query: Record<string, string | null | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/c/${encodeURIComponent(ref)}${s ? `?${s}` : ''}`;
}

/** What a SAMPLE page keeps across its own links and forms. */
export function sampleCheckinKeep(q: Pick<CheckinQuery, 'ask' | 'kind' | 'role'> & { change?: boolean }, ui: Pick<CheckinUi, 'kind' | 'role'>): Record<string, string> {
  const keep: Record<string, string> = {};
  if (q.ask) keep.ask = q.ask;
  if (ui.kind === 'd14') keep.kind = '14d';
  if (ui.role === 'member') keep.who = 'member';
  // “Change” reopens the form; the options keep it open (and focus lands on the saved choice, as on REAL).
  if (q.change) keep.change = '1';
  return keep;
}

/* ---------- the page model ---------- */

export interface CkTimeLabel {
  iso: string;
  text: string;
}

export type CheckinSource = { kind: 'none' } | { kind: 'canonical' } | { kind: 'ask'; id: string };

export interface CheckinForms {
  ref: string;
  csrf: string;
  mode: CheckinMode;
  /** Query the option links and the form keep (SAMPLE: ask, kind, who; QA: state). */
  keep: Record<string, string>;
}

export interface CheckinPageModel {
  nonce: string;
  self: string;
  mode: CheckinMode;
  ui: CheckinUi;
  source: CheckinSource;
  /** The other person, by full and first name. */
  other: { name: string; first: string } | null;
  /** “Hospital procurement in Mexico” (the intro's ask, without “, 20 min?”). */
  subject: string | null;
  introMade: CkTimeLabel | null;
  /** +14 days check-in date (“One more question on Nov 23”). */
  d14: CkTimeLabel | null;
  /** The one reminder after “We haven’t talked yet”. */
  reminder: CkTimeLabel | null;
  answeredOn: CkTimeLabel | null;
  closedOn: CkTimeLabel | null;
  /** The saved +14 day note, if any. */
  note: string;
  forms: CheckinForms | null;
  justActed: boolean;
}
