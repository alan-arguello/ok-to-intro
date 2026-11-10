import { absoluteUrl, DISCLAIMER } from '@/lib/site';
import { bareSubject, q } from '@/lib/oti/text';
import type {
  CheckinEmailInput,
  D14Outcome,
  EmailFooter,
  EmailMessage,
  IntroEmailInput,
  OfferEmailInput,
  OutcomeNoteEmailInput,
  QuestionEmailInput,
  WithdrawnEmailInput,
} from '@/lib/types';
import {
  card,
  cardRow,
  displayUrl,
  EMAIL_COLOR,
  EMAIL_MONO,
  emailDocument,
  esc,
  excerpt,
  factsInOrder,
  factsTable,
  footerLinks,
  footerNote,
  footerRow,
  heading,
  inkButton,
  link,
  outlineButton,
  para,
  quoteMark,
  squareButton,
  textFacts,
  withQuery,
} from './html';

/**
 * Owner: R. Email templates: pure functions that return {subject, preheader, html, text, headers} (ux-spec S4/S5,
 * tech.md “Rendering”). Plain text is always sent; the HTML is a 560 px table with inline CSS, system fonts, ink on
 * white, light only, under 20 KB, with no images or tracking. Buttons are links at least 48 px tall (OK in ink with a
 * white label, because Gmail iOS inverts colours and ink survives it). Every button opens a page where the person
 * confirms: nothing happens from an email. Footers follow the recipient's role. BE2 sends them; the public SAMPLE
 * viewer (/emails/[kind]) renders the same functions with fictional data.
 *
 * Emails that go to one member carry List-Unsubscribe + List-Unsubscribe-Post (RFC 8058): one click pauses that
 * member's asks. The intro goes to both people in one message, so it carries neither the header nor the member's
 * pause token (the asker must not be able to pause the member); its “Pause asks” link opens /me.
 */

export { emailFragment } from './html';

const LIST_UNSUBSCRIBE_POST = 'List-Unsubscribe=One-Click';

type MemberFooter = Extract<EmailFooter, { role: 'member' }>;

/** One-click pause headers for an email that goes to one member. */
function memberHeaders(footer: MemberFooter): Record<string, string> {
  return { 'List-Unsubscribe': `<${footer.unsubscribe_post_url}>`, 'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_POST };
}

/** Footer links by role (ux-spec S5): members get pause, rules and delete; askers get their ask and delete. */
function footerLinksFor(footer: EmailFooter): { label: string; href: string }[] {
  return footer.role === 'member'
    ? [
        { label: 'Pause all asks', href: footer.pause_url },
        { label: 'Change your rules', href: footer.rules_url },
        { label: 'Delete my data', href: footer.delete_url },
      ]
    : [
        { label: 'Your ask', href: footer.ask_url },
        { label: 'Delete my data', href: footer.delete_url },
      ];
}

function footerHtml(footer: EmailFooter | null): string {
  return footerRow((footer ? footerLinks(footerLinksFor(footer)) : '') + footerNote(esc(DISCLAIMER)));
}

function footerText(footer: EmailFooter | null): string[] {
  return ['--', ...(footer ? footerLinksFor(footer).map((l) => `${l.label}: ${l.href}`) : []), DISCLAIMER];
}

function message(subject: string, preheader: string, title: string, rows: string[], text: string[], headers: Record<string, string> = {}): EmailMessage {
  return { subject, preheader, html: emailDocument(title, preheader, card(rows)), text: text.join('\n'), headers };
}

const MUTED_15 = { color: EMAIL_COLOR.ink2 };
const MUTED_14 = { size: 14, line: 20, color: EMAIL_COLOR.ink2 };

/** “Oakline Health (Seed, Chicago)”, dropping whatever the asker's profile leaves empty. */
export function companyLine(a: { company: string; stage: string; city: string }): string {
  const where = [a.stage, a.city].map((x) => (x ?? '').trim()).filter(Boolean).join(', ');
  const company = (a.company ?? '').trim();
  return company && where ? `${company} (${where})` : company || where;
}

/** “Maya Bennett, Oakline Health (Seed, Chicago)” or just the name. */
function personLine(a: { name: string; company: string; stage: string; city: string }, sep: string): string {
  const rest = companyLine(a);
  return rest ? `${a.name}${sep}${rest}` : a.name;
}

/* ======================================================================== *
 * S4 · the offer email (to the member whose gate accepted)
 * ======================================================================== */

export function offerEmail(input: OfferEmailInput): EmailMessage {
  const who = input.asker.first;
  const capLine = `An ask matched your rules. It’s ${input.nth} of your ${input.cap} this month.`;
  const from = `From ${personLine(input.asker, ', ')}`;
  // An accept always quotes the member's rules; if a quote is ever missing, say so without an empty quote.
  const matched = (input.matched ?? '').trim();
  const confirm = 'Each button opens a page where you confirm. Nothing happens from this email.';
  const privacy = `${who} sees your name only if you choose OK. If you say No or don’t reply by ${input.reply_by_label}, it goes to the next person and ${who} isn’t told it reached you.`;
  const preheader = `${matched ? `Matched your rule ${q(excerpt(matched))}` : 'Matched your rules'} · ${input.nth} of your ${input.cap} this month · reply by ${input.reply_by_day}`;
  const url = {
    ok: withQuery(input.offer_url, 'choice', 'ok'),
    answer: withQuery(input.offer_url, 'choice', 'answer'),
    no: withQuery(input.offer_url, 'choice', 'no'),
  };
  const facts = factsInOrder(input.facts);

  const rows = [
    cardRow(
      para(esc(capLine), MUTED_15) +
        heading(input.title) +
        para(esc(from), { ...MUTED_15, margin: '4px 0 14px' }) +
        para(matched ? `Matched your rule: ${quoteMark(matched)}` : 'Matched your rules.') +
        factsTable(facts, 9),
      '24px 24px 0',
    ),
    cardRow(
      // One order everywhere: OK to intro · Answer in 2 lines · No.
      inkButton('OK to intro', url.ok) +
        outlineButton('Answer in 2 lines', url.answer) +
        outlineButton('No', url.no) +
        para(esc(confirm), { ...MUTED_14, margin: '8px 0 10px' }) +
        para(esc(privacy), { ...MUTED_14, margin: '0' }),
      '0 24px 16px',
    ),
    footerHtml(input.footer),
  ];

  const text = [
    capLine,
    '',
    input.title,
    from,
    '',
    matched ? `Matched your rule: ${q(matched)}` : 'Matched your rules.',
    '',
    ...textFacts(facts),
    '',
    'OK to intro:',
    url.ok,
    '',
    'Answer in 2 lines:',
    url.answer,
    '',
    'No:',
    url.no,
    '',
    'Each link opens a page where you confirm. Nothing happens from this email.',
    '',
    privacy,
    '',
    ...footerText(input.footer),
  ];

  return message(input.subject, preheader, input.subject, rows, text, memberHeaders(input.footer));
}

/* ======================================================================== *
 * S5 · the intro email (To and Reply-To: both people; the service is not in the thread)
 * ======================================================================== */

/** “Intro: Maya Bennett (Oakline Health) and Priya Shah (hospital procurement)” (the parenthetical is optional). */
export function introSubject(input: Pick<IntroEmailInput, 'asker' | 'member' | 'member_context'>): string {
  const member = input.member_context ? `${input.member.name} (${input.member_context})` : input.member.name;
  const company = (input.asker.company ?? '').trim();
  return `Intro: ${company ? `${input.asker.name} (${company})` : input.asker.name} and ${member}`;
}

/**
 * Wording switches the SAMPLE viewer needs (a sample founder and, when the visitor's own gate held the offer, “you”).
 * The REAL email uses the defaults.
 */
export interface IntroWording {
  /** How the asker is named mid-sentence (“The ask Maya approved”). Default: the asker's first name. */
  askerRef?: string;
  /** `comma`: “Maya, Priya: you both said yes” (default). `and`: “Sample founder and you: you both said yes”. */
  greeting?: 'comma' | 'and';
  /** Shown instead of the scheduling-link line when the member has no link. Default: no line. */
  noLinkLine?: string | null;
  /** Shown instead of the matched-rule line when it is private. Default: no line. */
  privateRuleLine?: string | null;
  /** Overrides the subject (e.g. “… and you”). */
  subject?: string;
}

export function renderIntro(input: IntroEmailInput, wording: IntroWording = {}): EmailMessage {
  const m = input.member;
  const a = input.asker;
  const askerRef = wording.askerRef ?? a.first;
  const subject = wording.subject ?? introSubject(input);
  const memberLine = m.one_line ? `${m.name} · ${m.one_line}` : m.name;
  const askerLine = personLine(a, ' · ');
  const askerRest = companyLine(a);
  const greet = wording.greeting === 'and' ? `${a.name} and ${m.first}: you both said yes, so here is the intro.` : `${a.first}, ${m.first}: you both said yes, so here is the intro.`;
  const askLabel = `The ask ${askerRef} approved:`;
  const scheduling = m.scheduling_url ? m.scheduling_url : null;
  const linkLabel = `${possessive(m.first)} scheduling link:`;
  const ruleLine = input.matched_line ? `${possessive(m.first)} rules include ${q(input.matched_line)}.` : (wording.privateRuleLine ?? null);
  const close = `Reply all to pick a time. We’re not on this thread. Tomorrow we’ll ask each of you one question, and ${askerRef} one more in two weeks. That’s all.`;
  const preheader = scheduling ? `Reply all to pick a time. ${possessive(m.first)} link: ${displayUrl(scheduling)}` : 'Reply all to pick a time.';
  const facts = factsInOrder(input.facts);
  // The asker must not get the member's pause token (one message to both): “Pause asks” opens the member's gate.
  const pauseHref = absoluteUrl('/me');

  const body16 = { size: 16, line: 24 };
  const rows = [
    cardRow(
      para(`<b style="font-weight:600">${esc(m.name)}</b>${m.one_line ? ` · ${esc(m.one_line)}` : ''}`, { margin: '0 0 4px' }) +
        para(`<b style="font-weight:600">${esc(a.name)}</b>${askerRest ? ` · ${esc(askerRest)}` : ''}`, { margin: '0 0 18px' }) +
        para(esc(greet), { ...body16, margin: '0 0 16px' }) +
        para(esc(askLabel), { ...MUTED_15, margin: '0 0 6px' }) +
        factsTable(facts, 8, '0 0 18px') +
        (scheduling
          ? para(`${esc(linkLabel)} ${link(displayUrl(scheduling), scheduling, EMAIL_COLOR.ink)}`, { ...body16, margin: '0 0 16px' })
          : wording.noLinkLine
            ? para(esc(wording.noLinkLine), { ...body16, margin: '0 0 16px' })
            : '') +
        (ruleLine ? para(esc(ruleLine), { ...MUTED_15, margin: '0 0 16px' }) : '') +
        para(esc(close), { ...body16, margin: '0 0 16px' }),
      '24px 24px 8px',
    ),
    footerRow(footerNote(`${esc(DISCLAIMER)} · ${link('Pause asks', pauseHref)}`)),
  ];

  const text = [
    memberLine,
    askerLine,
    '',
    greet,
    '',
    askLabel,
    ...textFacts(facts),
    '',
    ...(scheduling ? [`${linkLabel} ${scheduling}`, ''] : wording.noLinkLine ? [wording.noLinkLine, ''] : []),
    ...(ruleLine ? [ruleLine, ''] : []),
    close,
    '',
    '--',
    DISCLAIMER,
    `Pause asks: ${pauseHref}`,
  ];

  return message(subject, preheader, subject, rows, text);
}

/** S5 intro email to both people. */
export function introEmail(input: IntroEmailInput): EmailMessage {
  return renderIntro(input);
}

/** “Priya” → “Priya’s”, “you” → “Your” at the start of a sentence. */
function possessive(first: string): string {
  if (/^you$/i.test(first)) return 'Your';
  return `${first}’s`;
}

/* ======================================================================== *
 * Withdrawn: to the member who held the offer when the asker withdrew it (no buttons; nothing to do)
 * ======================================================================== */

export function withdrawnEmail(input: WithdrawnEmailInput): EmailMessage {
  const title = bareSubject(input.title);
  const subject = `No longer needed: ${title}`;
  const preheader = `${input.asker_first} withdrew this ask. Nothing to do.`;
  const body = `${input.asker_first} withdrew the ask ${q(title)} on ${input.withdrawn_on}. Nothing to do. It still counted as ${input.nth} of your ${input.cap} this month.`;
  const rows = [cardRow(para(esc(body), { size: 16, line: 24, margin: '0' }), '24px 24px 16px'), footerHtml(input.footer)];
  return message(subject, preheader, subject, rows, [body, '', ...footerText(input.footer)], memberHeaders(input.footer));
}

/* ======================================================================== *
 * S5 · check-ins: +1 day to each person, +14 days to the asker (the member only if the asker never answers)
 * ======================================================================== */

/** The +14 day options, in order (`v=` values on /c). */
export const D14_OPTIONS: readonly [D14Outcome, string][] = [
  ['unblocked', 'Unblocked'],
  ['customer', 'A customer'],
  ['hire', 'A hire'],
  ['investor', 'An investor'],
  ['nothing_yet', 'Nothing yet'],
];

export const D1_HELP = '1 = not at all · 5 = it unblocked me';
const ONE_TAP = 'One tap opens a page where you confirm.';

/** The question each check-in asks (also the /c page title). */
export function checkinQuestion(kind: CheckinEmailInput['kind'], role: CheckinEmailInput['role'], otherFirst: string): string {
  if (kind === 'd14') return `What came of the intro to ${otherFirst}?`;
  return role === 'member' ? `Was the call with ${otherFirst} worth your time?` : `How useful was the call with ${otherFirst}?`;
}

export function checkinEmail(input: CheckinEmailInput): EmailMessage {
  const question = checkinQuestion(input.kind, input.role, input.other_first);
  const d14 = input.kind === 'd14';
  const subject = d14 ? question : `Did you and ${input.other_first} talk?`;
  const preheader = d14 ? ONE_TAP : `One tap: ${question.charAt(0).toLowerCase()}${question.slice(1)}`;
  const at = (v: string) => withQuery(input.checkin_url, 'v', v);
  const options: [string, string, 'square' | 'pill'][] = d14
    ? D14_OPTIONS.map(([v, label]) => [v, label, 'pill'])
    : [
        ...(['1', '2', '3', '4', '5'] as const).map((n): [string, string, 'square'] => [n, n, 'square']),
        ['notyet', 'We haven’t talked yet', 'pill'],
        ['wont', 'It won’t happen', 'pill'],
      ];

  const buttons = options.map(([v, label, shape]) => (shape === 'square' ? squareButton(label, at(v)) : outlineButton(label, at(v)))).join('');
  const help = d14 ? para(esc(ONE_TAP), { ...MUTED_14, margin: '4px 0 0' }) : para(esc(D1_HELP), { ...MUTED_14, margin: '4px 0 8px' }) + para(esc(ONE_TAP), { ...MUTED_14, margin: '0' });
  const rows = [cardRow(heading(question, '0 0 16px') + buttons + help, '24px 24px 16px'), footerHtml(input.footer)];

  const text = [
    question,
    '',
    ...options.map(([v, label]) => `${label}: ${at(v)}`),
    '',
    ...(d14 ? [] : [D1_HELP]),
    ONE_TAP,
    '',
    ...footerText(input.footer),
  ];

  return message(subject, preheader, subject, rows, text, input.footer.role === 'member' ? memberHeaders(input.footer) : {});
}

/* ======================================================================== *
 * A gate's question, to a web-only asker (ux-spec “Later”; ready for BE2)
 * ======================================================================== */

export function questionEmail(input: QuestionEmailInput): EmailMessage {
  const title = bareSubject(input.ask_subject);
  const many = input.gates > 1;
  const subject = `One question about your ask: ${title}`;
  const preheader = many ? 'Your answer goes only to the gates that asked.' : 'Your answer goes only to the gate that asked.';
  const body = many
    ? `A member’s gate has one question before deciding: ${q(input.question.text)} Your answer goes only to the gates that asked (${input.gates}), and each reruns once.`
    : `A member’s gate has one question before deciding: ${q(input.question.text)} Your answer goes only to the gate that asked, and it reruns once.`;
  const answerUrl = `${input.ask_url.split('#')[0]}#question`;
  const rows = [cardRow(para(esc(body), { size: 16, line: 24, margin: '0 0 18px' }) + inkButton('Answer it', answerUrl), '24px 24px 16px'), footerHtml(input.footer)];
  const text = [body, '', 'Answer it:', answerUrl, '', ...footerText(input.footer)];
  return message(subject, preheader, subject, rows, text);
}

/* ======================================================================== *
 * Outcome note, to the member when the asker reports a useful outcome (Should)
 * ======================================================================== */

const OUTCOME_PHRASE: Record<OutcomeNoteEmailInput['outcome'], (first: string) => string> = {
  customer: (f) => `${f} reported a customer`,
  hire: (f) => `${f} reported a hire`,
  investor: (f) => `${f} reported an investor`,
  unblocked: (f) => `${f} reported being unblocked`,
  useful_call: (f) => `${f} reported a useful call`,
};

export function outcomeNoteEmail(input: OutcomeNoteEmailInput): EmailMessage {
  const said = OUTCOME_PHRASE[input.outcome](input.asker_first);
  const subject = `What came of your intro to ${input.asker_first}`;
  const preheader = `${said}.`;
  const body = `${said} from your intro (${input.reported_on}). Thanks for your time.`;
  const gate = absoluteUrl('/me');
  const rows = [
    cardRow(para(esc(body), { size: 16, line: 24, margin: '0' }), '24px 24px 16px'),
    footerRow(footerLinks([{ label: 'Your gate', href: gate }, { label: 'Pause all asks', href: input.footer.pause_url }]) + footerNote(esc(DISCLAIMER))),
  ];
  const text = [body, '', '--', `Your gate: ${gate}`, `Pause all asks: ${input.footer.pause_url}`, DISCLAIMER];
  return message(subject, preheader, subject, rows, text, memberHeaders(input.footer));
}

/* ======================================================================== *
 * The sign-in code (Supabase Auth sends it; this is the template to paste into its “Magic Link” email)
 * ======================================================================== */

export interface CodeEmailInput {
  /** The 6 digits, or Supabase's `{{ .Token }}` placeholder. */
  code: string;
  /** How long the code lives (Supabase's OTP expiry). */
  minutes: number;
}

export function codeEmail(input: CodeEmailInput): EmailMessage {
  const subject = `${input.code} is your OK to Intro code`;
  const preheader = `It expires in ${input.minutes} minutes.`;
  const after = `It expires in ${input.minutes} minutes. If you didn’t ask for it, ignore this email.`;
  const rows = [
    cardRow(
      para('Your code:', { size: 16, line: 24, margin: '0 0 6px' }) +
        `<p style="margin:0 0 16px;font:600 28px/36px ${EMAIL_MONO};letter-spacing:.2em;color:${EMAIL_COLOR.ink}">${esc(input.code)}</p>` +
        para(esc(after), { size: 16, line: 24, margin: '0' }),
      '24px 24px 20px',
    ),
    footerHtml(null),
  ];
  const text = [`Your code: ${input.code}. ${after}`, '', ...footerText(null)];
  return message(subject, preheader, subject, rows, text);
}

/**
 * Paste into Supabase Auth → Email Templates → Magic Link (tech.md: put {{ .Token }} in the template and remove
 * {{ .ConfirmationURL }}; the code goes in the subject and the first line). 15 minutes matches the OTP expiry the
 * spec recommends; change both together.
 */
export const SUPABASE_CODE_TEMPLATE: EmailMessage = codeEmail({ code: '{{ .Token }}', minutes: 15 });
