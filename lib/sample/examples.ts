/**
 * EXAMPLE numbers for layout (prototype/data.js `realLine`, `board`, `me`). They are not real usage.
 *
 * Rule (docs/CONTRACT.md §e): these may render only in QA states (`isQA`), always next to the dashed note
 * “Prototype: example numbers for layout. The live board reads from the database.” Production pages read real
 * counts from Postgres, or show their designed empty / not-configured state. Never mix the two on one screen.
 */

export const EXAMPLE_REAL_LINE = { since: 'Nov 9', members: 23, asks: 12, intros: 7 } as const;

export const EXAMPLE_BOARD = {
  since: 'Nov 9, 2026',
  updated: 'Nov 10, 14:02 PT',
  headline: { interrupted: 11, useful: 5, ratio: '2.2' },
  funnel: [
    ['Members with rules', '23', ''],
    ['Asks sent', '12', '+3 refused by the compiler'],
    ['Gate checks', '254', 'at most 12 asks × 23 members, plus 3 reruns'],
    ['Asks that reached a person', '9 of 12', ''],
    ['People interrupted (offers delivered)', '11', 'includes passes and expiries'],
    ['OK to intro', '7 of 11 offers', ''],
    ['Answered in 2 lines', '1 of 11 offers', ''],
    ['Call happened', '5 of 7 intros', '6 of 7 answered the +1 day check-in'],
    ['Useful (rated 4–5)', '5 of 5 calls', ''],
    ['+14 day outcomes', 'first due Nov 23', ''],
  ] as readonly (readonly [string, string, string])[],
  protection: [
    ['Gate checks that stopped an ask', '231 of 254', ''],
    ['Offers per member this month', 'median 0 · max 2', 'cap 2'],
    ['Cap overruns', '0', 'race test: 20 concurrent asks, 1 free slot, 1 offer · passed Nov 9'],
    ['Quotes not found in the member’s rules', '2 of 254', 'both changed to declines by code'],
    ['Median time to answer an offer', '3.1 h', '11 offers'],
    ['Members who paused · deleted', '2 · 1', ''],
  ] as readonly (readonly [string, string, string])[],
  /** [topic, asks, asks that reached a person, distinct askers]. Listed only with 3 or more distinct askers. */
  demand: [
    ['Enterprise sales, US', 4, 1, 3],
    ['First SOC 2 audit', 3, 0, 3],
  ] as readonly (readonly [string, number, number, number])[],
  demandOther: 5,
  eval: {
    header:
      '20 cases written by Alex Torrenegra (Alan’s cofounder), who didn’t see the rubric or the gate prompt · frozen Nov 9 before tuning · claude-haiku-5-5 · rubric v3',
    /** [case type, n, run 1, run 2, run 3, keyword baseline]. */
    rows: [
      ['Fits the rules', 8, 7, 8, 7, 5],
      ['Right topic, wrong stage', 3, 2, 2, 3, 1],
      ['Investor posing as a founder', 3, 3, 3, 2, 0],
      ['Prompt injection', 3, 3, 3, 3, 2],
      ['Polite spam', 3, 2, 2, 2, 3],
    ] as readonly (readonly [string, number, number, number, number, number])[],
    totals: [20, 17, 18, 17, 11] as const,
    wrongAccept: [1, 0, 1, 4] as const,
    wrongBlock: [2, 2, 2, 5] as const,
  },
  clauseCheck: { changed: 2, of: 254 },
  sample: { playgroundRuns: 214, liveGateCalls: 1980, rulesStored: 0, sampleAsks: 37 },
} as const;

/** /me example (member Priya Shah, Sales operator rules), for QA states of S3. */
export const EXAMPLE_ME = {
  name: 'Priya Shah',
  email: 'priya@example.com',
  oneLine: 'Ran procurement at a hospital system before selling software to them.',
  presetRules: 'health',
  cap: 2,
  used: 1,
  month: 'November',
  resets: 'Dec 1',
  version: 3,
  saved: '21:14',
  scheduling: 'https://cal.com/priya-shah/20min',
  showMatched: false,
  guests: false,
  ledger: { reached_gate: 23, reached_you: 1, stopped: 22 },
  lineTallies: ['1 let in · 1 question', '1 let in · 1 question · 3 kept out', 'not used this month', '2 kept out'],
  noLine: 16,
  pending: { title: 'Intro to a hospital procurement lead', from: 'Maya Bennett', hours_left: 61 },
} as const;
