import { describe, expect, it, vi } from 'vitest';

/**
 * The model-source path, pinned to a copy of the claude-haiku-5-5 recording (commit 6a17cf9) in
 * tests/fixtures/recorded/model/: what every surface shows when data/recorded holds `source: "model"`. The
 * hand-written path is pinned in the playground, ask, network, gates and agents tests (tests/fixtures/recorded/authored/).
 * No keys exist in tests, so nothing here calls a model.
 */

vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/model/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/model/sample-network.json'));

import { POST as tryRoute } from '@/app/api/try/route';
import { POST as mcp } from '@/app/mcp/route';
import { emptyRun, type SampleRun, sourceLine } from '@/components/ask/fanout-model';
import { foldEvent } from '@/components/ask/sample-runner';
import { recordedRunFor } from '@/components/playground/engine';
import { chainText, computeDisplays, gateOutput, latencyText, traceRows, type RowGate } from '@/components/playground/model';
import { assembleAskText } from '@/lib/oti/ask';
import { AUTHORED_FANOUT_LABEL, AUTHORED_LABEL } from '@/lib/oti/copy';
import { PRESET_RECORDINGS, recordedLabel, presetRun } from '@/lib/recorded';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { presetById } from '@/lib/sample/presets';
import { answerSampleQuestion, startSampleSend } from '@/lib/server/dispatch';
import { readSse } from '@/lib/sse';
import type { CompiledAsk, FanoutCellEventSample, FanoutEvent, TryDoneEvent, TryEvent, TryGateEvent } from '@/lib/types';

const ENGINEER = presetById('engineer').rules;
const HAND_WRITTEN = /written by hand|example verdicts|example results|not a model run/i;

describe('the recorded presets (S1 playground)', () => {
  const run = recordedRunFor('engineer', ENGINEER, Date.parse('2026-11-09T16:00:00Z'));
  const { map, reachDays } = computeDisplays(run, [], 2, false);

  it('the file is a model recording, and its label says recorded, with date, model, wall time and cost', () => {
    expect(PRESET_RECORDINGS.source).toBe('model');
    const pr = presetRun('engineer');
    const label = recordedLabel(PRESET_RECORDINGS, { gates: pr.gates.length, wall_ms: pr.wall_ms, cost_usd: pr.cost_usd });
    expect(label).toBe('Recorded run · Nov 9, 15:02 · claude-haiku-5-5 · 12 gates in 3.2 s · $0.001');
    expect(label).not.toBe(AUTHORED_LABEL);
  });

  it('rows show their recorded latency and say model, never hand-written', () => {
    expect(run.source).toBe('recorded');
    expect(latencyText(map.a01)).toBe('2.1 s · recorded');
    expect(chainText(map.a01, 2)).toBe('model accept → code 2 of 2 quotes found → cap 1 of 2');
    expect(gateOutput(map.a01.gate as RowGate).summary).toBe('Gate output (model)');
    for (const d of Object.values(map)) {
      expect(latencyText(d)).toMatch(/^\d+(\.\d)? s · recorded$|^\d+ ms · recorded$/);
      expect(chainText(d, 2)).not.toMatch(HAND_WRITTEN);
    }
  });

  it('the raw trace is timed, reports the measured cost, and ends with done', () => {
    const rows = traceRows(run, map, 2, reachDays);
    expect(rows.every((r) => r.time !== null)).toBe(true);
    const text = rows.map((r) => r.segs.map((s) => s.text).join(''));
    expect(text[0]).toBe('plan  run r_64d8 · recorded Nov 9, 15:02 · 12 gates · rules 196 chars');
    // The last gate arrives at the run's wall time; its check and cap lines still come before done.
    expect(text.at(-1)).toBe('done  3 accept · 1 ask_back · 8 decline · 0 failed · $0.0014');
    expect(text.at(-2)).toBe('cap   #9 over_cap · used day 2, day 4 (code)');
    expect(text.join('\n')).not.toMatch(HAND_WRITTEN);
  });

  it('POST /api/try, mode auto, streams the recording labelled recorded, with its ms and confidence', async () => {
    const res = await tryRoute(
      new Request('http://localhost:3200/api/try', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.21' }, body: JSON.stringify({ rules: ENGINEER, mode: 'auto' }) }),
    );
    const evs: TryEvent[] = [];
    await readSse<TryEvent>(res, (e) => evs.push(e));
    expect(evs[0]).toMatchObject({ event: 'plan', data: { mode: 'recorded', recorded_at: PRESET_RECORDINGS.recorded_at } });
    const gates = evs.filter((e) => e.event === 'gate').map((e) => e.data as TryGateEvent);
    expect(gates).toHaveLength(12);
    for (const g of gates) {
      expect(g.source).toBe('recorded');
      expect(typeof g.ms).toBe('number');
      expect(typeof g.confidence).toBe('number');
    }
    const done = evs.at(-1)!.data as TryDoneEvent;
    expect(done.cost_usd).toBe(presetRun('engineer').cost_usd);
  });
});

describe('the recorded sample network (S2 SAMPLE fan-out)', () => {
  const HEALTH = SAMPLE_NETWORK_ASKS.health;
  const parts = { challenge: HEALTH.compiledPartial[0]!.text, tried: HEALTH.compiledPartial[1]!.text, needs: HEALTH.compiledPartial[2]!.text, by: 'Nov 20', offers: 'our tender templates' };
  const compiled: CompiledAsk = { parts, subject: HEALTH.subject, text: assembleAskText(HEALTH.partial, parts, ['needs', 'by', 'offers']), price: null, topic: null };

  async function send() {
    const start = await startSampleSend({ sample_ask_id: HEALTH.id, text: HEALTH.partial, compiled, you: null }, { clientKey: null });
    if (!start.ok) throw new Error(`refused ${start.status}`);
    const events: FanoutEvent[] = [];
    for await (const e of start.events) events.push(e);
    return events;
  }

  it('replays the 39 members labelled recorded, with their latency, and the page says so', async () => {
    const events = await send();
    expect(events[0]).toMatchObject({ event: 'plan', data: { sample_source: 'model' } });
    const cells = events.filter((e) => e.event === 'cell').map((e) => e.data as FanoutCellEventSample);
    const members = cells.filter((c) => c.source !== 'authored');
    expect(members).toHaveLength(39); // the 40th, without playground rules, is the one hand-written cell
    for (const c of members) {
      expect(c.source).toBe('recorded');
      if (c.state === 'na') expect(c.ms).toBeNull();
      else expect(typeof c.ms).toBe('number');
    }
    let run: SampleRun = { ...emptyRun({ id: HEALTH.id, preset: 'health', sample_ask_id: HEALTH.id, text: HEALTH.partial, compiled, you: null, sent_at: 0 }), outcome: 'streaming' };
    events.forEach((e, i) => {
      run = foldEvent(run, e, i);
    });
    const line = sourceLine(run, true);
    expect(line).toMatch(/^40 recorded sample members \(.+, replayed at recorded speed\)$/);
    expect(line).not.toContain(AUTHORED_FANOUT_LABEL);
  }, 15_000);

  it('answering a recorded member’s question without live calls is refused, never reported as a decline', async () => {
    const q = { type: 'price' as const, text: 'What is the list price per year of your inventory software for a public hospital?' };
    const res = await answerSampleQuestion({ sample_ask_id: HEALTH.id, compiled, you: null, question: q, answer: '$18k a year per hospital' }, { clientKey: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'live_unavailable', live: 'off' });
    expect(res.body.message).toBe('The gates that asked rerun live, and they can’t right now. Live checks are off on this instance: no model API key is set. Nothing was sent to anyone.');
  });
});

describe('MCP on a model recording', () => {
  let id = 0;
  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await mcp(
      new Request('http://localhost:3200/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', 'x-forwarded-for': '203.0.113.22' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
      }),
    );
    const raw = await res.text();
    const data = res.headers.get('content-type')?.includes('text/event-stream')
      ? raw
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => JSON.parse(l.slice(6)))
          .find((m) => m.id === id)
      : JSON.parse(raw);
    const result = data.result as { content: { text: string }[]; isError?: boolean };
    return { text: result.content.map((c) => c.text).join('\n'), isError: !!result.isError };
  }

  it('try_rules on a preset says recorded, with date and model, and no hand-written copy', async () => {
    const { text, isError } = await callTool('try_rules', { rules: ENGINEER });
    expect(isError).toBe(false);
    expect(text.split('\n')[0]).toBe('ok-to-intro · try_rules · 12 SAMPLE asks · cap 2 · recorded · Nov 9, 15:02 · claude-haiku-5-5');
    expect(text).toContain('Recorded run, replayed from a file');
    expect(text).not.toMatch(HAND_WRITTEN);
  });

  it('answer_question on a recorded SAMPLE ask without a key says the gates can’t rerun, with no duration', async () => {
    const { text, isError } = await callTool('answer_question', { ask_id: 'sa_health', question_id: 'q_f2b7', answer: '$18k a year per hospital' });
    expect(isError).toBe(true);
    expect(text).toContain('The gates that asked rerun live, and they can’t right now.');
    expect(text).toContain('next: answer again once live checks are back; nothing about the ask changed.');
    expect(text).not.toMatch(/reran once and declined|\d ms/);
  });
});
