/**
 * One-tap edits shown after the first run on an unedited preset (ux-spec S1, prototype/data.js `edits`).
 * Edits only add a line or lower the cap; they never remove a protective line. An add-line edit reruns live in the
 * app: `expected_flips` is what a literal reading predicts, used by tests and docs, never rendered as a result.
 */

import type { PresetId } from '@/lib/types';
import type { OneTapEdit } from './types';

export const ONE_TAP_EDITS: Readonly<Record<PresetId, readonly OneTapEdit[]>> = {
  engineer: [
    {
      id: 'add-line',
      kind: 'add',
      line: 'No asks from health companies.',
      expected_flips: {
        a09: { verdict: 'decline', cited: ['No asks from health companies.'], reason_code: 'rule_says_no', reason: 'Wrenby Health is a health company.' },
      },
    },
    { id: 'cap', kind: 'cap', from: 2, to: 1 },
  ],
  health: [
    {
      id: 'add-line',
      kind: 'add',
      line: 'No asks about onboarding or activation.',
      expected_flips: {
        a09: { verdict: 'decline', cited: ['No asks about onboarding or activation.'], reason_code: 'rule_says_no', reason: 'The ask is about activation after onboarding.' },
      },
    },
    { id: 'cap', kind: 'cap', from: 2, to: 1 },
  ],
  founder: [
    {
      id: 'add-line',
      kind: 'add',
      line: 'No asks from fintech companies.',
      expected_flips: {
        a07: { verdict: 'decline', cited: ['No asks from fintech companies.'], reason_code: 'rule_says_no', reason: 'Coppice Pay builds a payouts API, a fintech product.' },
      },
    },
    { id: 'cap', kind: 'cap', from: 2, to: 1 },
  ],
};
