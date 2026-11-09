/**
 * npm run record:presets — record the SAMPLE runs with the production gate (owner: BE1).
 *
 *   npm run record:presets                 presets.json (3 presets × 12 asks) and sample-network.json (39 members × 3 asks)
 *   npm run record:presets -- --only presets | --only network
 *   npm run record:presets -- --dry-run     run and print, write nothing
 *   npm run record:presets -- --check       no key needed: fails (exit 1) when a `source: "model"` file was recorded
 *                                           with another rubric, schema, settings or model than the gate has now
 *
 * The runs go through lib/server/gate.ts `runGateDetailed`, the exact code /api/try and the fan-out run, with the
 * same inputs (the ask's text, subject, parts and stage), all gates of a run in flight together like the product.
 * Each file is written with `source: "model"`, the recording date, the model id, RUBRIC_HASH, every gate's latency
 * from the run's start, its request id and confidence, and the run's cost measured from token usage. The UI then
 * labels them “Recorded run · <date> · <model>” (lib/recorded.ts). Failed gates are retried twice; a preset run that
 * still has a failure is not written (the file must hold verdicts). Sample members the SQL prefilter skips (paused, at
 * cap) are never gated, as in production.
 *
 * Refuses to run without ANTHROPIC_API_KEY: the hand-written files (`npm run recordings:authored`, source
 * "authored") stay until a real recording replaces them.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecordedFile, type PresetRun, type PresetsFile, type RecordedGate, type RecordedMemberGate, type SampleNetworkFile, type SampleNetworkRun } from '../lib/recorded';
import { SAMPLE_ASKS } from '../lib/sample/asks';
import { SAMPLE_MEMBERS, SAMPLE_NETWORK_ASKS } from '../lib/sample/network';
import { PRESETS } from '../lib/sample/presets';
import { AUTHORED_VERDICTS } from '../lib/sample/verdicts';
import type { PresetId, SampleNetworkAskId } from '../lib/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  presets: join(root, 'data', 'recorded', 'presets.json'),
  network: join(root, 'data', 'recorded', 'sample-network.json'),
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Next's `server-only` guard throws outside the react-server condition; this script runs server code on purpose. */
function allowServerOnly() {
  const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === 'server-only') return join(root, 'node_modules', 'server-only', 'empty.js');
    return original.call(this, request, ...rest);
  };
}

function loadEnvFiles() {
  for (const f of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(join(root, f));
    } catch {
      /* missing file */
    }
  }
}

async function pool<T>(items: T[], limit: number, work: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await work(items[i] as T, i);
      }
    }),
  );
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function check(): Promise<number> {
  const { recordingHashProblems, RUBRIC_HASH_SHORT, GATE_MODEL } = await import('../lib/server/rubric');
  const problems: string[] = [];
  for (const [kind, path] of [['presets', FILES.presets], ['sample-network', FILES.network]] as const) {
    const json = JSON.parse(readFileSync(path, 'utf8')) as { source?: string; model?: string; rubric_hash?: string | null; recorded_at?: string };
    const shape = validateRecordedFile(json, kind);
    problems.push(...shape.map((p) => `${kind}: ${p}`), ...recordingHashProblems(json, kind));
    console.log(`${kind}.json · source ${json.source} · ${json.model} · ${json.rubric_hash ? `rubric ${String(json.rubric_hash).slice(0, 12)}` : 'no rubric hash (hand-written)'} · ${json.recorded_at}`);
  }
  console.log(`current gate · ${GATE_MODEL} · rubric ${RUBRIC_HASH_SHORT}`);
  if (problems.length) {
    console.error(`\nFAIL\n- ${problems.join('\n- ')}`);
    return 1;
  }
  console.log('\nOK: every model recording matches the current gate (hand-written files are labelled as such).');
  return 0;
}

async function main() {
  loadEnvFiles();
  allowServerOnly();
  if (flag('check')) process.exit(await check());

  const { flags } = await import('../lib/env');
  if (!flags.hasAnthropic) {
    console.error('Refusing to record: ANTHROPIC_API_KEY is not set. Recorded files must come from the production gate (source "model"); the hand-written files stay labelled as such until then.');
    process.exit(2);
  }
  const { runGateDetailed } = await import('../lib/server/gate');
  type GateRun = Awaited<ReturnType<typeof runGateDetailed>>;
  const { GATE_MODEL, RUBRIC_HASH } = await import('../lib/server/rubric');
  const { settleBackground } = await import('../lib/server/live');

  const only = arg('only');
  const dry = flag('dry-run');
  const recordedAt = new Date().toISOString();
  let totalCalls = 0;
  let totalCost = 0;

  /** One gate with up to two retries for failures that aren't answers (timeouts, limits, overloads). */
  async function gateWithRetries(input: Parameters<typeof runGateDetailed>[0]): Promise<GateRun> {
    let run = await runGateDetailed(input);
    for (let attempt = 0; attempt < 2 && !run.result.ok && !run.result.decision && run.result.kind !== 'budget'; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      run = await runGateDetailed(input);
    }
    totalCalls += 1;
    totalCost += run.cost_usd ?? 0;
    return run;
  }

  const askInput = (a: (typeof SAMPLE_ASKS)[number]) => ({ text: a.text, subject: a.subject, parts: a.parts, asker_stage: a.stage });

  if (only !== 'network') {
    const runs = {} as Record<PresetId, PresetRun>;
    for (const preset of PRESETS) {
      const started = Date.now();
      const gates: RecordedGate[] = [];
      let cost = 0;
      let failed = 0;
      await pool([...SAMPLE_ASKS], 16, async (ask, i) => {
        const run = await gateWithRetries({ rules: preset.rules, ask: askInput(ask) });
        const ms = Date.now() - started;
        cost += run.cost_usd ?? 0;
        const r = run.result;
        const decision = r.ok ? r.decision : r.decision;
        if (!decision) {
          failed += 1;
          console.error(`${preset.id} ${ask.id}: ${r.ok ? '' : r.kind} after retries`);
          return;
        }
        gates[i] = {
          ask_id: ask.id,
          verdict: decision.verdict,
          model_verdict: decision.model_verdict,
          cited: decision.cited,
          decided_by: decision.decided_by,
          reason_code: decision.reason_code,
          reason: decision.reason,
          question: decision.question,
          flags: decision.flags,
          confidence: decision.confidence,
          ms,
          request_id: run.request_id,
        };
      });
      if (failed) {
        console.error(`Not writing: ${failed} gate(s) of the ${preset.label} preset failed after retries. Nothing was changed.`);
        process.exit(1);
      }
      const wall = Math.max(...gates.map((g) => g.ms ?? 0));
      runs[preset.id] = { preset: preset.id, rules_sha256: sha256(preset.rules), wall_ms: wall, cost_usd: Math.round(cost * 1e7) / 1e7, gates };
      const expected = AUTHORED_VERDICTS[preset.id];
      const agree = gates.filter((g, i) => g.verdict === expected[i]?.verdict).length;
      console.log(`${preset.label.padEnd(16)} ${gates.map((g) => g.verdict[0]).join('')}  ${agree}/12 match the hand-written literal reading · ${(wall / 1000).toFixed(1)} s · $${cost.toFixed(4)}`);
      for (const [i, g] of gates.entries()) {
        if (g.verdict !== expected[i]?.verdict) console.log(`  ${g.ask_id}: expected ${expected[i]?.verdict}, the gate said ${g.verdict}${g.decided_by === 'clause_check' ? ' (by the clause check)' : ''}: ${g.reason}`);
      }
    }
    const file: PresetsFile = {
      source: 'model',
      recorded_at: recordedAt,
      model: GATE_MODEL,
      rubric_hash: RUBRIC_HASH,
      note: 'Recorded with the production gate by npm run record:presets: 36 gate calls, cost measured from token usage.',
      runs,
    };
    const problems = validateRecordedFile(file, 'presets');
    if (problems.length) {
      console.error(`Not writing presets.json:\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    if (!dry) writeFileSync(FILES.presets, `${JSON.stringify(file, null, 2)}\n`);
    console.log(dry ? 'presets: dry run, nothing written' : `Wrote ${FILES.presets}`);
  }

  if (only !== 'presets') {
    const runs = {} as Record<SampleNetworkAskId, SampleNetworkRun>;
    for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) {
      const ask = SAMPLE_ASKS.find((a) => a.id === sa.based_on)!;
      const started = Date.now();
      const members = new Array<RecordedMemberGate>(SAMPLE_MEMBERS.length);
      await pool([...SAMPLE_MEMBERS], 16, async (m, i) => {
        const skip = (na: 'paused' | 'at_cap'): RecordedMemberGate => ({ label: m.label, state: 'na', na, reason_code: null, reason: null, cited: [], question: null, flags: [], confidence: null, ms: null });
        if (m.paused) return void (members[i] = skip('paused'));
        if (m.used >= m.cap) return void (members[i] = skip('at_cap'));
        const run = await gateWithRetries({ rules: m.rules, ask: askInput(ask) });
        const ms = Date.now() - started;
        const r = run.result;
        const decision = r.ok ? r.decision : r.decision;
        members[i] = decision
          ? { label: m.label, state: decision.verdict, na: null, reason_code: decision.reason_code, reason: decision.reason, cited: decision.cited, question: decision.question, flags: decision.flags, confidence: decision.confidence, ms }
          : { label: m.label, state: 'failed', na: null, reason_code: null, reason: null, cited: [], question: null, flags: [], confidence: null, ms };
        return undefined;
      });
      const wall = Math.max(0, ...members.map((m) => m.ms ?? 0));
      runs[sa.id] = { sample_ask_id: sa.id, based_on: sa.based_on, wall_ms: wall, members };
      const tally = members.reduce<Record<string, number>>((t, m) => ({ ...t, [m.state]: (t[m.state] ?? 0) + 1 }), {});
      console.log(`${sa.id.padEnd(11)} ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · ')} · ${(wall / 1000).toFixed(1)} s`);
    }
    const file: SampleNetworkFile = {
      source: 'model',
      recorded_at: recordedAt,
      model: GATE_MODEL,
      rubric_hash: RUBRIC_HASH,
      note: 'Recorded with the production gate by npm run record:presets: the 39 sample members × the 3 sample asks (members the SQL prefilter skips are never gated).',
      runs,
    };
    const problems = validateRecordedFile(file, 'sample-network');
    if (problems.length) {
      console.error(`Not writing sample-network.json:\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    if (!dry) writeFileSync(FILES.network, `${JSON.stringify(file, null, 2)}\n`);
    console.log(dry ? 'sample-network: dry run, nothing written' : `Wrote ${FILES.network}`);
  }

  await settleBackground();
  console.log(`\n${totalCalls} gate calls · $${totalCost.toFixed(4)} measured from usage · rubric ${RUBRIC_HASH.slice(0, 12)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'record:presets failed');
  process.exit(1);
});
