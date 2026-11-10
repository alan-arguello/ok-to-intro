/**
 * The three presets (ux-spec §1 decision 2), ported from prototype/data.js. Engineer is the default.
 * Each yields at least 1 accept, 1 question and 4 trap declines on a literal reading of its rules.
 */

import type { PresetId } from '@/lib/types';
import type { Preset } from './types';

export const PRESETS: readonly Preset[] = [
  {
    id: 'engineer',
    label: 'Engineer',
    cap: 2,
    rules: [
      'Happy to talk to founders about Postgres, queues or LLM evals in production.',
      'Only if they have a real workload: a table size, a p95 or an error rate.',
      'No fundraising asks.',
      'No asks to review a deck.',
    ].join('\n'),
  },
  {
    id: 'health',
    label: 'Health operator',
    cap: 2,
    rules: [
      'Happy to talk to B2B founders selling to public hospitals or insurers in the US or Canada.',
      'Only if they have talked to 10+ buyers and have a price.',
      'No fundraising asks.',
      'No asks to review a deck.',
    ].join('\n'),
  },
  {
    id: 'founder',
    label: 'Founder',
    cap: 2,
    rules: [
      'Happy to talk about hiring a first engineer or passing a first SOC 2 audit.',
      'Only if you have revenue.',
      'No fundraising asks.',
      'No asks to review a deck.',
    ].join('\n'),
  },
];

export const DEFAULT_PRESET: PresetId = 'engineer';

export function presetById(id: string | null | undefined): Preset {
  return PRESETS.find((p) => p.id === id) ?? (PRESETS[0] as Preset);
}

export function isPresetId(id: unknown): id is PresetId {
  return id === 'engineer' || id === 'health' || id === 'founder';
}

/** The preset whose rules equal `rules` exactly (an unedited preset), or null. */
export function presetForRules(rules: string): Preset | null {
  return PRESETS.find((p) => p.rules === rules) ?? null;
}
