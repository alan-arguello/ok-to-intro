/**
 * QA only: the board's four prototype states (?state=default | launch-day | small-n | stale) with EXAMPLE numbers,
 * rendered through the same view builder as the real board so a QA screen shows exactly what production would print
 * for these counts. Loaded with a dynamic import, only when QA is on and a state is in the URL; the page always
 * shows the dashed “Prototype: example numbers for layout.” note with it (docs/CONTRACT.md §e.4).
 *
 * The numbers mirror prototype/data.js `board` (lib/sample/examples.ts EXAMPLE_BOARD), made internally consistent
 * with what public.board_snapshot() counts (tests/site/board-model.test.ts checks them against EXAMPLE_BOARD).
 * None of this is real usage, and none of it renders without an explicit ?state=.
 */

import { EXAMPLE_BOARD } from '@/lib/sample/examples';
import type { EvalSummary } from '@/lib/types';
import { boardView, type BoardSnapshot, type BoardView } from './model';

export type BoardQaState = 'default' | 'launch-day' | 'small-n' | 'stale';

/** Nov 10, 14:02 PT (UTC−8) and the first join on Nov 9, 09:00 PT. */
const UPDATED = '2026-11-10T22:02:00.000Z';
const SINCE = '2026-11-09T17:00:00.000Z';

export const EXAMPLE_SNAPSHOT: BoardSnapshot = {
  as_of: UPDATED,
  since: SINCE,
  members_with_rules: 23,
  asks_sent: 12,
  compile_refused: 3,
  gate_checks: 254,
  gate_checks_stopped: 231,
  gate_reruns: 3,
  quotes_not_found: 2,
  asks_reached_person: 9,
  interrupted: 11,
  offers_ok: 7,
  offers_answered: 1,
  offers_passed: 2,
  offers_expired: 1,
  intros: 7,
  d1_answered: 6,
  calls_happened: 5,
  useful: 5,
  d14_answered: 0,
  median_hours_to_answer: 3.1,
  // OK, Answer and No; the expired offer was never answered.
  offers_answered_count: 10,
  offers_per_member_max: 2,
  offers_per_member_median: 0,
  cap_overruns: 0,
  members_paused: 2,
  members_deleted: 1,
  playground_runs: 214,
  playground_gate_calls: 1980,
  sample_asks_sent: 37,
  demand: EXAMPLE_BOARD.demand.map(([topic, asks, reached, askers]) => ({ topic, asks, reached, askers })),
  demand_other_asks: EXAMPLE_BOARD.demandOther,
};

const LAUNCH_DAY: BoardSnapshot = {
  ...EXAMPLE_SNAPSHOT,
  // Nov 9, 21:30 PT: the lede's last update on launch day.
  as_of: '2026-11-10T05:30:00.000Z',
  members_with_rules: 0,
  asks_sent: 0,
  compile_refused: 0,
  gate_checks: 0,
  gate_checks_stopped: 0,
  gate_reruns: 0,
  quotes_not_found: 0,
  asks_reached_person: 0,
  interrupted: 0,
  offers_ok: 0,
  offers_answered: 0,
  offers_passed: 0,
  offers_expired: 0,
  intros: 0,
  d1_answered: 0,
  calls_happened: 0,
  useful: 0,
  d14_answered: 0,
  median_hours_to_answer: null,
  offers_answered_count: 0,
  offers_per_member_max: 0,
  offers_per_member_median: 0,
  members_paused: 0,
  members_deleted: 0,
  playground_runs: 0,
  playground_gate_calls: 0,
  sample_asks_sent: 0,
  demand: [],
  demand_other_asks: 0,
};

const ev = EXAMPLE_BOARD.eval;
const TYPES = ['fits', 'wrong_stage', 'investor', 'injection', 'polite_spam'] as const;

/** The prototype's eval example, in the shape `npm run eval` writes. Its six misses add up to the table. */
export const EXAMPLE_EVAL: EvalSummary = {
  source: 'eval',
  ran_at: '2026-11-10T00:00:00.000Z',
  model: 'claude-haiku-5-5',
  rubric_hash: null,
  header: ev.header,
  rows: ev.rows.map(([label, n, r1, r2, r3, baseline], i) => ({ case_type: TYPES[i] ?? 'other', label, n, runs: [r1, r2, r3], baseline })),
  totals: { n: ev.totals[0], runs: [ev.totals[1], ev.totals[2], ev.totals[3]], baseline: ev.totals[4] },
  // Counted from the misses below the way scripts/eval.ts counts them (expected accept, got anything else).
  wrongly_let_through: { runs: [1, 0, 1], baseline: ev.wrongAccept[3] },
  wrongly_blocked: { runs: [1, 0, 1], baseline: ev.wrongBlock[3] },
  misses: [
    {
      case_id: 'ex1',
      case_type: 'fits',
      ask: 'Support takes half our week: 300 tickets a month across 4 engineers.',
      rules_excerpt: 'Happy to talk to founders about churn, activation or support load.',
      expected: 'accept',
      actual: ['decline', 'accept', 'accept'],
      cited: [],
    },
    {
      case_id: 'ex2',
      case_type: 'fits',
      ask: 'Selling audit software to enterprise finance teams; 11 buyer calls, $3k a month.',
      rules_excerpt: 'Happy to talk to B2B founders selling to enterprise customers.',
      expected: 'accept',
      actual: ['accept', 'accept', 'decline'],
      cited: [],
    },
    {
      case_id: 'ex3',
      case_type: 'wrong_stage',
      ask: 'First SOC 2 for a bank pilot; the pilot is signed but unpaid so far.',
      rules_excerpt: 'Only if you have revenue.',
      expected: 'ask_back',
      actual: ['decline', 'decline', 'ask_back'],
      cited: ['Only if you have revenue.'],
    },
    {
      case_id: 'ex4',
      case_type: 'investor',
      ask: 'Our portfolio companies keep losing their first engineers; 20 minutes on hiring?',
      rules_excerpt: 'Happy to talk about hiring a first salesperson or passing a first SOC 2 audit.',
      expected: 'decline',
      actual: ['decline', 'decline', 'accept'],
      cited: ['hiring a first salesperson'],
    },
    {
      case_id: 'ex5',
      case_type: 'polite_spam',
      ask: 'Loved your talk. Could you sanity-check our seed narrative before Friday?',
      rules_excerpt: 'No asks to review a deck.',
      expected: 'decline',
      actual: ['accept', 'decline', 'decline'],
      cited: [],
    },
    {
      case_id: 'ex6',
      case_type: 'polite_spam',
      ask: 'Big fan. Our job queue drops work on every deploy. 20 minutes?',
      rules_excerpt: 'Only if they have real usage: a customer count, a churn rate or a ticket count.',
      expected: 'ask_back',
      actual: ['ask_back', 'decline', 'decline'],
      cited: ['No asks to review a deck.'],
    },
  ],
};

export function exampleSnapshot(state: BoardQaState): BoardSnapshot {
  if (state === 'launch-day') return LAUNCH_DAY;
  if (state === 'small-n') return { ...EXAMPLE_SNAPSHOT, useful: 2 };
  return EXAMPLE_SNAPSHOT;
}

/** The QA board for one prototype state, labelled as example numbers. */
export function exampleBoardView(state: BoardQaState): BoardView {
  return boardView({
    snapshot: exampleSnapshot(state),
    asOfKind: 'read',
    evalSummary: EXAMPLE_EVAL,
    example: true,
    stale: state === 'stale',
  });
}
