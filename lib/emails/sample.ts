/**
 * SAMPLE inputs for the email templates: what the public viewer (/emails/[kind]) renders and what the tests check.
 * Everything here is fictional (lib/sample) and is labelled SAMPLE on the page. The canonical emails use the fixed
 * REAL example (Maya Bennett asks; Priya Shah's gate accepted; Mon Nov 9, 21:04 PT). With `?ask=<id>` the viewer
 * passes a `SampleLoop` built from the visitor's own tab (components/offer/sample-loop.ts), so the intro shows the ask
 * that was actually sent and the member who held it. Pure; safe in client and server code.
 */

import { INTRO_SAMPLE, OFFER_SAMPLE } from '@/lib/sample/offer';
import { askFacts } from '@/lib/oti/ask';
import { bareSubject } from '@/lib/oti/text';
import { DAY_MS, fmtDay, fmtWeekday, fmtWeekdayShort, fmtWhen, OFFER_WINDOW_MS } from '@/lib/oti/time';
import { absoluteUrl } from '@/lib/site';
import type { AskParts, CheckinKind, CheckinRole, EmailFooter, EmailMessage, Fact, GateQuestion, IntroEmailInput } from '@/lib/types';
import { checkinEmail, codeEmail, offerEmail, outcomeNoteEmail, questionEmail, renderIntro, withdrawnEmail } from './index';
import { withQuery } from './html';

export type SampleEmailKind = 'offer' | 'intro' | 'checkin-1d' | 'checkin-14d' | 'question' | 'outcome-note' | 'withdrawn' | 'code';

export interface SampleEmailMeta {
  kind: SampleEmailKind;
  /** “Offer email”. */
  title: string;
  /** One line for the index. */
  description: string;
  /** True when the email has an asker and a member version (`?who=`). */
  roles: boolean;
}

export const SAMPLE_EMAILS: readonly SampleEmailMeta[] = [
  { kind: 'offer', title: 'Offer email', description: 'To the member whose gate accepted. Each button opens a page where they confirm.', roles: false },
  { kind: 'intro', title: 'Intro email', description: 'To both people after the member says OK. Reply all to pick a time.', roles: false },
  { kind: 'checkin-1d', title: 'Check-in, the next day', description: 'To each person: did the call happen, and was it useful?', roles: true },
  { kind: 'checkin-14d', title: 'Check-in, two weeks later', description: 'To the asker: what came of the intro?', roles: false },
  {
    kind: 'question',
    title: 'A gate’s question',
    description: 'For an asker on the web when a member’s gate asks one question first. Not sent yet: today the question waits on the ask’s page.',
    roles: false,
  },
  { kind: 'outcome-note', title: 'Outcome note', description: 'To the member when the asker reports a useful outcome.', roles: false },
  { kind: 'withdrawn', title: 'Withdrawn ask', description: 'To the member holding an offer when the asker withdraws it.', roles: false },
  { kind: 'code', title: 'Sign-in code', description: 'The 6-digit code for signing in. No password, no magic link.', roles: false },
];

export function isSampleEmailKind(kind: string): kind is SampleEmailKind {
  return SAMPLE_EMAILS.some((e) => e.kind === kind);
}

export function sampleEmailMeta(kind: SampleEmailKind): SampleEmailMeta {
  return SAMPLE_EMAILS.find((e) => e.kind === kind) as SampleEmailMeta;
}

/** The SAMPLE loop of one ask in the visitor's tab: who asked, what was sent, who held the offer, and when. */
export interface SampleLoop {
  /** `sa_eng` … or a custom `sa_…`, or a playground ask id (`a01` …). */
  askId: string;
  subject: string;
  parts: AskParts;
  /** The price the founder told a gate, if any. */
  price: string | null;
  asker: { name: string; first: string; company: string; stage: string; city: string };
  /** `you` (the visitor's own gate) or a fictional sample member. */
  member: { you: boolean; name: string; first: string; line: string | null; scheduling: string | null };
  /** The member's own words their gate quoted. */
  matched: string;
  cap: number;
  nth: number;
  /** Epoch ms in the viewer's own clock (SAMPLE times are the viewer's own). */
  offeredAt: number;
  introAt: number;
  question: GateQuestion | null;
}

/**
 * The other person in a SAMPLE loop's check-in, by the recipient's role. The visitor is never “the other”: when the
 * visitor's own gate held the offer, the asker's version names them “the member”.
 */
export function loopOther(loop: SampleLoop, role: CheckinRole): { name: string; first: string } {
  if (role === 'member') return { name: loop.asker.name, first: loop.asker.first };
  return loop.member.you ? { name: 'The member', first: 'the member' } : { name: loop.member.name, first: loop.member.first };
}

export interface SampleEmail {
  kind: SampleEmailKind;
  message: EmailMessage;
  /** Header lines for the review frame. */
  to: string;
  replyTo: string | null;
  /** A note for reviewers about a line that depends on a setting. */
  note: string | null;
}

const EXAMPLE_MEMBER = { name: OFFER_SAMPLE.member.name, first: OFFER_SAMPLE.member.first, email: 'priya@example.com' };
/** The visitor's own line in a SAMPLE intro (they haven't joined, so they have no one-liner yet). */
export const SAMPLE_YOU_LINE = 'the member whose gate accepted (your one line goes here when you join)';

/** `Hannah Kim` → `hannah@example.com` (fictional addresses on the reserved example.com domain). */
function exampleAddress(first: string): string {
  return `${first.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase() || 'member'}@example.com`;
}

function memberFooter(): Extract<EmailFooter, { role: 'member' }> {
  return {
    role: 'member',
    pause_url: absoluteUrl('/pause/sample'),
    rules_url: absoluteUrl('/me#settings'),
    delete_url: absoluteUrl('/me#delete'),
    unsubscribe_post_url: absoluteUrl('/api/pause?token=sample'),
  };
}

function askerFooter(askId: string): Extract<EmailFooter, { role: 'asker' }> {
  return { role: 'asker', ask_url: absoluteUrl(`/ask/${encodeURIComponent(askId)}`), delete_url: absoluteUrl('/me#delete') };
}

/** The canonical facts without the “(Maya told your gate)” aside, as the intro quotes them. */
function introFacts(facts: readonly Fact[]): Fact[] {
  return facts.map(([k, v]): Fact => [k, k === 'Price' ? v.replace(/\s*\([^)]*told your gate\)\s*$/, '') : v]);
}

function loopFacts(loop: SampleLoop, priceAside: boolean): Fact[] {
  const told = priceAside && loop.member.you && loop.question?.type === 'price';
  const price = loop.price ? `${loop.price}${told ? ' (the founder told your gate)' : ''}` : null;
  return askFacts(loop.parts, price);
}

/** `/o/sample` + `?ask=…&who=…` (the query keeps the SAMPLE loop's ask id). */
function sampleUrl(path: string, params: Record<string, string>): string {
  return absoluteUrl(Object.entries(params).reduce((url, [k, v]) => withQuery(url, k, v), path));
}

function personTo(name: string, address: string): string {
  return `${name} <${address}>`;
}

/** The asker in a SAMPLE loop: the sample founder (fictional company). */
function loopAskerTo(loop: SampleLoop): string {
  return personTo(`${loop.asker.name} (${loop.asker.company})`, `founder@${loop.asker.company.toLowerCase().replace(/[^a-z]+/g, '')}.example`);
}

function loopMemberTo(loop: SampleLoop): string {
  return loop.member.you ? 'you <your email>' : personTo(loop.member.name, exampleAddress(loop.member.first));
}

/**
 * Builds one SAMPLE email. `who` picks the asker or member version where both exist (+1 day check-in). Loop times
 * are the viewer's own: `tz` undefined formats in the browser's zone; the server passes NETWORK_TZ.
 */
export function buildSampleEmail(kind: SampleEmailKind, opts: { who?: CheckinRole; loop?: SampleLoop | null; tz?: string } = {}): SampleEmail {
  const loop = opts.loop ?? null;
  const who: CheckinRole = opts.who === 'member' ? 'member' : 'asker';
  const tz = opts.tz;
  switch (kind) {
    case 'offer':
      return loop ? loopOffer(loop, tz) : canonicalOffer();
    case 'intro':
      return loop ? loopIntro(loop, tz) : canonicalIntro();
    case 'checkin-1d':
      return checkin('d1', who, loop);
    case 'checkin-14d':
      return checkin('d14', 'asker', loop);
    case 'question':
      return question(loop);
    case 'outcome-note':
      return outcomeNote(loop, tz);
    case 'withdrawn':
      return withdrawn(loop, tz);
    case 'code':
      return { kind, message: codeEmail({ code: '482913', minutes: 15 }), to: personTo(EXAMPLE_MEMBER.name, EXAMPLE_MEMBER.email), replyTo: null, note: null };
  }
}

/* ---------- offer ---------- */

function canonicalOffer(): SampleEmail {
  const message = offerEmail({
    offer_url: absoluteUrl('/o/sample'),
    member_first: OFFER_SAMPLE.member.first,
    cap: OFFER_SAMPLE.member.cap,
    nth: OFFER_SAMPLE.member.used_before + 1,
    asker: { name: OFFER_SAMPLE.asker.name, first: OFFER_SAMPLE.asker.first, company: OFFER_SAMPLE.asker.company, stage: OFFER_SAMPLE.asker.stage, city: OFFER_SAMPLE.asker.city },
    subject: OFFER_SAMPLE.subject,
    title: OFFER_SAMPLE.title,
    matched: OFFER_SAMPLE.matched,
    facts: [...OFFER_SAMPLE.facts],
    reply_by_label: OFFER_SAMPLE.reply_by,
    reply_by_day: 'Thu',
    footer: memberFooter(),
  });
  return { kind: 'offer', message, to: personTo(EXAMPLE_MEMBER.name, EXAMPLE_MEMBER.email), replyTo: null, note: null };
}

function loopOffer(loop: SampleLoop, tz?: string): SampleEmail {
  const replyBy = loop.offeredAt + OFFER_WINDOW_MS;
  const message = offerEmail({
    offer_url: sampleUrl('/o/sample', { ask: loop.askId }),
    member_first: loop.member.first,
    cap: loop.cap,
    nth: loop.nth,
    asker: loop.asker,
    subject: loop.subject,
    title: bareSubject(loop.subject),
    matched: loop.matched,
    facts: loopFacts(loop, true),
    reply_by_label: fmtWhen(replyBy, tz),
    reply_by_day: fmtWeekdayShort(replyBy, tz),
    footer: memberFooter(),
  });
  return { kind: 'offer', message, to: loopMemberTo(loop), replyTo: null, note: null };
}

/* ---------- intro ---------- */

function canonicalIntro(): SampleEmail {
  const input: IntroEmailInput = {
    member_context: 'public enterprise sales',
    member: {
      name: OFFER_SAMPLE.member.name,
      first: OFFER_SAMPLE.member.first,
      one_line: INTRO_SAMPLE.member_line,
      scheduling_url: `https://${OFFER_SAMPLE.member.scheduling}`,
      email: EXAMPLE_MEMBER.email,
    },
    asker: { ...OFFER_SAMPLE.asker },
    facts: introFacts(OFFER_SAMPLE.facts),
    matched_line: OFFER_SAMPLE.matched,
    checkin_d1_label: INTRO_SAMPLE.checkin1,
    checkin_d14_label: INTRO_SAMPLE.checkin14,
    member_footer: memberFooter(),
  };
  const message = renderIntro(input);
  const both = `${personTo(OFFER_SAMPLE.asker.name, OFFER_SAMPLE.asker.email)}, ${personTo(EXAMPLE_MEMBER.name, EXAMPLE_MEMBER.email)}`;
  return {
    kind: 'intro',
    message,
    to: both,
    replyTo: both,
    note: `The line “Priya’s rules include …” is there only because Priya turned on “Show askers the line that matched”. Otherwise the rule stays private.`,
  };
}

function loopIntro(loop: SampleLoop, tz?: string): SampleEmail {
  const m = loop.member;
  const input: IntroEmailInput = {
    member_context: null,
    member: { name: m.name, first: m.first, one_line: m.line ?? '', scheduling_url: m.scheduling, email: m.you ? 'your email' : exampleAddress(m.first) },
    asker: { ...loop.asker, email: `founder@${loop.asker.company.toLowerCase().replace(/[^a-z]+/g, '')}.example` },
    facts: loopFacts(loop, false),
    matched_line: null,
    checkin_d1_label: fmtWeekday(loop.introAt + DAY_MS, tz),
    checkin_d14_label: fmtWeekday(loop.introAt + 14 * DAY_MS, tz),
    member_footer: memberFooter(),
  };
  const message = renderIntro(input, {
    askerRef: loop.asker.first,
    greeting: 'and',
    noLinkLine: m.you ? 'Your link for 20 minutes: the scheduling link you add when you join.' : null,
    privateRuleLine: 'The rule that matched stays private unless the member turns it on.',
    subject: `Intro: ${loop.asker.name} (${loop.asker.company}) and ${m.you ? 'you' : m.name}`,
  });
  const both = `${loopAskerTo(loop)}, ${loopMemberTo(loop)}`;
  return { kind: 'intro', message, to: both, replyTo: both, note: null };
}

/* ---------- check-ins ---------- */

function checkin(kind: CheckinKind, role: CheckinRole, loop: SampleLoop | null): SampleEmail {
  // In the loop, the visitor is the member when their own gate held the offer, otherwise the asker.
  const askId = loop ? loop.askId : 'sa_health';
  const url = sampleUrl('/c/sample', { ...(loop ? { ask: loop.askId } : {}), who: role, ...(kind === 'd14' ? { kind: '14d' } : {}) });
  let other: { name: string; first: string };
  let to: string;
  if (loop) {
    other = loopOther(loop, role);
    to = role === 'member' ? loopMemberTo(loop) : loopAskerTo(loop);
  } else {
    other = role === 'member' ? { name: OFFER_SAMPLE.asker.name, first: OFFER_SAMPLE.asker.first } : { name: OFFER_SAMPLE.member.name, first: OFFER_SAMPLE.member.first };
    to = role === 'member' ? personTo(EXAMPLE_MEMBER.name, EXAMPLE_MEMBER.email) : personTo(OFFER_SAMPLE.asker.name, OFFER_SAMPLE.asker.email);
  }
  const message = checkinEmail({
    kind,
    role,
    to_first: role === 'member' ? (loop ? loop.member.first : OFFER_SAMPLE.member.first) : loop ? loop.asker.first : OFFER_SAMPLE.asker.first,
    other_name: other.name,
    other_first: other.first,
    checkin_url: url,
    footer: role === 'member' ? memberFooter() : askerFooter(askId),
  });
  return { kind: kind === 'd14' ? 'checkin-14d' : 'checkin-1d', message, to, replyTo: null, note: null };
}

/* ---------- question, outcome note, withdrawn ---------- */

function question(loop: SampleLoop | null): SampleEmail {
  const q = loop?.question ?? { type: 'price' as const, text: 'What do you charge per customer, per year?' };
  const askId = loop ? loop.askId : 'sa_health';
  const message = questionEmail({
    asker_first: loop ? loop.asker.first : OFFER_SAMPLE.asker.first,
    ask_subject: loop ? loop.subject : OFFER_SAMPLE.subject,
    question: q,
    gates: 1,
    ask_url: absoluteUrl(`/ask/${encodeURIComponent(askId)}`),
    footer: askerFooter(askId),
  });
  return {
    kind: 'question',
    message,
    to: loop ? loopAskerTo(loop) : personTo(OFFER_SAMPLE.asker.name, OFFER_SAMPLE.asker.email),
    replyTo: null,
    note: 'Not sent yet. Today a gate’s question waits on the ask’s page (and in Claude Code); this template is ready for askers who only use the web.',
  };
}

function outcomeNote(loop: SampleLoop | null, tz?: string): SampleEmail {
  const message = outcomeNoteEmail({
    member_first: loop ? loop.member.first : OFFER_SAMPLE.member.first,
    asker_first: loop ? loop.asker.first : OFFER_SAMPLE.asker.first,
    outcome: 'customer',
    reported_on: loop ? fmtDay(loop.introAt + 14 * DAY_MS, tz) : 'Nov 23',
    footer: memberFooter(),
  });
  return { kind: 'outcome-note', message, to: loop ? loopMemberTo(loop) : personTo(EXAMPLE_MEMBER.name, EXAMPLE_MEMBER.email), replyTo: null, note: null };
}

function withdrawn(loop: SampleLoop | null, tz?: string): SampleEmail {
  const message = withdrawnEmail({
    member_first: loop ? loop.member.first : OFFER_SAMPLE.member.first,
    asker_first: loop ? loop.asker.first : OFFER_SAMPLE.asker.first,
    title: loop ? bareSubject(loop.subject) : OFFER_SAMPLE.title,
    withdrawn_on: loop ? fmtWeekday(loop.offeredAt + DAY_MS, tz) : 'Tue Nov 10',
    cap: loop ? loop.cap : OFFER_SAMPLE.member.cap,
    nth: loop ? loop.nth : OFFER_SAMPLE.member.used_before + 1,
    footer: memberFooter(),
  });
  return { kind: 'withdrawn', message, to: loop ? loopMemberTo(loop) : personTo(EXAMPLE_MEMBER.name, EXAMPLE_MEMBER.email), replyTo: null, note: null };
}
