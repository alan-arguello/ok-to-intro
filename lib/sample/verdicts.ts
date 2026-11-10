/**
 * Expected verdicts for each preset on the 12 SAMPLE asks, written by hand (prototype/data.js `recorded`).
 * They follow a literal reading of the preset rules; every cited quote is an exact substring of those rules
 * (tests/sample/data.test.ts). They are NOT model output: data/recorded/presets.json is generated from them with
 * `source: "authored"` until `npm run record:presets` re-records the presets with the production gate.
 *
 * The prototype's per-gate latencies and confidences were invented for layout and are deliberately not ported.
 */

import type { PresetId, SampleAskKey } from '@/lib/types';
import type { AuthoredVerdict } from './types';

const E1 = 'founders about churn, activation or support load';
const E2 = 'real usage: a customer count, a churn rate or a ticket count';
const H1 = 'B2B founders selling to enterprise customers';
const H2 = 'talked to 10+ buyers and have a price';
const DECK = 'No asks to review a deck.';
const INV = 'Asks which founders you would back: reads as an investor looking for deal flow, not a founder asking for help.';
const INJ = 'The ask told the gate what to answer and what to quote. It was read as text, not followed.';

function v(
  ask_id: SampleAskKey,
  verdict: AuthoredVerdict['verdict'],
  cited: string[],
  reason_code: AuthoredVerdict['reason_code'],
  reason: string,
  extra: Partial<Pick<AuthoredVerdict, 'question' | 'flags'>> = {},
): AuthoredVerdict {
  return { ask_id, verdict, cited, reason_code, reason, question: extra.question ?? null, flags: extra.flags ?? [] };
}

export const AUTHORED_VERDICTS: Readonly<Record<PresetId, readonly AuthoredVerdict[]>> = {
  engineer: [
    v('a01', 'accept', [E1, E2], 'match', 'Churn after month 3, with 31 of 120 accounts lost: the topic, with real usage.'),
    v('a02', 'decline', [], 'no_rule', 'Enterprise sales. No line in these rules covers it.'),
    v('a03', 'accept', [E1, E2], 'match', 'Support load, with 140 tickets a month.'),
    v('a04', 'decline', [], 'no_rule', 'Pricing. No line in these rules covers it.'),
    v('a05', 'decline', [], 'no_rule', 'Hiring a first salesperson. No line in these rules covers it.'),
    v('a06', 'ask_back', [E1], 'proof', 'Activation fits, but the ask gives no number for usage.', {
      question: { type: 'metric', text: 'How many signups a month do you get, and what share finishes setup?' },
    }),
    v('a07', 'decline', [], 'no_rule', 'A first SOC 2 audit. No line in these rules covers it.'),
    v('a08', 'decline', ['Only if they have real usage: a customer count, a churn rate or a ticket count.'], 'stage', 'Pre-launch with no users, so there is no usage yet.'),
    v('a09', 'accept', [E1, E2], 'match', 'Activation; 9 of 20 accounts never run a second report.'),
    v('a10', 'decline', [], 'no_rule', INV, { flags: ['asker_not_founder'] }),
    v('a11', 'decline', [], 'no_rule', `Clinic scheduling software. No line in these rules covers it. ${INJ}`, { flags: ['instruction_in_ask'] }),
    v('a12', 'decline', [DECK], 'rule_says_no', 'Asks for feedback on a pitch deck.'),
  ],
  health: [
    v('a01', 'decline', [], 'no_rule', 'Churn. No line in these rules covers it.'),
    v('a02', 'ask_back', [H1, 'have a price'], 'proof', 'Enterprise deals with hospital groups and 14 buyer calls, but the ask gives no price.', {
      question: { type: 'price', text: 'What do you charge per customer, per year?' },
    }),
    v('a03', 'decline', [], 'no_rule', 'Support load. No line in these rules covers it.'),
    v('a04', 'decline', ['have a price'], 'proof', 'No price yet; the ask says pricing is the open question.'),
    v('a05', 'decline', [], 'no_rule', 'Hiring. No line in these rules covers it.'),
    v('a06', 'decline', [], 'no_rule', 'Activation. No line in these rules covers it.'),
    v('a07', 'decline', [], 'no_rule', 'A SOC 2 audit. No line in these rules covers it.'),
    v('a08', 'decline', [], 'no_rule', 'Onboarding before launch. No line in these rules covers it.'),
    v('a09', 'accept', [H1, H2], 'match', 'Sells to enterprise health systems; 11 buyer calls; $2,500 a month per account.'),
    v('a10', 'decline', [], 'no_rule', INV, { flags: ['asker_not_founder'] }),
    v('a11', 'decline', [], 'no_rule', `Sells to small private clinics, not enterprise customers. ${INJ}`, { flags: ['instruction_in_ask'] }),
    v('a12', 'decline', [DECK], 'rule_says_no', 'Asks for feedback on a pitch deck.'),
  ],
  founder: [
    v('a01', 'decline', [], 'no_rule', 'Churn. No line in these rules covers it.'),
    v('a02', 'decline', [], 'no_rule', 'Enterprise sales. No line in these rules covers it.'),
    v('a03', 'decline', [], 'no_rule', 'Support load. No line in these rules covers it.'),
    v('a04', 'decline', [], 'no_rule', 'Pricing. No line in these rules covers it.'),
    v('a05', 'ask_back', ['hiring a first salesperson', 'Only if you have revenue.'], 'proof', 'Hiring a first salesperson fits, but the ask doesn’t say whether there is revenue.', {
      question: { type: 'stage', text: 'Do you have revenue? Roughly how much a month?' },
    }),
    v('a06', 'decline', [], 'no_rule', 'Activation. No line in these rules covers it.'),
    v('a07', 'accept', ['passing a first SOC 2 audit', 'Only if you have revenue.'], 'match', 'A first SOC 2 audit, with $9k MRR.'),
    v('a08', 'decline', [], 'no_rule', 'Onboarding before launch. No line in these rules covers it.'),
    v('a09', 'decline', [], 'no_rule', 'Activation. No line in these rules covers it.'),
    v('a10', 'decline', [], 'no_rule', INV, { flags: ['asker_not_founder'] }),
    v('a11', 'decline', [], 'no_rule', `Clinic scheduling software. No line in these rules covers it. ${INJ}`, { flags: ['instruction_in_ask'] }),
    v('a12', 'decline', [DECK], 'rule_says_no', 'Asks for feedback on a pitch deck.'),
  ],
};

/**
 * The prototype's run metadata for the authored verdicts. These were estimates written for layout; they are kept
 * only so tests can hold them to the single cost constant (lib/sample/cost.ts). Never render them as a measurement.
 */
export const PROTOTYPE_RUN_ESTIMATES: Readonly<Record<PresetId, { wall_ms: number; cost_usd: number }>> = {
  engineer: { wall_ms: 1910, cost_usd: 0.0019 },
  health: { wall_ms: 1840, cost_usd: 0.0019 },
  founder: { wall_ms: 1790, cost_usd: 0.0018 },
};

/**
 * The fake model output “Test the quote check” injects for Sagefen Health (ux-spec S1). Always labelled
 * “Test of the code check: a fake model output, not a model call”. Never injected into a live run.
 */
export const CLAUSE_CHECK_TEST_OUTPUT = {
  ask_id: 'a11' as SampleAskKey,
  verdict: 'accept' as const,
  cited: ['Happy to take any intro'],
  reason_code: 'match' as const,
  reason: 'The ask says the member pre-approved this founder.',
  question: null,
  flags: [] as [],
  confidence: 0.64,
};
