/**
 * npm run recordings:authored
 *
 * Writes data/recorded/presets.json and data/recorded/sample-network.json from the hand-written SAMPLE
 * expectations in lib/sample, with `source: "authored"` and no timing, cost or confidence. The UI labels these
 * “Example verdicts, written by hand · not a model run”.
 *
 * `npm run record:presets` (BE1) replaces them with runs of the production gate (`source: "model"`).
 * This script refuses to overwrite a model recording unless --force is passed.
 *
 * `--out <dir>` writes the same two files to another directory instead (relative to the repo root). The tests pin the
 * authored path this way: `npm run recordings:fixtures` writes tests/fixtures/recorded/authored/.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuotes } from '../lib/oti/clause';
import { AUTHORED_VERDICTS, PRESETS, SAMPLE_FANOUTS, SAMPLE_MEMBERS, SAMPLE_NETWORK_ASKS } from '../lib/sample';
import type { PresetRun, PresetsFile, RecordedMemberGate, SampleNetworkFile, SampleNetworkRun } from '../lib/recorded';
import { MODELS } from '../lib/site';
import type { PresetId, SampleNetworkAskId } from '../lib/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const outDir = outArg === -1 ? join(root, 'data', 'recorded') : resolve(root, process.argv[outArg + 1] ?? '');
if (outArg !== -1 && !process.argv[outArg + 1]) {
  console.error('--out needs a directory.');
  process.exit(1);
}
const force = process.argv.includes('--force');
const generatedAt = process.env.RECORDED_AT || '2026-11-09T09:00:00-08:00';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function guard(file: string) {
  if (!existsSync(file) || force) return;
  const current = JSON.parse(readFileSync(file, 'utf8')) as { source?: string };
  if (current.source === 'model') {
    console.error(`${file} holds a model recording. Pass --force to replace it with authored data.`);
    process.exit(1);
  }
}

const presetRuns = {} as Record<PresetId, PresetRun>;
for (const preset of PRESETS) {
  presetRuns[preset.id] = {
    preset: preset.id,
    rules_sha256: sha256(preset.rules),
    wall_ms: null,
    cost_usd: null,
    gates: AUTHORED_VERDICTS[preset.id].map((v) => {
      const cited = checkQuotes(preset.rules, v.cited);
      if (cited.some((c) => !c.found)) throw new Error(`${preset.id} ${v.ask_id}: a cited quote is not in the rules`);
      return {
        ask_id: v.ask_id,
        verdict: v.verdict,
        model_verdict: v.verdict,
        cited,
        decided_by: 'gate' as const,
        reason_code: v.reason_code,
        reason: v.reason,
        question: v.question,
        flags: [...v.flags],
        confidence: null,
        ms: null,
        request_id: null,
      };
    }),
  };
}

const presetsFile: PresetsFile = {
  source: 'authored',
  recorded_at: generatedAt,
  model: MODELS.gate,
  rubric_hash: null,
  note: 'Hand-written expectations from lib/sample (a literal reading of each preset). Not a model run. Replace with `npm run record:presets`.',
  runs: presetRuns,
};

const memberRules = new Map(SAMPLE_MEMBERS.map((m) => [m.label, m.rules]));
const networkRuns = {} as Record<SampleNetworkAskId, SampleNetworkRun>;
for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) {
  const members: RecordedMemberGate[] = SAMPLE_FANOUTS[sa.id].map((row) => {
    const rules = memberRules.get(row.label) ?? '';
    const cited = row.cited ? checkQuotes(rules, [row.cited]) : [];
    if (cited.some((c) => !c.found)) throw new Error(`${sa.id} ${row.label}: the cited quote is not in the member's rules`);
    return {
      label: row.label,
      state: row.state,
      na: row.na,
      reason_code: row.reason_code,
      reason: null,
      cited,
      question: row.question,
      flags: [],
      confidence: null,
      ms: null,
    };
  });
  networkRuns[sa.id] = { sample_ask_id: sa.id, based_on: sa.based_on, wall_ms: null, members };
}

const networkFile: SampleNetworkFile = {
  source: 'authored',
  recorded_at: generatedAt,
  model: MODELS.gate,
  rubric_hash: null,
  note: 'Hand-written expectations from lib/sample (39 sample members × 3 sample asks). Not a model run.',
  runs: networkRuns,
};

mkdirSync(outDir, { recursive: true });
const presetsPath = join(outDir, 'presets.json');
const networkPath = join(outDir, 'sample-network.json');
guard(presetsPath);
guard(networkPath);
writeFileSync(presetsPath, `${JSON.stringify(presetsFile, null, 2)}\n`);
writeFileSync(networkPath, `${JSON.stringify(networkFile, null, 2)}\n`);
console.log(`wrote ${presetsPath} and ${networkPath} (source: authored)`);
