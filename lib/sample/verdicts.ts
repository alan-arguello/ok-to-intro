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

const E1 = 'founders about Postgres, queues or LLM evals in production';
const E2 = 'a real workload: a table size, a p95 or an error rate';
const H1 = 'B2B founders selling to public hospitals or insurers in the US or Canada';
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
    v('a01', 'accept', [E1, E2], 'match', 'Postgres at 40M rows with a 900 ms p95: the topic, with a real workload.'),
    v('a02', 'decline', [], 'no_rule', 'Hospital procurement. No line in these rules covers it.'),
    v('a03', 'accept', [E1, E2], 'match', 'LLM evals in production, with an 8% failure rate on real tickets.'),
    v('a04', 'decline', [], 'no_rule', 'Pricing software for insurers. No line in these rules covers it.'),
    v('a05', 'decline', [], 'no_rule', 'Hiring a first engineer. No line in these rules covers it.'),
    v('a06', 'ask_back', [E1], 'proof', 'Queues fit, but the ask gives no number for the workload.', {
      question: { type: 'metric', text: 'How many jobs a day do you run, and what share gets dropped?' },
    }),
    v('a07', 'decline', [], 'no_rule', 'A first SOC 2 audit. No line in these rules covers it.'),
    v('a08', 'decline', ['Only if they have a real workload: a table size, a p95 or an error rate.'], 'stage', 'Pre-launch with no users, so there is no workload yet.'),
    v('a09', 'accept', [E1, E2], 'match', 'LLM evals in production; 6% of claims misrouted.'),
    v('a10', 'decline', [], 'no_rule', INV, { flags: ['asker_not_founder'] }),
    v('a11', 'decline', [], 'no_rule', `Clinic scheduling software. No line in these rules covers it. ${INJ}`, { flags: ['instruction_in_ask'] }),
    v('a12', 'decline', [DECK], 'rule_says_no', 'Asks for feedback on a pitch deck.'),
  ],
  health: [
    v('a01', 'decline', [], 'no_rule', 'Postgres performance. No line in these rules covers it.'),
    v('a02', 'ask_back', [H1, 'have a price'], 'proof', 'Public hospitals in Illinois with 14 buyer calls, but the ask gives no price.', {
      question: { type: 'price', text: 'What do you charge per hospital, per year?' },
    }),
    v('a03', 'decline', [], 'no_rule', 'AI support tooling. No line in these rules covers it.'),
    v('a04', 'decline', ['have a price'], 'proof', 'No price yet; the ask says pricing is the open question.'),
    v('a05', 'decline', [], 'no_rule', 'Hiring. No line in these rules covers it.'),
    v('a06', 'decline', [], 'no_rule', 'Job queues. No line in these rules covers it.'),
    v('a07', 'decline', [], 'no_rule', 'Sells to a bank, not to hospitals or insurers.'),
    v('a08', 'decline', [], 'no_rule', 'Postgres schema design. No line in these rules covers it.'),
    v('a09', 'accept', [H1, H2], 'match', 'Sells to insurers in the US; 11 insurer calls; $2,500 a month per insurer.'),
    v('a10', 'decline', [], 'no_rule', INV, { flags: ['asker_not_founder'] }),
    v('a11', 'decline', [], 'no_rule', `Sells to private clinics, not public hospitals or insurers. ${INJ}`, { flags: ['instruction_in_ask'] }),
    v('a12', 'decline', [DECK], 'rule_says_no', 'Asks for feedback on a pitch deck.'),
  ],
  founder: [
    v('a01', 'decline', [], 'no_rule', 'Postgres performance. No line in these rules covers it.'),
    v('a02', 'decline', [], 'no_rule', 'Hospital procurement. No line in these rules covers it.'),
    v('a03', 'decline', [], 'no_rule', 'LLM evals. No line in these rules covers it.'),
    v('a04', 'decline', [], 'no_rule', 'Pricing software for insurers. No line in these rules covers it.'),
    v('a05', 'ask_back', ['hiring a first engineer', 'Only if you have revenue.'], 'proof', 'Hiring a first engineer fits, but the ask doesn’t say whether there is revenue.', {
      question: { type: 'stage', text: 'Do you have revenue? Roughly how much a month?' },
    }),
    v('a06', 'decline', [], 'no_rule', 'Job queues. No line in these rules covers it.'),
    v('a07', 'accept', ['passing a first SOC 2 audit', 'Only if you have revenue.'], 'match', 'A first SOC 2 audit, with $9k MRR.'),
    v('a08', 'decline', [], 'no_rule', 'Postgres schema design. No line in these rules covers it.'),
    v('a09', 'decline', [], 'no_rule', 'LLM evals for claims. No line in these rules covers it.'),
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
