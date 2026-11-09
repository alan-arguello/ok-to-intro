/**
 * npm run bench — gate latency and cost, measured (owner: BE1).
 *
 *   npm run bench                    3 runs × 12 gates (the Engineer preset on the 12 sample asks), 16 in flight
 *   npm run bench -- --runs 5 --n 40 40 gates per run (the 12 sample asks repeated), like a sample-network fan-out
 *   npm run bench -- --dry-run       print, write nothing
 *
 * Calls the production gate (lib/server/gate.ts `runGateDetailed`) and prints p50 / p90 / p95 latency per call, wall
 * time per run, rate limits, the share of calls that read the prompt cache, and the mean cost per gate call measured
 * from token usage. It also counts the rubric's tokens with count_tokens on claude-haiku-5-5 (the cached prefix
 * must be 512 tokens or more, or it silently never caches) and reports whether the cache was read after the first
 * run. Writes data/recorded/bench.json (`source: "model"`); the integrator then replaces the estimated per-gate cost
 * (lib/sample/cost.ts COST.perGate, marked `estimate: true`) with the measured mean.
 * Refuses to run without ANTHROPIC_API_KEY.
 */

import { writeFileSync } from 'node:fs';
import Module from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_ASKS } from '../lib/sample/asks';
import { PRESETS } from '../lib/sample/presets';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'recorded', 'bench.json');

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

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] as number;
}

async function main() {
  loadEnvFiles();
  allowServerOnly();
  const { flags } = await import('../lib/env');
  if (!flags.hasAnthropic) {
    console.error('SKIPPED: ANTHROPIC_API_KEY is not set. The bench calls the production gate; add the key to .env.local.');
    process.exit(2);
  }
  const { runGateDetailed } = await import('../lib/server/gate');
  const { getModelClient, settleBackground } = await import('../lib/server/live');
  const { GATE_MODEL, GATE_RUBRIC, GATES_IN_FLIGHT, RUBRIC_HASH } = await import('../lib/server/rubric');

  const runs = Math.max(1, Math.min(10, Number(arg('runs') ?? 3) || 3));
  const n = Math.max(1, Math.min(40, Number(arg('n') ?? 12) || 12));
  const rules = PRESETS.find((p) => p.id === 'engineer')!.rules;

  // The cached prefix must be 512+ tokens on claude-haiku-5-5.
  let rubricTokens: number | null = null;
  try {
    const client = getModelClient()!;
    const messages = [{ role: 'user' as const, content: 'x' }];
    const withRubric = await client.messages.countTokens({ model: GATE_MODEL, system: [{ type: 'text', text: GATE_RUBRIC }], messages });
    const without = await client.messages.countTokens({ model: GATE_MODEL, messages });
    rubricTokens = withRubric.input_tokens - without.input_tokens;
  } catch (err) {
    console.warn(`count_tokens failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  const latencies: number[] = [];
  const walls: number[] = [];
  const kinds: Record<string, number> = {};
  let calls = 0;
  let cacheReads = 0;
  let cacheReadsAfterFirst = 0;
  let callsAfterFirst = 0;
  let cost = 0;
  let costCalls = 0;

  for (let r = 0; r < runs; r++) {
    const started = Date.now();
    const asks = Array.from({ length: n }, (_, i) => SAMPLE_ASKS[i % SAMPLE_ASKS.length]!);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(GATES_IN_FLIGHT, asks.length) }, async () => {
        while (next < asks.length) {
          const ask = asks[next++]!;
          const run = await runGateDetailed({ rules, ask: { text: ask.text, subject: ask.subject, parts: ask.parts, asker_stage: ask.stage } });
          calls += 1;
          const kind = run.result.ok ? 'ok' : run.result.kind;
          kinds[kind] = (kinds[kind] ?? 0) + 1;
          if (run.result.ok || run.result.decision) latencies.push(run.result.ms);
          if (run.cost_usd !== null) {
            cost += run.cost_usd;
            costCalls += 1;
          }
          const hit = (run.usage?.cache_read_input_tokens ?? 0) > 0;
          if (hit) cacheReads += 1;
          if (r > 0) {
            callsAfterFirst += 1;
            if (hit) cacheReadsAfterFirst += 1;
          }
        }
      }),
    );
    walls.push(Date.now() - started);
    console.log(`run ${r + 1}: ${n} gates in ${((Date.now() - started) / 1000).toFixed(2)} s`);
  }
  await settleBackground();

  const result = {
    source: 'model' as const,
    measured_at: new Date().toISOString(),
    model: GATE_MODEL,
    rubric_hash: RUBRIC_HASH,
    rubric_tokens: rubricTokens,
    runs,
    gates_per_run: n,
    calls,
    outcomes: kinds,
    latency_ms: { p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9), p95: percentile(latencies, 0.95) },
    wall_ms: { p50: percentile(walls, 0.5), max: Math.max(...walls) },
    cache_read_share: calls ? Math.round((cacheReads / calls) * 1000) / 1000 : 0,
    cache_read_share_after_first_run: callsAfterFirst ? Math.round((cacheReadsAfterFirst / callsAfterFirst) * 1000) / 1000 : null,
    mean_cost_usd: costCalls ? Math.round((cost / costCalls) * 1e8) / 1e8 : null,
    total_cost_usd: Math.round(cost * 1e6) / 1e6,
  };
  console.log('');
  console.log(`${GATE_MODEL} · rubric ${RUBRIC_HASH.slice(0, 12)} · ${calls} gate calls`);
  console.log(`rubric tokens: ${rubricTokens ?? 'unknown'}${rubricTokens !== null ? (rubricTokens >= 512 ? ' (cacheable: 512+)' : ' (UNDER 512: the rubric will not cache)') : ''}`);
  console.log(`latency per call: p50 ${result.latency_ms.p50} ms · p90 ${result.latency_ms.p90} ms · p95 ${result.latency_ms.p95} ms`);
  console.log(`wall per run of ${n}: p50 ${result.wall_ms.p50} ms · max ${result.wall_ms.max} ms`);
  console.log(`outcomes: ${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
  console.log(`cache reads: ${Math.round(result.cache_read_share * 100)}% of calls${result.cache_read_share_after_first_run !== null ? ` (${Math.round(result.cache_read_share_after_first_run * 100)}% after the first run)` : ''}`);
  console.log(`cost: $${result.total_cost_usd.toFixed(4)} in all · mean $${(result.mean_cost_usd ?? 0).toFixed(6)} per gate call, measured from usage`);
  if (runs > 1 && result.cache_read_share_after_first_run === 0) console.warn('WARNING: no call after the first run read the cache. Check the rubric length and what changes between calls.');
  if (flag('dry-run')) {
    console.log('dry run: nothing written');
    return;
  }
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'bench failed');
  process.exit(1);
});
