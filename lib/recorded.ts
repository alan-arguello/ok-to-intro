/**
 * Recorded runs: the file format, the loader and the honesty labels.
 *
 * data/recorded/presets.json         the 12 SAMPLE asks × 3 presets (S1 “Run” on an unedited preset, try_rules)
 * data/recorded/sample-network.json  the 39 sample members × 3 sample asks (S2 SAMPLE fan-out)
 *
 * Each file is `{source, recorded_at, model, rubric_hash, runs}`:
 * - source "model": recorded with the production gate by `npm run record:presets` (BE1). Rows may show their
 *   recorded latency, the run its cost, and the UI says “Recorded run · <date> · <model>”.
 * - source "authored": generated from the hand-written expectations in lib/sample (`npm run recordings:authored`).
 *   Latency, cost and confidence are null, and the UI must say AUTHORED_LABEL. Never call it a recorded or model run.
 *
 * No zod here: this module ships in the landing page bundle. `validateRecordedFile` is a small hand-written check.
 * The presets file is embedded (about 2 KB gzipped); the sample-network file loads on demand
 * (`loadSampleNetworkRecordings`), so it never weighs on the landing page.
 */

import presetsJson from '@/data/recorded/presets.json';
import { AUTHORED_LABEL } from '@/lib/oti/copy';
import { fmtMs, fmtUsd } from '@/lib/oti/text';
import { fmtClock, fmtDay, NETWORK_TZ } from '@/lib/oti/time';
import type {
  CitedQuote,
  DecidedBy,
  GateFlag,
  GateQuestion,
  PresetId,
  ReasonCode,
  RecordedSource,
  SampleAskKey,
  SampleNetworkAskId,
  TryGateEvent,
  Verdict,
} from '@/lib/types';

export interface RecordedFile<R> {
  source: RecordedSource;
  /** ISO timestamp of the recording (authored files: when they were generated). */
  recorded_at: string;
  /** Model id the run used; authored files name the model the gate will use. */
  model: string;
  /** Hash of rubric + schema + model id (BE1 rubric.ts). Null for authored files. A CI check compares it. */
  rubric_hash: string | null;
  runs: R;
  /** Optional human note, e.g. how the file was produced. */
  note?: string;
}

/** One gate result inside a recorded preset run. `cited` offsets index the preset's rules. */
export interface RecordedGate {
  ask_id: SampleAskKey;
  verdict: Verdict;
  model_verdict: Verdict;
  cited: CitedQuote[];
  decided_by: DecidedBy;
  reason_code: ReasonCode;
  reason: string;
  question: GateQuestion | null;
  flags: GateFlag[];
  /** Null in authored files. */
  confidence: number | null;
  /** Milliseconds from run start; null in authored files. */
  ms: number | null;
  /** Anthropic request id for model runs (shown in the raw trace); null otherwise. */
  request_id?: string | null;
}

export interface PresetRun {
  preset: PresetId;
  /** sha256 of the preset rules text the run used. */
  rules_sha256: string;
  wall_ms: number | null;
  cost_usd: number | null;
  /** In arrival order (a01..a12). */
  gates: RecordedGate[];
}

export type PresetsFile = RecordedFile<Record<PresetId, PresetRun>>;

/** One sample member's recorded gate on a sample ask (city, cap and usage come from lib/sample). */
export interface RecordedMemberGate {
  label: string;
  state: 'accept' | 'decline' | 'ask_back' | 'na' | 'failed';
  na: 'at_cap' | 'paused' | null;
  reason_code: ReasonCode | null;
  reason: string | null;
  /** Offsets index that member's rules (lib/sample SAMPLE_MEMBERS). */
  cited: CitedQuote[];
  question: GateQuestion | null;
  flags: GateFlag[];
  confidence: number | null;
  ms: number | null;
}

export interface SampleNetworkRun {
  sample_ask_id: SampleNetworkAskId;
  based_on: SampleAskKey;
  wall_ms: number | null;
  /** 39 members, in SAMPLE_MEMBERS order. */
  members: RecordedMemberGate[];
}

export type SampleNetworkFile = RecordedFile<Record<SampleNetworkAskId, SampleNetworkRun>>;

/** The recorded preset runs, embedded in the page (no request). */
export const PRESET_RECORDINGS = presetsJson as unknown as PresetsFile;

let networkFile: Promise<SampleNetworkFile> | null = null;

/** The recorded sample-network fan-outs (a separate chunk in the browser; cached after the first load). */
export function loadSampleNetworkRecordings(): Promise<SampleNetworkFile> {
  networkFile ??= import('@/data/recorded/sample-network.json').then((m) => (m.default ?? m) as unknown as SampleNetworkFile);
  return networkFile;
}

export function isAuthored(file: Pick<RecordedFile<unknown>, 'source'>): boolean {
  return file.source !== 'model';
}

/** “Nov 9, 09:00” in Mexico City (recorded data keeps its own date for every viewer). */
export function recordedDateLabel(iso: string): string {
  const ms = Date.parse(iso);
  return `${fmtDay(ms, NETWORK_TZ)}, ${fmtClock(ms, NETWORK_TZ)}`;
}

/**
 * The one label every recorded render carries (ux-spec §2.5: “every recorded render includes ‘Recorded’”, and
 * docs/CONTRACT.md §e for authored files).
 * - model:    “Recorded run · Nov 9, 09:00 · claude-haiku-5-5 · 12 gates in 1.9 s · $0.002”
 * - authored: “Example verdicts, written by hand · not a model run”
 */
export function recordedLabel(file: Pick<RecordedFile<unknown>, 'source' | 'recorded_at' | 'model'>, run?: { gates: number; wall_ms: number | null; cost_usd: number | null }): string {
  if (isAuthored(file)) return AUTHORED_LABEL;
  const bits = [`Recorded run · ${recordedDateLabel(file.recorded_at)} · ${file.model}`];
  if (run && run.wall_ms !== null) bits.push(`${run.gates} gates in ${fmtMs(run.wall_ms)}`);
  if (run && run.cost_usd !== null) bits.push(fmtUsd(run.cost_usd));
  return bits.join(' · ');
}

/** The recorded run for a preset. */
export function presetRun(preset: PresetId): PresetRun {
  return PRESET_RECORDINGS.runs[preset];
}

/** A recorded gate as the `gate` event shape the playground renders (`source: "recorded"`). */
export function recordedGateEvent(gate: RecordedGate, i: number): TryGateEvent {
  return {
    i,
    ask_id: gate.ask_id,
    verdict: gate.verdict,
    model_verdict: gate.model_verdict,
    cited: gate.cited.map((c) => ({ ...c })),
    decided_by: gate.decided_by,
    reason_code: gate.reason_code,
    reason: gate.reason,
    question: gate.question ? { ...gate.question } : null,
    flags: [...gate.flags],
    confidence: gate.confidence,
    ms: gate.ms,
    source: 'recorded',
  };
}

/** The recorded fan-out for a sample ask, with the file's source and date for its label. */
export async function sampleNetworkRun(id: SampleNetworkAskId): Promise<{ file: Omit<SampleNetworkFile, 'runs'>; run: SampleNetworkRun }> {
  const { runs, ...file } = await loadSampleNetworkRecordings();
  return { file, run: runs[id] };
}

const VERDICTS = new Set(['accept', 'decline', 'ask_back']);

/** Shape problems in a recorded file (empty when valid). Used by tests and by the record script before writing. */
export function validateRecordedFile(json: unknown, kind: 'presets' | 'sample-network'): string[] {
  const problems: string[] = [];
  const f = json as Partial<RecordedFile<Record<string, unknown>>>;
  if (!f || typeof f !== 'object') return ['not an object'];
  if (f.source !== 'model' && f.source !== 'authored') problems.push('source must be "model" or "authored"');
  if (typeof f.recorded_at !== 'string' || Number.isNaN(Date.parse(f.recorded_at))) problems.push('recorded_at must be an ISO date');
  if (typeof f.model !== 'string' || !f.model) problems.push('model is required');
  if (f.source === 'model' && (typeof f.rubric_hash !== 'string' || !f.rubric_hash)) problems.push('model files need a rubric_hash');
  if (!f.runs || typeof f.runs !== 'object') return [...problems, 'runs is required'];
  const keys = kind === 'presets' ? ['engineer', 'health', 'founder'] : ['sa_eng', 'sa_health', 'sa_founder'];
  for (const k of keys) {
    const run = (f.runs as Record<string, unknown>)[k] as Record<string, unknown> | undefined;
    if (!run) {
      problems.push(`runs.${k} is missing`);
      continue;
    }
    const rows = (kind === 'presets' ? run.gates : run.members) as unknown[];
    const expected = kind === 'presets' ? 12 : 39;
    if (!Array.isArray(rows) || rows.length !== expected) {
      problems.push(`runs.${k} needs ${expected} rows`);
      continue;
    }
    rows.forEach((row, i) => {
      const r = row as Record<string, unknown>;
      if (kind === 'presets' && !VERDICTS.has(r.verdict as string)) problems.push(`runs.${k}[${i}].verdict`);
      if (f.source === 'authored' && (r.ms !== null || r.confidence !== null)) problems.push(`runs.${k}[${i}]: authored rows carry no timing or confidence`);
      for (const c of (r.cited as CitedQuote[]) ?? []) {
        if (c.found && (typeof c.start !== 'number' || typeof c.end !== 'number')) problems.push(`runs.${k}[${i}]: found quotes need offsets`);
      }
    });
    if (f.source === 'authored' && (run.wall_ms !== null || (kind === 'presets' && run.cost_usd !== null))) problems.push(`runs.${k}: authored runs carry no timing or cost`);
  }
  return problems;
}
