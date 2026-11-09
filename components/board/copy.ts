/**
 * The board's own copy (ux-spec S7), in a module of its own so the client island and the markup import strings only,
 * never the view model and the SAMPLE data it reads.
 */
export const BOARD_COPY = {
  title: 'Board',
  description: 'Real counts with their denominators: people interrupted per useful outcome, the funnel, recipient protection and a held-out eval.',
  denominators: 'Every number has its denominator.',
  smallSamples: 'Small samples: n < 20.',
  emptyLede: 'Real counts from the network’s database. Every number has its denominator.',
  notConnected: 'The real network isn’t connected on this instance yet.',
  dbDown: 'The database isn’t answering, so there are no counts to show right now. Try again in a minute.',
  staleNotice: (updated: string) => `The database isn’t answering. These are the counts from ${updated}.`,
  headlineTitle: 'People interrupted per useful outcome',
  headlineDef:
    'Interrupted: an offer delivered to a member. Each uses a cap slot, including passes and expiries. Useful: rated 4–5 at +1 day, or any +14 day outcome other than “Nothing yet”. Lower is better.',
  headlineSmall: 'Small sample: fewer than 20 interruptions.',
  noIntros: '0 intros yet. Check-ins go out 1 day and 14 days after each intro.',
  demandEmpty: 'No topic has asks from 3 or more founders yet.',
  noVerdicts: 'No gate verdicts yet.',
  evalNone: 'No eval run yet.',
  evalNoneNote:
    'The held-out eval runs the gate 3 times on cases written by someone who didn’t see the rubric or the gate prompt, next to a keyword baseline. The table appears here once it has run.',
  evalCaption: 'Correct verdicts per case type in each run of the gate, and for a keyword baseline',
  clauseExampleSummary: 'See an example on sample data',
  clauseExampleLabel: 'A test of the code check: a fake model output, not a model call.',
  clauseExamplePrivacy: 'Real catches are counts only: the board never shows a member’s rules or an ask.',
  defsNoteTopics: 'A topic is listed under unanswered demand only when 3 or more different founders asked about it.',
  defsNoteSmall: 'Any denominator under 20 is a small sample.',
  defsNoteMedian: 'The median time to answer is shown from 3 answered offers, so no single member’s answer time is published.',
  defsNoteCheckpoint:
    'Counts are as of the last 09:00 or 21:00 checkpoint in Mexico City, the same times askers see changes, so the board can’t be used to time a member’s answer.',
} as const;
