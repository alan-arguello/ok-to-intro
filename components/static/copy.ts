/**
 * Copy for S8's static pages (/how, /privacy, 404, error), verbatim from prototype/how.html, privacy.html, 404.html
 * and error.html, with the honesty changes docs/CONTRACT.md §e requires:
 * - /privacy says exactly what the code stores, keeps and deletes, and links each line to the code that enforces it.
 */

import { MODELS } from '@/lib/site';

export const HOW_COPY = {
  title: 'How it works',
  description: 'Five steps: a founder writes an ask, a model checks it, each member’s own rules decide, a monthly limit holds, and one person at a time gets the offer.',
  lede: 'The mechanism in 5 short steps. This demo runs it on 40 fictional members.',
  stepsLabel: 'Five steps',
  tryAsk: 'Write an ask',
  tryRules: 'On the other side? See what would reach you ›',
  code: 'Code:',
} as const;

export interface HowStep {
  name: string;
  line: string;
  by: string[];
}

export const HOW_STEPS: readonly HowStep[] = [
  { name: 'The ask', line: 'A founder writes one specific ask for a 20-minute call.', by: ['Founder'] },
  {
    name: 'The check',
    line: 'A model checks it for 5 parts: the challenge, what they tried, who they need, a deadline and an offer back. Vague asks are refused.',
    by: [`Model (${MODELS.compiler})`],
  },
  {
    name: 'Each member’s gate',
    line: 'Every member wrote, in their own words, what they’d agree to help with. A small model reads the ask against those rules and must quote the line it used. Code checks the quote is really there; if not, it’s a no.',
    by: [`Model (${MODELS.gate})`, 'Code'],
  },
  { name: 'The monthly limit', line: 'Each member picks how many intros a month they take, from 1 to 5. An ask that matches after that number doesn’t reach them.', by: ['Code'] },
  { name: 'One offer at a time', line: 'One member who matched sees the ask. A no, or 72 quiet hours, moves it to the next one. Nobody is introduced until that person says OK.', by: ['Code'] },
];

export const PRIVACY_COPY = {
  title: 'Privacy',
  description: 'Who sees your rules, cap and answers, what is stored, which processors handle it and how to delete it.',
  demo: 'This site is a demo: 40 fictional members, no accounts and no email. The rows below describe what the code does when it runs a real network.',
  whoTitle: 'Who sees what',
} as const;

/** The who-sees-what table (ux-spec S3), one row per fact. `true` = ✓, `false` = –, a string = the condition. */
export const WHO_SEES: readonly { what: string; you: true; askers: string | false; others: false }[] = [
  { what: 'Your rules', you: true, askers: false, others: false },
  { what: 'The line that matched', you: true, askers: 'only if you turn it on', others: false },
  { what: 'Your cap and usage', you: true, askers: false, others: false },
  { what: 'That an ask reached you', you: true, askers: 'only after you say OK', others: false },
  { what: 'Your No and its reason', you: true, askers: false, others: false },
  { what: 'Your name and email', you: true, askers: 'after you say OK', others: false },
];

/** Files that enforce a privacy line (each must exist in the repo; tests/site checks). */
export const PRIVACY_CODE = {
  who: ['lib/server/serializer.ts', 'supabase/migrations/0002_network.sql'],
  ask: ['supabase/migrations/0001_init.sql'],
  store: ['supabase/migrations/0001_init.sql'],
  noStore: ['lib/server/ratelimit.ts'],
  rules: ['lib/server/gate.ts'],
  delete: ['lib/server/member.ts', 'app/(site)/me/export/route.ts'],
} as const;

export const PRIVACY_ROWS = {
  ask: 'Each member’s gate (the model) reads your ask. Only the person it is offered to sees it, one person at a time; members whose gates decline never see it. Asks are kept until you delete your data, and you can withdraw one at any time from its page.',
  store:
    'Your email, name, one line, scheduling link and asker profile; your rules and every saved version; your cap and pause; your asks and the gate decisions on them, each with the rules version it used; offers, intros and check-ins; drafts of asks made in Claude Code, which expire after 24 hours; a hash of your Claude Code token, never the token; and an audit log of facts for the board, without rules, ask text, names or emails.',
  noStore:
    'Rules you try on this site (they stay in your browser tab), email opens, and IP addresses: rate limits keep only an HMAC of the address with a daily salt, removed by the daily cleanup after a day.',
  processors:
    'Supabase (database and email sign-in), Anthropic (gate and compiler calls; it deletes API inputs and outputs within 30 days by default, longer only for content its safety review flags), Resend (email), Vercel (hosting; our code never logs request bodies).',
  never: 'Gmail, Calendar, Notion, or any community data.',
  delete:
    'A member deletes everything from their own page, with one button and one confirm. It deletes the account, rules, cap, asks, offers, check-ins and tokens now, and cancels emails still scheduled to them. Intros already sent stay in inboxes; counts stay, without the name. An export (JSON) downloads the data first. This demo has no accounts, so there is nothing of yours to delete.',
  contactFallback: ' (a public issue: leave personal data out)',
} as const;

export { ERROR_COPY, errorRef, NOT_FOUND_COPY } from './error-copy';
