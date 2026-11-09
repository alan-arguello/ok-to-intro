import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  live: 'off' as 'ok' | 'off' | 'down',
  gate: null as null | ((input: { rules: string; answers?: unknown[] }) => Promise<unknown>),
  limited: false,
}));

vi.mock('@/lib/server/gate', () => ({
  runGate: (input: { rules: string }) => (h.gate ? h.gate(input) : Promise.resolve({ ok: false, kind: 'unavailable', ms: 0 })),
  warmGate: async () => ({ ok: false, ms: 0, kind: 'unavailable' }),
}));
vi.mock('@/lib/server/live', () => ({
  getLiveState: async () => ({ state: h.live, paused_until: null }),
  canRunLive: (s: { state: string }) => s.state === 'ok' || s.state === 'slow',
}));
vi.mock('@/lib/server/ratelimit', () => ({
  clientKey: () => 'k',
  checkRateLimit: async () => (h.limited ? { ok: false, retry_at: '2026-11-09T16:42:00.000Z', limit: 20, window_s: 600 } : { ok: true, remaining: 19 }),
}));

import { assembleAskText } from '@/lib/oti/ask';
import { shuffled, hash32, hex4 } from '@/lib/oti/text';
import { answerSampleQuestion, startSampleSend, startSampleSendWith } from '@/lib/server/dispatch';
import { SAMPLE_MEMBERS, SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { PRESETS } from '@/lib/sample/presets';
import type { CompiledAsk, FanoutCellEventSample, FanoutEvent } from '@/lib/types';
import { accepts, asksBack, collect, declines } from './support';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

const ENG = SAMPLE_NETWORK_ASKS.engineer;
const HEALTH = SAMPLE_NETWORK_ASKS.health;

/** The Engineer “Missing 2 parts” sample, completed with the sample answers, as S2 sends it. */
function engCompiled(): CompiledAsk {
  const parts = { challenge: ENG.compiledPartial[0]!.text, tried: ENG.compiledPartial[1]!.text, needs: ENG.compiledPartial[2]!.text, by: 'Nov 21', offers: 'our load-test harness' };
  return { parts, subject: ENG.subject, text: assembleAskText(ENG.partial, parts, ['needs', 'by', 'offers']), price: null, topic: 'Postgres at scale' };
}

function healthCompiled(): CompiledAsk {
  const parts = { challenge: HEALTH.compiledPartial[0]!.text, tried: HEALTH.compiledPartial[1]!.text, needs: HEALTH.compiledPartial[2]!.text, by: 'Nov 20', offers: 'our tender templates' };
  return { parts, subject: HEALTH.subject, text: assembleAskText(HEALTH.partial, parts, ['needs', 'by', 'offers']), price: null, topic: 'Hospital procurement, Mexico' };
}

const engineer = PRESETS.find((p) => p.id === 'engineer')!;

const cellsOf = (events: FanoutEvent[]) => events.filter((e) => e.event === 'cell').map((e) => e.data as FanoutCellEventSample);

beforeEach(() => {
  h.live = 'off';
  h.gate = null;
  h.limited = false;
});

describe('the SAMPLE fan-out without a model key', () => {
  it('replays the 39 sample members from the authored file, labelled as written by hand, and your gate is NOT CHECKED', async () => {
    const start = await startSampleSend({ sample_ask_id: 'sa_eng', text: ENG.partial, compiled: engCompiled(), you: { rules: engineer.rules, cap: 2 } }, { clientKey: null });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.ask_id).toBe('sa_eng');
    const events = await collect(start.events);
    expect(events[0]).toEqual({ event: 'plan', data: { ask_id: 'sa_eng', network: 'sample', total: 40, sample_source: 'authored', recorded_at: '2026-11-09T09:00:00-06:00' } });
    const cells = cellsOf(events);
    expect(cells).toHaveLength(40);
    expect(new Set(cells.map((c) => c.cell)).size).toBe(40);
    // Fixed shuffled positions, the prototype's: cell i of [39 members, you] sits at shuffled(40, hash('sa_eng'))[i].
    const order = shuffled(40, hash32('sa_eng'));
    for (const [i, m] of SAMPLE_MEMBERS.entries()) expect(cells.find((c) => c.label === m.label)?.cell).toBe(order[i]);
    const you = cells.find((c) => c.you)!;
    expect(you).toMatchObject({ cell: order[39], state: 'failed', label: 'You', source: 'live', cap: 2, used: 0, ms: null });
    for (const c of cells.filter((x) => !x.you)) {
      expect(c.source).toBe('authored');
      expect(c.ms).toBeNull(); // authored data has no latency
    }
    expect(cells.filter((c) => c.state === 'na').map((c) => c.na).sort()).toEqual(['at_cap', 'at_cap', 'at_cap', 'at_cap', 'at_cap', 'paused', 'paused']);
    const accept = cells.find((c) => c.label === 'm-7f2a')!;
    expect(accept).toMatchObject({ state: 'accept', cited: 'Happy to talk about Postgres or Kafka at scale', reason_code: 'match' });

    const q = events.find((e) => e.event === 'question');
    expect(q?.data).toEqual({ qid: `q_${hex4('sa_eng:role')}`, type: 'role', text: 'Who on your team would join the call, and what is their role?', gates: 1 });
    const offer = events.find((e) => e.event === 'offer');
    expect(offer?.data).toMatchObject({ to: 'member' });
    const holder = cells.find((c) => c.cell === (offer?.data as { cell: number }).cell);
    expect(['m-7f2a', 'm-19b4']).toContain(holder?.label);
    expect(events.at(-1)).toMatchObject({
      event: 'done',
      data: { people_interrupted: 1, gates_ran: 33, gates_failed: 1, failed_closed: false, counts: { offered: 1, next: 1, question: 1, nothistime: 37 } },
    });
    // The offer holds for 72 hours from now (the viewer's own clock).
    const expires = Date.parse((offer?.data as { expires_at: string }).expires_at);
    expect(Math.abs(expires - (Date.now() + 72 * 3_600_000))).toBeLessThan(10_000);
  });

  it('without playground rules the 40th cell is a hand-written sample member that declines', async () => {
    const start = await startSampleSend({ sample_ask_id: 'sa_eng', text: ENG.partial, compiled: engCompiled(), you: null }, { clientKey: null });
    if (!start.ok) throw new Error('refused');
    const cells = cellsOf(await collect(start.events));
    const filler = cells.find((c) => c.cell === shuffled(40, hash32('sa_eng'))[39]);
    expect(filler).toMatchObject({ you: false, label: `m-${hex4('sa_eng:fill')}`, state: 'decline', reason_code: 'topic', source: 'authored', city: 'Monterrey' });
    expect(cells.some((c) => c.you)).toBe(false);
  });

  it('refuses your own text (all 40 gates would run live) with the off copy, and refuses invalid or YC asks', async () => {
    const c = engCompiled();
    const custom = await startSampleSend({ sample_ask_id: null, text: 'We sell a queue for hospitals. Tried Kafka; it drops jobs.', compiled: c, you: null }, { clientKey: null });
    expect(custom).toMatchObject({ ok: false, status: 503, body: { error: 'live_unavailable', live: 'off' } });
    if (!custom.ok) expect(custom.body.message).toMatch(/no model API key is set/);
    // The sample id with edited text is your own text too.
    const edited = await startSampleSend({ sample_ask_id: 'sa_eng', text: `${ENG.partial} Also we use Redis.`, compiled: c, you: null }, { clientKey: null });
    expect(edited).toMatchObject({ ok: false, status: 503 });
    const yc = await startSampleSend({ sample_ask_id: null, text: 'Who can refer me for the YC batch interview?', compiled: { ...c, text: 'Who can refer me for the YC batch interview?' }, you: null }, { clientKey: null });
    expect(yc).toMatchObject({ ok: false, status: 400, body: { error: 'invalid' } });
    const bad = await startSampleSend({ sample_ask_id: 'sa_eng', text: ENG.partial, compiled: engCompiled(), you: { rules: 'x'.repeat(1001), cap: 2 } }, { clientKey: null });
    expect(bad).toMatchObject({ ok: false, status: 400 });
  });

  it('answering a sample question reruns only the gates that asked; the hand-written sample expects them to accept, nobody new is interrupted', async () => {
    const res = await answerSampleQuestion(
      { sample_ask_id: 'sa_eng', compiled: engCompiled(), you: null, question: { type: 'role', text: 'Who on your team would join the call, and what is their role?' }, answer: ENG.askBackSample },
      { clientKey: null },
    );
    expect(res).toMatchObject({ ok: true, reran: 1, accepted: 1, offer: null });
    if (res.ok) expect(res.cells).toEqual([expect.objectContaining({ label: 'm-c3d0', state: 'accept', source: 'authored', cited: 'Happy to talk about Postgres, Redis or queues', ms: null })]);
    const unknown = await answerSampleQuestion({ sample_ask_id: 'sa_zzzzzz', compiled: engCompiled(), you: null, question: { type: 'price', text: 'x' }, answer: 'y' }, { clientKey: null });
    expect(unknown).toMatchObject({ ok: false, status: 400, body: { error: 'not_found' } });
  });
});

describe('the SAMPLE fan-out with live gates', () => {
  it('your gate runs live; with the most unused cap the offer goes to you', async () => {
    h.live = 'ok';
    h.gate = async (input) => accepts(input.rules, 'founders about Postgres, queues or LLM evals in production', 1290);
    const start = await startSampleSend({ sample_ask_id: 'sa_eng', text: ENG.partial, compiled: engCompiled(), you: { rules: engineer.rules, cap: 2 } }, { clientKey: null });
    if (!start.ok) throw new Error('refused');
    const events = await collect(start.events);
    const you = cellsOf(events).find((c) => c.you)!;
    expect(you).toMatchObject({ state: 'accept', source: 'live', ms: 1290, cited: 'founders about Postgres, queues or LLM evals in production' });
    expect(events.find((e) => e.event === 'offer')?.data).toMatchObject({ to: 'you', cell: you.cell });
  });

  it('a rate-limited visitor still gets the sample members; only their own gate is not checked', async () => {
    h.live = 'ok';
    h.limited = true;
    h.gate = async (input) => accepts(input.rules, 'founders about Postgres, queues or LLM evals in production');
    const start = await startSampleSend({ sample_ask_id: 'sa_eng', text: ENG.partial, compiled: engCompiled(), you: { rules: engineer.rules, cap: 2 } }, { clientKey: 'k' });
    if (!start.ok) throw new Error('refused');
    expect(cellsOf(await collect(start.events)).find((c) => c.you)?.state).toBe('failed');
  });

  it('your own text runs all 40 gates live (members at their cap or paused are skipped first), with a sa_ id', async () => {
    h.live = 'ok';
    const ruled = new Set(SAMPLE_MEMBERS.filter((m) => m.topic === 'health').map((m) => m.rules));
    h.gate = async (input) => (ruled.has(input.rules) ? (input.rules.includes('price') ? asksBack(input.rules, { type: 'price', text: 'What do you charge per hospital?' }) : accepts(input.rules, input.rules.split('.')[0] as string)) : declines(input.rules));
    const c = healthCompiled();
    const custom = { ...c, text: 'We sell inventory software to clinics in Puebla. 9 pilots, 2 paid. Need someone who has bought for a hospital network.' };
    const start = await startSampleSendWith({ sample_ask_id: null, text: custom.text, compiled: custom, you: null }, { clientKey: null }, { replay: false });
    if (!start.ok) throw new Error(`refused ${start.status}`);
    expect(start.ask_id).toMatch(/^sa_[0-9A-Za-z]{6}$/);
    const events = await collect(start.events);
    expect(events[0]?.data).toMatchObject({ sample_source: 'live' });
    const cells = cellsOf(events);
    expect(cells).toHaveLength(40);
    expect(cells.filter((c) => c.state === 'na').every((c) => c.source === 'authored' && c.ms === null)).toBe(true);
    // 39 members − 7 skipped = 32 live gates; the 40th (no playground rules) is the hand-written filler.
    expect(cells.filter((c) => c.source === 'live')).toHaveLength(32);
    const offer = events.find((e) => e.event === 'offer');
    expect(offer).toBeTruthy();
    // The question asked on custom text can be answered within the hour (this instance remembers who asked).
    const res = await answerSampleQuestion({ sample_ask_id: start.ask_id, compiled: custom, you: null, question: { type: 'price', text: 'What do you charge per hospital?' }, answer: '$18k a year per hospital' }, { clientKey: null });
    expect(res).toMatchObject({ ok: true, reran: 1, offer: null });
  });

  it('more than 1 in 5 live gates failing offers nothing (fail closed)', async () => {
    h.live = 'ok';
    let n = 0;
    h.gate = async (input) => (n++ % 3 === 0 ? accepts(input.rules, input.rules.split('.')[0] as string) : { ok: false, kind: 'timeout', ms: 6000 });
    const c = engCompiled();
    const text = 'Our worker queue drops 2% of jobs at 30k jobs a day. Tried retries and a dead-letter queue.';
    const start = await startSampleSend({ sample_ask_id: null, text, compiled: { ...c, text }, you: null }, { clientKey: null });
    if (!start.ok) throw new Error('refused');
    const events = await collect(start.events);
    expect(events.some((e) => e.event === 'offer')).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { failed_closed: true, people_interrupted: 0, counts: { offered: 0, next: 0, question: 0, nothistime: 40 } } });
  });
});
