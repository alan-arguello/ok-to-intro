import { describe, expect, it, vi } from 'vitest';

/**
 * Once `npm run record:presets` records the sample network with the real gate (`source: "model"`), the SAMPLE fan-out
 * replays the 39 members at their recorded latency, labelled recorded, with their ms; reduced motion (`replay: false`)
 * renders the same results at once. Today's file is hand-written (sample.test.ts covers that); this swaps in a model
 * file built from it, with short latencies so the replay is quick.
 */

vi.mock('@/lib/server/gate', () => ({
  runGate: async () => ({ ok: false, kind: 'unavailable', ms: 0 }),
  warmGate: async () => ({ ok: false, ms: 0, kind: 'unavailable' }),
}));
vi.mock('@/lib/server/live', () => ({
  getLiveState: async () => ({ state: 'off', paused_until: null }),
  canRunLive: () => false,
}));
vi.mock('@/lib/server/ratelimit', () => ({ clientKey: () => null, checkRateLimit: async () => ({ ok: true, remaining: 20 }) }));
vi.mock('@/lib/recorded', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/recorded')>();
  return {
    ...real,
    sampleNetworkRun: async (id: Parameters<typeof real.sampleNetworkRun>[0]) => {
      const { file, run } = await real.sampleNetworkRun(id);
      return {
        file: { ...file, source: 'model' as const, recorded_at: '2026-11-09T09:00:00-08:00', model: 'claude-haiku-5-5', rubric_hash: 'test' },
        run: { ...run, members: run.members.map((m, i) => ({ ...m, ms: m.state === 'na' ? null : 20 + ((i * 37) % 160) })) },
      };
    },
  };
});

import { assembleAskText } from '@/lib/oti/ask';
import { startSampleSendWith } from '@/lib/server/dispatch';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import type { CompiledAsk, FanoutCellEventSample, FanoutEvent } from '@/lib/types';

const ENG = SAMPLE_NETWORK_ASKS.engineer;
const parts = { challenge: ENG.compiledPartial[0]!.text, tried: ENG.compiledPartial[1]!.text, needs: ENG.compiledPartial[2]!.text, by: 'Nov 21', offers: 'our load-test harness' };
const compiled: CompiledAsk = { parts, subject: ENG.subject, text: assembleAskText(ENG.partial, parts, ['needs', 'by', 'offers']), price: null, topic: null };

async function timed(replay: boolean) {
  const start = await startSampleSendWith({ sample_ask_id: 'sa_eng', text: ENG.partial, compiled, you: null }, { clientKey: null }, { replay });
  if (!start.ok) throw new Error(`refused ${start.status}`);
  const t0 = Date.now();
  const events: { e: FanoutEvent; at: number }[] = [];
  for await (const e of start.events) events.push({ e, at: Date.now() - t0 });
  return events;
}

describe('a recorded (model) sample network', () => {
  it('replays the 39 members at their recorded latency, labelled recorded, SQL skips first', async () => {
    const events = await timed(true);
    expect(events[0]?.e).toEqual({ event: 'plan', data: { ask_id: 'sa_eng', network: 'sample', total: 40, sample_source: 'model', recorded_at: '2026-11-09T09:00:00-08:00' } });
    const cells = events.filter((x) => x.e.event === 'cell').map((x) => ({ c: x.e.data as FanoutCellEventSample, at: x.at }));
    expect(cells).toHaveLength(40);
    // Every sample member is labelled by the file's source; only the 40th cell (no playground rules) is hand-written.
    expect(cells.filter(({ c }) => c.source === 'authored')).toHaveLength(1);
    const members = cells.filter(({ c }) => c.source !== 'authored');
    expect(members).toHaveLength(39);
    for (const { c } of members) {
      expect(c.source).toBe('recorded');
      if (c.state === 'na') expect(c.ms).toBeNull();
      else expect(typeof c.ms).toBe('number');
    }
    // The SQL skips come first (at once), then the gates in recorded order: arrival never runs ahead of its ms.
    const firstGate = cells.findIndex(({ c }) => c.state !== 'na');
    expect(cells.slice(0, firstGate).every(({ c }) => c.state === 'na')).toBe(true);
    const gates = cells.filter(({ c }) => c.state !== 'na' && c.source === 'recorded');
    for (let i = 1; i < gates.length; i++) expect((gates[i]!.c.ms ?? 0) >= (gates[i - 1]!.c.ms ?? 0)).toBe(true);
    for (const { c, at } of gates) expect(at).toBeGreaterThanOrEqual((c.ms ?? 0) - 15);
    expect(events.at(-1)?.e.event).toBe('done');
  });

  it('with reduced motion (replay off) the same results arrive at once', async () => {
    const slow = await timed(true);
    const fast = await timed(false);
    const states = (evs: { e: FanoutEvent }[]) =>
      evs
        .filter((x) => x.e.event === 'cell')
        .map((x) => x.e.data as FanoutCellEventSample)
        .sort((a, b) => a.cell - b.cell)
        .map((c) => `${c.cell}:${c.state}:${c.ms}`);
    expect(states(fast)).toEqual(states(slow));
    expect(fast.at(-1)!.at).toBeLessThan(60);
    expect(slow.at(-1)!.at).toBeGreaterThanOrEqual(150);
  });
});
