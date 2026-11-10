/**
 * The SAMPLE offer card (S4), the sample intro (S5) and the REAL example shown in QA states.
 * Ported from prototype/data.js `offerSample` and `introSample`. Maya Bennett, Oakline Health and Priya Shah are
 * fictional. The REAL example's times are fixed (Mon Nov 9, 21:04 PT → Thu Nov 12, 21:04 PT); SAMPLE flows
 * stamp their own times in the viewer's zone (ux-spec Revision 2).
 */

import type { Fact } from '@/lib/types';

export interface SuggestedEdit {
  reason: 'not_my_area' | 'wrong_stage';
  /** A line already in the member's rules (shown as diff context). */
  context: string;
  /** The added line: templated by code, additive only, never names a company, never copies 6+ words of the ask. */
  add: string;
  /**
   * What a literal reading of the 12 sample asks expects from the edit. Hand-written, so it is labelled as such and
   * never as a test run (docs/CONTRACT.md §e): “Expected on the 12 sample asks (written by hand, not a model run): …”.
   */
  expected: string;
}

export const OFFER_SAMPLE = {
  token: 'sample',
  member: { name: 'Priya Shah', first: 'Priya', scheduling: 'cal.com/priya-shah/20min', cap: 2, used_before: 0 },
  asker: { name: 'Maya Bennett', first: 'Maya', company: 'Oakline Health', stage: 'Seed', city: 'Chicago', email: 'maya@oakline.example' },
  subject: 'Enterprise deals stuck 5 months, 20 min?',
  title: 'Enterprise deals stuck 5 months',
  facts: [
    ['Problem', '2 enterprise deals have sat in procurement for 5 months'],
    ['Needs', '20 minutes with someone who has closed a first enterprise deal through procurement'],
    ['Tried', '14 buyer calls; 2 deals reached procurement'],
    ['By', 'Nov 20'],
    ['Offers', 'Our procurement checklist'],
    ['Price', '$18k a year per customer (Maya told your gate)'],
  ] as readonly Fact[],
  matched: 'B2B founders selling to enterprise customers',
  /** The fixed REAL example (QA only). */
  sent: 'Mon Nov 9, 21:04',
  reply_by: 'Thu Nov 12, 21:04 PT',
  sent_iso: '2026-11-09T21:04:00-08:00',
  reply_by_iso: '2026-11-12T21:04:00-08:00',
  hours_left: 71,
  cap_line: '1 of your 2 this month',
  /** One templated edit per No reason for Priya's rules (the Sales operator preset); `expected` is hand-written. */
  suggested_edits: {
    area: {
      reason: 'not_my_area',
      context: 'Happy to talk to B2B founders selling to enterprise customers.',
      add: 'No asks about procurement.',
      expected: 'Expected on the 12 sample asks (written by hand, not a model run): 1 change (Oakline Health: question first → decline). Nothing else changes.',
    },
    stage: {
      reason: 'wrong_stage',
      context: 'Only if they have talked to 10+ buyers and have a price.',
      add: 'Only after a first paying customer.',
      expected: 'Expected on the 12 sample asks (written by hand, not a model run): 1 change (Wrenby Health: accept → question first). Nothing else changes.',
    },
  } satisfies Record<'area' | 'stage', SuggestedEdit>,
} as const;

export const INTRO_SAMPLE = {
  subject: 'Intro: Maya Bennett (Oakline Health) and Priya Shah (first enterprise customers)',
  member_line: 'Closed the first 20 enterprise customers at a healthcare software company.',
  asker_line: 'Oakline Health (Seed, Chicago)',
  sent: 'Mon Nov 9, 21:16',
  checkin1: 'Tue Nov 10',
  checkin14: 'Mon Nov 23',
} as const;
