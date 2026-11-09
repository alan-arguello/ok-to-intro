/**
 * S2 ↔ BE2: the SAMPLE fan-out the status page renders, end to end in Node (no server, no keys).
 * BE2's startSampleSend / answerSampleQuestion stream the events (docs/CONTRACT.md §c); S2 folds them with the same
 * code the page runs. The asker view S2 paints must agree with the counts BE2 reports in `done`.
 */

import { describe, expect, it } from 'vitest';
import { exampleRows, initialCompose, composeReducer, compiledAskOf, sampleKindOf } from '@/components/ask/compose-model';
import { applyAnswer, cellView, emptyRun, holderCell, legendItems, NETWORK_TOTAL, pendingQuestions, youCell, type SampleRun } from '@/components/ask/fanout-model';
import { foldEvent, sampleSendBody } from '@/components/ask/sample-runner';
import { answerSampleQuestion, startSampleSend } from '@/lib/server/dispatch';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { PRESETS } from '@/lib/sample/presets';
import { createSseParser, encodeSseEvent } from '@/lib/sse';
import type { FanoutEvent, PresetId } from '@/lib/types';

const NOW = Date.UTC(2026, 10, 9, 16, 4);
const PRESET_IDS: PresetId[] = ['engineer', 'health', 'founder'];

/** The ask exactly as the compose page sends it: the Missing 2 parts chip, then “Use all 3 suggestions”. */
function composed(preset: PresetId) {
  const sa = SAMPLE_NETWORK_ASKS[preset];
  const s = composeReducer(
    composeReducer(initialCompose('sample', sa.partial), { type: 'checkExample', text: sa.partial, rows: exampleRows(sa, 'partial'), subject: sa.subject, topic: null }),
    { type: 'useAll' },
  );
  return { sa, text: s.text, compiled: compiledAskOf(s)! };
}

async function collect(events: AsyncIterable<FanoutEvent>): Promise<FanoutEvent[]> {
  const out: FanoutEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function fold(run: SampleRun, events: readonly FanoutEvent[]): SampleRun {
  let r: SampleRun = { ...run, outcome: 'streaming' };
  events.forEach((ev, i) => {
    r = foldEvent(r, ev, i);
  });
  return r;
}

describe('the SAMPLE fan-out as BE2 streams it', () => {
  for (const preset of PRESET_IDS) {
    for (const withYou of [false, true]) {
      it(`${preset}, ${withYou ? 'with' : 'without'} your playground rules`, async () => {
        const { sa, text, compiled } = composed(preset);
        const you = withYou ? { rules: PRESETS.find((p) => p.id === preset)!.rules, cap: 2 } : null;
        const run = emptyRun({ id: sa.id, preset, sample_ask_id: sampleKindOf(text, sa) ? sa.id : null, text, compiled, you, sent_at: NOW });
        expect(run.sample_ask_id).toBe(sa.id);
        const start = await startSampleSend(sampleSendBody(run), { clientKey: null });
        if (!start.ok && start.body.error === 'not_configured') return; // BE2 not built on this checkout
        expect(start.ok).toBe(true);
        if (!start.ok) return;
        expect(start.ask_id).toBe(sa.id);
        const events = await collect(start.events);
        const r = fold(run, events);
        const done = events.find((e) => e.event === 'done');
        expect(done).toBeTruthy();
        expect(r.cells.filter(Boolean)).toHaveLength(NETWORK_TOTAL);
        expect(['offered', 'offered-you']).toContain(r.outcome);
        const offer = events.find((e) => e.event === 'offer');
        expect(holderCell(r)?.cell).toBe(offer?.event === 'offer' ? offer.data.cell : -1);
        // Without a model key your gate is not checked (never an accept), and it is labelled live.
        if (withYou) expect(youCell(r)).toMatchObject({ you: true, state: 'failed', source: 'live' });
        else expect(youCell(r)).toBeNull();
        // The four-state view S2 paints agrees with BE2's own counts.
        if (done?.event === 'done') {
          const legend = Object.fromEntries(legendItems(r, false).map((i) => [i.state, Number(i.text.match(/^\d+/)?.[0])]));
          expect(legend.offered ?? 0).toBe(done.data.counts.offered);
          expect(legend.next ?? 0).toBe(done.data.counts.next);
          expect(legend.ask ?? 0).toBe(done.data.counts.question);
          expect(legend.nothistime ?? 0).toBe(done.data.counts.nothistime);
          expect(done.data.people_interrupted).toBe(r.offered.length);
        }
        for (let pos = 0; pos < NETWORK_TOTAL; pos++) expect(['offered', 'next', 'ask', 'nothistime']).toContain(cellView(r, pos, false));
      });
    }
  }

  it('renders the same final state whether events arrive in one chunk or one character at a time', async () => {
    const { sa, text, compiled } = composed('health');
    const run = emptyRun({ id: sa.id, preset: 'health', sample_ask_id: sa.id, text, compiled, you: null, sent_at: NOW });
    const start = await startSampleSend(sampleSendBody(run), { clientKey: null });
    if (!start.ok) return;
    const events = await collect(start.events);
    const wire = events.map((e, i) => encodeSseEvent(e.event, e.data, i + 1)).join('');
    const parse = (chunks: string[]) => {
      const got: FanoutEvent[] = [];
      const p = createSseParser((m) => got.push({ event: m.event, data: JSON.parse(m.data) } as FanoutEvent));
      for (const c of chunks) p.push(c);
      p.end();
      return got;
    };
    const one = fold(run, parse([wire]));
    const tiny = fold(run, parse(wire.split('')));
    expect(tiny).toEqual(one);
    expect(one.outcome).toBe('offered');
  });

  it('your own text needs live gates: refused without a key, while spacing changes still count as the sample', async () => {
    const { sa, compiled } = composed('engineer');
    const custom = `${sa.partial} We run 2k writes/s.`;
    expect(sampleKindOf(custom, sa)).toBeNull();
    const refused = await startSampleSend({ sample_ask_id: null, text: custom, compiled, you: null }, { clientKey: null });
    if (!refused.ok && refused.body.error === 'not_configured') return;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.status).toBe(503);
    const spaced = sa.partial.replace(/ /g, '  ');
    expect(sampleKindOf(spaced, sa)).toBe('partial');
    const ok = await startSampleSend({ sample_ask_id: sa.id, text: spaced, compiled, you: null }, { clientKey: null });
    expect(ok.ok).toBe(true);
  });
});

describe('answering a gate’s question on a SAMPLE ask', () => {
  it('reruns only the gate that asked; the page shows the new result', async () => {
    const { sa, text, compiled } = composed('engineer');
    const run = emptyRun({ id: sa.id, preset: 'engineer', sample_ask_id: sa.id, text, compiled, you: null, sent_at: NOW });
    const start = await startSampleSend(sampleSendBody(run), { clientKey: null });
    if (!start.ok) return;
    const r = fold(run, await collect(start.events));
    const q = pendingQuestions(r)[0]!;
    expect(q.type).toBe('role');
    const res = await answerSampleQuestion({ sample_ask_id: r.id, compiled: r.compiled, you: null, question: { type: q.type, text: q.text }, answer: sa.askBackSample }, { clientKey: null });
    if (!res.ok && res.body.error === 'not_configured') return;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = applyAnswer(r, q, sa.askBackSample, res, NOW);
    expect(pendingQuestions(after)).toHaveLength(0);
    expect(after.answers).toEqual([{ qid: q.qid, question: { type: q.type, text: q.text }, text: sa.askBackSample, reran: res.reran, accepted: res.accepted, offer: false, you: false }]);
    for (const c of res.cells) expect(cellView(after, c.cell, false)).toBe(c.state === 'accept' ? 'next' : 'nothistime');
    expect(after.outcome).toBe(r.outcome);
  });
});
