/**
 * S3 copy (/join, /me, /pause/[token]): verbatim from ux-spec S3 and the prototype (join.html, me.html, pause.html,
 * b.js), with the contract's honesty fixes (docs/CONTRACT.md §e.12). Pure: safe in server and client code.
 * Strings that other owners print live in lib/oti/copy.ts.
 */

import { capMonth, fmtClock, fmtDay, monthName, nextMonthStart, NETWORK_TZ, resetsOn, toMs } from '@/lib/oti/time';
import { fmtN, plural } from '@/lib/oti/text';
import type { AskerOutcome, MemberStatus } from '@/lib/types';

/* ---------- /join ---------- */

/**
 * Email-code timings the page and the server agree on (tech.md “email_and_links”). Supabase allows one code per
 * email a minute and answers the same `otp_expired` for a wrong code and an expired one, so a rejected code older
 * than CODE_TTL_S reads “That code expired.” (set Supabase Auth's email OTP expiry to 900 s to match).
 */
export const OTP_TIMING = {
  resendAfterS: 60,
  /** The resend line turns into “The code is taking longer than usual…” at this many seconds left (ux-spec: after 30 s). */
  slowAtS: 31,
  triesPerCode: 5,
  codeTtlS: 900,
} as const;

export const JOIN_COPY = {
  titleSignIn: 'Sign in',
  titleJoin: 'Join with your rules',
  lede: 'We email you a 6-digit code. No password.',
  newHere: 'New here?',
  writeFirst: 'Write your rules first ›',
  carriedLabel: 'From the playground',
  emailLabel: 'Email',
  emailPlaceholder: 'you@company.com',
  sendCode: 'Send code',
  /**
   * §e.12: Supabase Auth keeps the email once a code is requested, so the prototype's “Nothing is stored until you
   * enter the code.” is never shown; with no carried rules there is no true equivalent, so the line is omitted.
   */
  helpCarried: 'Your rules are saved only after you enter the code.',
  codeLabel: '6-digit code',
  verify: 'Verify',
  change: 'Change',
  resendCode: 'Resend code',
  sendNewOne: 'Send a new one',
  emailInvalid: 'That doesn’t look like an email.',
  codeIncomplete: 'Enter all 6 digits.',
  codeExpired: 'That code expired.',
  noTries: 'That code didn’t match. No tries left.',
  offline: 'Didn’t go through. Check your connection and try again.',
  down: 'Something broke on our side. Nothing was sent to anyone.',
  tryAgain: 'Try again',
  notAuthorized: 'This instance can only email codes to its own team for now.',
  limitedSoon: 'Too many codes requested. Try again in a few minutes.',
  triesLimited: 'Too many tries. Try again in a few minutes.',
  unavailableTitle: 'Sign-in isn’t set up on this instance.',
  unavailableBody: 'The playground, the sample asks and the sample offer work without an account.',
  tryPlayground: 'Try the playground',
} as const;

/** “That code didn’t match. 4 tries left.” */
export function codeWrong(triesLeft: number): string {
  return triesLeft > 0 ? `That code didn’t match. ${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.` : JOIN_COPY.noTries;
}

/** “Too many codes requested. Try again at 10:40.” (`clock` in the viewer's zone). */
export function codesLimited(clock: string): string {
  return `Too many codes requested. Try again at ${clock}.`;
}

/** “Too many tries. Try again at 10:40.” (per address, or per email across codes; `clock` in the viewer's zone). */
export function triesLimited(clock: string): string {
  return `Too many tries. Try again at ${clock}.`;
}

/** “Resend code in 0:47”. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The carried card meta: “4 lines · cap 2 · Engineer” (“Custom” once the visitor changed the preset's text). */
export function carriedMeta(rules: string, cap: number, label: string): string {
  const n = rules.split('\n').filter((l) => l.trim()).length;
  return `${n} ${n === 1 ? 'line' : 'lines'} · cap ${cap} · ${label}`;
}

/* ---------- /me ---------- */

/** Rules as stored: \r\n → \n and no trailing whitespace at the end (the server applies the same before saving). */
export function normalizeRules(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '');
}

export const ME_COPY = {
  title: 'Your gate',
  protoNote: 'Prototype: example numbers for layout. Signed in as the sample member Priya Shah.',
  protoRows: 'Prototype: example rows.',
  notOnYet: 'Not on yet',
  offersGoToOthers: 'offers go to others',
  pause: 'Pause',
  pauseNewAsks: 'Pause new asks',
  pauseAsks: 'Pause asks',
  resume: 'Resume',
  testRules: 'Test my rules ›',
  thisMonth: 'This month',
  editRules: 'Edit rules',
  cancel: 'Cancel',
  settings: 'Settings',
  name: 'Name',
  nameError: 'Add your name. It goes in the intro email.',
  oneLine: 'Who you are, in one line',
  oneLineHelp: 'Shown to askers only after you say OK.',
  company: 'Company',
  stage: 'Stage',
  city: 'City',
  capLabel: 'Monthly cap',
  capHelp: 'Counted when an ask is offered to you, even if you pass. Enforced in Postgres.',
  link: 'Scheduling link',
  linkPlaceholder: 'https://cal.com/you/20min',
  linkError: 'Use a link that starts with https://',
  linkHelp: 'Goes in the intro email, only after you say OK.',
  matchedLabel: 'Show askers the line that matched',
  matchedOff: 'Asker sees: “Matched a member’s rules.”',
  yourRules: 'Your rules',
  fromPlayground: 'From the playground',
  edit: 'Edit',
  rulesEmpty: 'Write at least one rule.',
  rulesTooLong: 'Your rules are over 1,000 characters.',
  rulesPlaceholder: 'Happy to talk to founders about churn, activation or support load.',
  save: 'Save',
  retry: 'Retry',
  discard: 'Discard',
  unsaved: 'Unsaved changes',
  saveFailed: 'Didn’t save. Your changes are still here.',
  turnOn: 'Turn on my gate',
  yourAsks: 'Your asks',
  newAsk: 'New ask',
  noAsks: 'No asks yet.',
  askTheNetwork: 'Ask the network ›',
  asksDown: 'Your asks didn’t load. Reload the page to try again.',
  whoSeesWhat: 'Who sees what',
  tokenTitle: 'Claude Code token',
  tokenIntro: 'Lets Claude Code answer offers and send asks for you.',
  tokenHow: 'How it works',
  createToken: 'Create a token',
  revoke: 'Revoke',
  copy: 'Copy',
  revoked: 'Revoked. Claude Code can no longer send or answer for you.',
  tokenOff: 'Claude Code tokens aren’t set up on this instance.',
  yourData: 'Your data',
  exportJson: 'Export (JSON)',
  deleteEverything: 'Delete everything',
  deleteConfirm: 'Delete your rules, cap, offers and check-ins now? Intros already sent stay in inboxes. This can’t be undone.',
  deletedTitle: 'Deleted.',
  deletedBody: 'Your rules, cap, offers and check-ins are gone. Board counts stay, without your name.',
  failed: 'Didn’t go through. Check your connection and try again.',
  downTitle: 'Something broke on our side',
  down: 'Something broke on our side. Nothing was sent to anyone.',
  notConfigured: 'Your gate isn’t set up on this instance.',
  carriedNotice: 'These rules came from the playground and aren’t saved yet.',
  reviewAsk: 'Review the ask',
} as const;

/** Shown once in the SAMPLE [token-created] state. Not a real token: nothing on any instance accepts it. */
export const SAMPLE_TOKEN = 'oti_7Hq2xK9mPvR4tL8wZc3nB5dF';

/** The table under “Who sees what” (ux-spec S3), also on /privacy. `null` = “–”. */
export const WHO_SEES_WHAT: readonly { what: string; you: true; askers: string | null }[] = [
  { what: 'Your rules', you: true, askers: null },
  { what: 'The line that matched', you: true, askers: 'only if you turn it on' },
  { what: 'Your cap and usage', you: true, askers: null },
  { what: 'That an ask reached you', you: true, askers: 'only after you say OK' },
  { what: 'Your No and its reason', you: true, askers: null },
  { what: 'Your name and email', you: true, askers: 'after you say OK' },
];

/** “Asker sees: “Matched: ‘B2B founders selling to enterprise customers …’.”” */
export function matchedOn(example: string): string {
  return `Asker sees: “Matched: ‘${example}’.”`;
}

/** “Cap 2 a month · 1 of 2 used in November · resets Dec 1”. `month` is the cap month (YYYY-MM-01, Pacific time). */
export function capStatusLine(cap: number, used: number, month: string): string {
  return `Cap ${cap} a month · ${used} of ${cap} used in ${monthName(month)} · resets ${resetsOn(month)}`;
}

/** “Saved 21:14 · version 3”. */
export function savedLine(clock: string, version: number): string {
  return `Saved ${clock} · version ${version}`;
}

/** The rules editor help. */
export function rulesHelp(on: boolean, version: number): string {
  return on ? `One rule per line. Saving makes version ${version + 1}; every decision records the version it used.` : 'One rule per line. Gates quote these lines word for word.';
}

/** “Your gate is on. Asks that match your rules can reach you from now on, at most 2 a month.” */
export function gateOnNotice(cap: number): string {
  return `Your gate is on. Asks that match your rules can reach you from now on, at most ${cap} a month.`;
}

/** “Nothing has reached you yet. With cap 2, at most 2 asks a month will.” */
export function nothingYet(cap: number): string {
  return `Nothing has reached you yet. With cap ${cap}, at most ${cap} ${cap === 1 ? 'ask' : 'asks'} a month will.`;
}

/* ---------- pause (/me popover and /pause/[token]) ---------- */

export type PauseChoice = '2w' | 'month' | 'off';
export const PAUSE_CHOICES: readonly PauseChoice[] = ['2w', 'month', 'off'];

export function isPauseChoice(v: unknown): v is PauseChoice {
  return v === '2w' || v === 'month' || v === 'off';
}

/** When a pause ends: 2 weeks from now, the next cap month (Pacific time), or never (null). Same rule as /api/pause. */
export function pauseUntil(choice: PauseChoice, nowMs: number): string | null {
  if (choice === '2w') return new Date(nowMs + 14 * 86_400_000).toISOString();
  if (choice === 'month') return nextMonthStart(capMonth(nowMs)).toISOString();
  return null;
}

/** Chip labels: 2 weeks · Until Dec 1 · Until I turn it back on. */
export function pauseChipLabel(choice: PauseChoice, nowMs: number): string {
  if (choice === '2w') return '2 weeks';
  if (choice === 'month') return `Until ${fmtDay(nextMonthStart(capMonth(nowMs)).getTime(), NETWORK_TZ)}`;
  return 'Until I turn it back on';
}

/** The paused status: “Until Dec 1” / “Until Nov 23” / “Until you turn it back on”. */
export function pausedUntilLabel(pausedUntil: string | null): string {
  return pausedUntil ? `Until ${fmtDay(toMs(pausedUntil), NETWORK_TZ)}` : 'Until you turn it back on';
}

/** /pause title: “Pause new asks until Dec 1?” and the done heading “Paused until Dec 1.” */
export function pausePhrase(choice: PauseChoice, nowMs: number): string {
  if (choice === '2w') return 'for 2 weeks';
  if (choice === 'month') return `until ${fmtDay(nextMonthStart(capMonth(nowMs)).getTime(), NETWORK_TZ)}`;
  return 'until you turn them back on';
}

export const PAUSE_COPY = {
  lede: 'While you’re paused, gates skip you and offers go to others. An ask already waiting on you stays open until its 72 hours end.',
  forHowLong: 'For how long',
  pauseAsks: 'Pause asks',
  notNow: 'Not now',
  doneLede: 'Gates skip you and offers go to others. Nothing else changed: your rules and cap stay as they are.',
  undo: 'Undo',
  yourGate: 'Back to your rules ›',
  undone: 'Undone. Asks can reach you again.',
  failed: 'Didn’t go through. Check your connection and tap again; nothing happens twice.',
  /** A POST that reached us but failed on our side (BE2 /api/pause → ?error=db_down). */
  down: 'Something broke on our side. Nothing changed. Try again in a minute.',
  /** Undo after its 24 hours, or after a pause or resume elsewhere (?error=invalid on a link that still works). */
  undoGone: 'This link can’t undo that pause anymore.',
  pendingTitle: 'Your gate isn’t on yet',
  pendingBody: 'Nothing reaches you until you turn it on, so there’s nothing to pause.',
  invalidTitle: 'This pause link doesn’t work',
  invalidBody: 'It doesn’t match a member. This site is a demo: nobody is signed up, so there is nothing to pause.',
  offTitle: 'Pause links aren’t set up on this instance',
  offBody: 'This instance has no database connected, so nothing can be paused from here.',
  downTitle: 'Something broke on our side',
  downBody: 'Nothing changed. Try the link again in a minute.',
  signIn: 'Sign in',
} as const;

/* ---------- /me status and the asker list ---------- */

/** Effective status: a timed pause that has ended reads as on (the same rule as SQL member_is_active). */
export function effectiveStatus(status: MemberStatus, pausedUntil: string | null, nowMs: number): { status: MemberStatus; paused_until: string | null } {
  if (status === 'paused' && pausedUntil && toMs(pausedUntil) <= nowMs) return { status: 'on', paused_until: null };
  return { status, paused_until: status === 'paused' ? pausedUntil : null };
}

/** The verdict pill for an ask in “Your asks” (ux-spec S2 outcome words). */
export const ASK_OUTCOME_PILL: Record<AskerOutcome, { kind: 'notrun' | 'checking' | 'offered' | 'ask' | 'held' | 'on' | 'decline' | 'nothistime' | 'failed'; label: string }> = {
  ready: { kind: 'notrun', label: 'Not sent' },
  queued: { kind: 'notrun', label: 'Queued' },
  gating: { kind: 'checking', label: 'Checking' },
  offered: { kind: 'offered', label: 'Offered' },
  question: { kind: 'ask', label: 'Question for you' },
  answered: { kind: 'held', label: 'Answered in 2 lines' },
  intro: { kind: 'on', label: 'Intro made' },
  no_match: { kind: 'decline', label: 'No match' },
  closed: { kind: 'nothistime', label: 'Closed' },
  failed: { kind: 'failed', label: 'Nothing sent' },
  withdrawn: { kind: 'nothistime', label: 'Withdrawn' },
};

/* ---------- the monthly ledger ---------- */

/** Counts for “This month” (lib/server/member.ts buildLedger). Counts and line tallies only, never ask text. */
export interface LedgerCounts {
  reached_gate: number;
  reached_you: number;
  declined: number;
  failed: number;
  no_line: number;
  old_lines: number;
}

/**
 * “23 asks reached your gate · 1 reached you · 22 stopped. You never see the stopped asks; neither does anyone else.”
 * or the empty states (ux-spec S3 [empty-ledger], S8 “Empty states”).
 */
export function ledgerLine(l: LedgerCounts, cap: number): string {
  if (l.reached_gate === 0) return nothingYet(cap);
  if (l.reached_you === 0) {
    if (l.declined === l.reached_gate) {
      return l.reached_gate === 1
        ? 'Your gate checked 1 ask this month and declined it. None reached you.'
        : `Your gate checked ${fmtN(l.reached_gate)} asks this month and declined all ${fmtN(l.reached_gate)}. None reached you.`;
    }
    return `Your gate checked ${plural(l.reached_gate, 'ask')} this month. None reached you.`;
  }
  const stopped = Math.max(0, l.reached_gate - l.reached_you);
  return `${plural(l.reached_gate, 'ask')} reached your gate · ${fmtN(l.reached_you)} reached you · ${fmtN(stopped)} stopped. You never see the stopped asks; neither does anyone else.`;
}

/** “16 asks matched no line and were declined.” plus lines quoted from an older version and failed gates. */
export function ledgerHelp(l: LedgerCounts): string | null {
  const parts: string[] = [];
  if (l.no_line > 0) parts.push(l.no_line === 1 ? '1 ask matched no line and was declined.' : `${fmtN(l.no_line)} asks matched no line and were declined.`);
  if (l.old_lines > 0) parts.push(l.old_lines === 1 ? '1 quoted a line you’ve since changed.' : `${fmtN(l.old_lines)} quoted lines you’ve since changed.`);
  if (l.failed > 0) parts.push(l.failed === 1 ? '1 wasn’t checked because the gate failed; that never counts as an accept.' : `${fmtN(l.failed)} weren’t checked because the gate failed; that never counts as an accept.`);
  return parts.length ? parts.join(' ') : null;
}

/** “1 let in · 1 question · 3 kept out”, or “not used this month”. */
export function tallyText(t: { accept: number; ask_back: number; decline: number }): string {
  const parts: string[] = [];
  if (t.accept) parts.push(`${fmtN(t.accept)} let in`);
  if (t.ask_back) parts.push(`${fmtN(t.ask_back)} ${t.ask_back === 1 ? 'question' : 'questions'}`);
  if (t.decline) parts.push(`${fmtN(t.decline)} kept out`);
  return parts.length ? parts.join(' · ') : 'not used this month';
}

/** A time label: “21:04” (clock), “Nov 9” (day), or “21:04” today / “Nov 8, 21:04” before (last). `tz` undefined = viewer's zone. */
export function timeLabelText(fmt: 'clock' | 'day' | 'last', ms: number, nowMs: number, tz?: string): string {
  if (fmt === 'clock') return fmtClock(ms, tz);
  if (fmt === 'day') return fmtDay(ms, tz);
  return fmtDay(ms, tz) === fmtDay(nowMs, tz) ? fmtClock(ms, tz) : `${fmtDay(ms, tz)}, ${fmtClock(ms, tz)}`;
}

/** “Token created Nov 9 · last used 21:04 from Claude Code” / “· not used yet”. */
export function tokenLine(createdDay: string, lastUsed: string | null): string {
  return `Token created ${createdDay} · ${lastUsed ? `last used ${lastUsed} from Claude Code` : 'not used yet'}`;
}

/** “1 ask is waiting on you · Enterprise deals stuck 5 months · from Maya Bennett · 61 h left”. */
export function pendingParts(title: string, from: string, hoursLeft: number): { head: string; rest: string } {
  return { head: '1 ask is waiting on you', rest: ` · ${title} · from ${from} · ${hoursLeft} h left` };
}
