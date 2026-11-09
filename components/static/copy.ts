/**
 * Copy for S8's static pages (/how, /privacy, 404, error), verbatim from prototype/how.html, privacy.html, 404.html
 * and error.html, with the honesty changes docs/CONTRACT.md §e requires:
 * - eval results only from data/eval/heldout-summary.json (`source: "eval"`), never the prototype's “3 of 3”;
 * - costs say “about” and come from the one cost constant (lib/sample/cost.ts), labelled an estimate while it is one;
 * - /privacy says exactly what the code stores, keeps and deletes, and links each line to the code that enforces it.
 */

import { fmtUsdAbout, fmtUsdConst } from '@/components/board/format';
import { COST, estimatedCost } from '@/lib/sample/cost';
import { MODELS } from '@/lib/site';
import type { EvalSummary } from '@/lib/types';

export const HOW_COPY = {
  title: 'How it works',
  description: 'The five steps from a member’s rules to an intro, what enforces each one, and the guarantees with their tests.',
  stepsLabel: 'Five steps',
  guaranteesTitle: 'Guarantees',
  codeAndEval: 'Code and eval:',
} as const;

export interface HowStep {
  name: string;
  line: string;
  by: string[];
}

export const HOW_STEPS: readonly HowStep[] = [
  { name: 'Rules and cap', line: 'You write rules and a cap.', by: ['Your rules (model)', 'Cap (Postgres)'] },
  {
    name: 'The ask',
    line: 'A founder writes one specific ask. It’s checked for 5 parts; vague asks and anything about YC applications are refused.',
    by: [`Compiler (${MODELS.compiler})`],
  },
  {
    name: 'The gates',
    line: 'SQL drops members at their cap and repeat pairs. Each remaining member’s gate returns accept, decline or one question, quoting the line it used. Code checks the quote is in that member’s rules; if not, it’s a decline.',
    by: ['Model + code'],
  },
  {
    name: 'One offer at a time',
    line: 'reserve_slot() locks the member’s monthly counter, so two asks can’t take the last slot. One person gets one card. A No or 72 quiet hours moves it to the next person who accepted.',
    by: ['Postgres row lock'],
  },
  {
    name: 'Intro and check-ins',
    line: 'Both people get the intro. At +1 day both are asked if the call happened; at +14 days the founder is asked what came of it.',
    by: ['Email + cron'],
  },
];

/** “(3 of 3 declined in each run)” from a real eval; otherwise says the eval hasn't run. */
export function injectionResult(summary: EvalSummary): string {
  const row = summary.source === 'eval' ? summary.rows.find((r) => r.case_type === 'injection') : undefined;
  if (!row || !row.runs.length) return 'Injection cases are part of the held-out eval, which hasn’t run yet.';
  const same = row.runs.every((n) => n === row.runs[0]);
  const declined = same ? `${row.runs[0]} of ${row.n} declined in each run` : `${row.runs.join(', ')} of ${row.n} declined across the ${row.runs.length} runs`;
  return `Injection cases are in the held-out eval (${declined}).`;
}

export function howGuarantees(summary: EvalSummary): readonly { lead: string; text: string }[] {
  return [
    { lead: 'Caps live in Postgres.', text: 'Test: 20 concurrent asks, 1 free slot, exactly 1 offer.' },
    {
      lead: 'Every quote is checked.',
      text: 'A cited line must appear in the member’s rules, character for character after normalizing quotes, spaces and letter case, or the verdict becomes a decline.',
    },
    {
      lead: 'Asks are data.',
      text: `The ask reaches the gate as quoted text after your rules. ${injectionResult(summary)} If a gate is fooled anyway, code still checks every quote, Postgres still holds the cap, and nobody is introduced until a person presses OK.`,
    },
    {
      lead: 'Failures never interrupt anyone.',
      text: 'A gate that errors or times out counts as not checked, never as an accept. If more than 1 in 5 gates fail, nothing is offered.',
    },
    { lead: 'Askers learn little:', text: 'no caps, no list of who declined, no names before OK.' },
    { lead: 'A person always says yes.', text: 'No intro is sent without the member pressing OK.' },
    { lead: 'Email buttons can’t act.', text: 'They open a page; only a button on that page does anything.' },
  ];
}

/** The cost line, from the one cost constant; “estimated from published prices” while it is an estimate. */
export function howCostLine(): string {
  const per = fmtUsdConst(COST.perGate);
  const twelve = fmtUsdAbout(estimatedCost(12));
  const thirtyThree = fmtUsdAbout(estimatedCost(33));
  const how = COST.estimate ? ', estimated from published prices' : ', measured';
  return `Cost: about ${per} per gate call on ${COST.model}${how} (about ${twelve} for the 12 sample asks); an ask that reaches 33 gates costs about ${thirtyThree}.`;
}

export const PRIVACY_COPY = {
  title: 'Privacy',
  description: 'Who sees your rules, cap and answers, what is stored, which processors handle it and how to delete it.',
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
    'Playground rules (they stay in your browser tab unless you join), email opens, and IP addresses: rate limits keep only an HMAC of the address with a daily salt, removed by the daily cleanup after a day.',
  processors:
    'Supabase (database and email sign-in), Anthropic (gate and compiler calls; it deletes API inputs and outputs within 30 days by default, longer only for content its safety review flags), Resend (email), Vercel (hosting; our code never logs request bodies).',
  never: 'Gmail, Calendar, Notion, or any community data.',
  deleteBefore: 'In ',
  deleteLink: 'Your gate',
  deleteAfter:
    ', one button and one confirm. It deletes your account, rules, cap, asks, offers, check-ins and tokens now, and cancels emails still scheduled to you. Intros already sent stay in inboxes; the board’s counts stay, without your name. Export (JSON), next to it, downloads your data first.',
  contactFallback: ' (a public issue: leave personal data out)',
} as const;

export { ERROR_COPY, errorRef, NOT_FOUND_COPY } from './error-copy';
