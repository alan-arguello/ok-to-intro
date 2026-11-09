/**
 * The SAMPLE offer card (S4), the sample intro (S5) and the REAL example shown in QA states.
 * Ported from prototype/data.js `offerSample` and `introSample`. Lucía Ferrer, Orvella Health and Ana Ruiz are
 * fictional. The REAL example's times are fixed (Mon Nov 9, 21:04 CST → Thu Nov 12, 21:04 CST); SAMPLE flows
 * stamp their own times in the viewer's zone (ux-spec Revision 2).
 */

import type { Fact } from '@/lib/types';

export interface SuggestedEdit {
  reason: 'not_my_area' | 'wrong_stage';
  /** A line already in the member's rules (shown as diff context). */
  context: string;
  /** The added line: templated by code, additive only, never names a company, never copies 6+ words of the ask. */
  add: string;
  /** “Tested on the 12 sample asks: …” (format checked by tests). */
  tested: string;
}

export const OFFER_SAMPLE = {
  token: 'sample',
  member: { name: 'Ana Ruiz', first: 'Ana', scheduling: 'cal.com/ana-ruiz/20min', cap: 2, used_before: 0 },
  asker: { name: 'Lucía Ferrer', first: 'Lucía', company: 'Orvella Health', stage: 'Seed', city: 'Guadalajara', email: 'lucia@orvella.example' },
  subject: 'Hospital procurement in Mexico, 20 min?',
  title: 'Hospital procurement in Mexico',
  facts: [
    ['Problem', 'Public hospital committees stall at technical review'],
    ['Needs', '20 minutes with someone who has sat on a public hospital procurement committee in Mexico'],
    ['Tried', '14 buyer calls; 2 committees reached review'],
    ['By', 'Nov 20'],
    ['Offers', 'Our tender templates'],
    ['Price', '$18k a year per hospital (Lucía told your gate)'],
  ] as readonly Fact[],
  matched: 'B2B founders selling to public hospitals or insurers in Mexico or Colombia',
  /** The fixed REAL example (QA only). */
  sent: 'Mon Nov 9, 21:04',
  reply_by: 'Thu Nov 12, 21:04 CST',
  sent_iso: '2026-11-09T21:04:00-06:00',
  reply_by_iso: '2026-11-12T21:04:00-06:00',
  hours_left: 71,
  cap_line: '1 of your 2 this month',
  /** One templated edit per No reason, tested against Ana's rules (the Health operator preset). */
  suggested_edits: {
    area: {
      reason: 'not_my_area',
      context: 'Happy to talk to B2B founders selling to public hospitals or insurers in Mexico or Colombia.',
      add: 'No asks about public procurement.',
      tested: 'Tested on the 12 sample asks: 1 change (Orvella Health: question first → decline). Nothing else changes.',
    },
    stage: {
      reason: 'wrong_stage',
      context: 'Only if they have talked to 10+ buyers and have a price.',
      add: 'Only after a first paying customer.',
      tested: 'Tested on the 12 sample asks: 1 change (Guadua Health: accept → question first). Nothing else changes.',
    },
  } satisfies Record<'area' | 'stage', SuggestedEdit>,
} as const;

export const INTRO_SAMPLE = {
  subject: 'Intro: Lucía Ferrer (Orvella Health) and Ana Ruiz (public hospital procurement)',
  member_line: 'Ran procurement for a public hospital network in Jalisco.',
  asker_line: 'Orvella Health (Seed, Guadalajara)',
  sent: 'Mon Nov 9, 21:16',
  checkin1: 'Tue Nov 10',
  checkin14: 'Mon Nov 23',
} as const;
