import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveBlockCopy } from '@/components/playground/copy';
import { displaysOf, isEdited, PlaygroundEngine, recordedRunFor, type EngineDeps } from '@/components/playground/engine';
import { ASK_IDS, countDisplays, type Run } from '@/components/playground/model';
import { applyQaState } from '@/components/playground/qa-fixtures';
import type { PlaygroundStorage } from '@/components/playground/store';
import { QA_STATES } from '@/lib/qa';
import type { PlaygroundStore } from '@/lib/oti/storage';
import { presetById } from '@/lib/sample/presets';
import type { PostSseResult } from '@/lib/sse';
import type { SampleAskKey, TryEvent, TryRequest } from '@/lib/types';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

const ENGINEER = presetById('engineer').rules;
const EDITED = `${ENGINEER}\nNo asks about crypto.`;

type Script = (emit: (e: TryEvent) => void, body: TryRequest, signal: AbortSignal) => Promise<PostSseResult> | PostSseResult;

function memoryStorage(): PlaygroundStorage & { saved: PlaygroundStore[]; run: Run | null } {
  const st = {
    saved: [] as PlaygroundStore[],
    run: null as Run | null,
    load: () => st.saved[st.saved.length - 1] ?? null,
    save: (v: PlaygroundStore) => {
      st.saved.push(JSON.parse(JSON.stringify(v)) as PlaygroundStore);
    },
    loadRun: () => (st.run ? (JSON.parse(JSON.stringify(st.run)) as Run) : null),
    saveRun: (r: Run | null) => {
      st.run = r ? (JSON.parse(JSON.stringify(r)) as Run) : null;
    },
  };
  return st;
}

function setup(script?: Script, storage = memoryStorage()) {
  const calls: TryRequest[] = [];
  const announced: string[] = [];
  let clock = Date.parse('2026-11-09T18:00:00Z');
  const deps: EngineDeps = {
    postTry: async (body, onEvent, signal) => {
      calls.push(body);
      if (!script) return { ok: false, status: 503, body: { error: 'live_unavailable', live: 'off', until: null } };
      return script(onEvent, body, signal);
    },
    announce: (m) => announced.push(m),
    storage,
    now: () => clock,
  };
  const engine = new PlaygroundEngine(deps);
  return { engine, calls, announced, storage, tick: (ms: number) => (clock += ms) };
}

/** A live `gate` event for an ask, from the Engineer example verdicts (offsets valid for any rules that start with Engineer). */
function gate(id: SampleAskKey, i: number, over: Record<string, unknown> = {}): TryEvent {
  const g = recordedRunFor('engineer', ENGINEER, 0).gates[id];
  if (!g) throw new Error(id);
  return { event: 'gate', data: { ...g, i: ASK_IDS.indexOf(id), confidence: 0.82, ms: 900 + i * 37, source: 'live', ...over } as never };
}
const plan = (ids: readonly SampleAskKey[] = ASK_IDS): TryEvent => ({
  event: 'plan',
  data: { run_id: 'r_live1', mode: 'live', rules_chars: EDITED.length, gates: ids.map((id) => ({ i: ASK_IDS.indexOf(id), ask_id: id })) },
});
const done = (wall = 2300, cost: number | null = 0.0019): TryEvent => ({ event: 'done', data: { counts: { accept: 3, decline: 8, ask_back: 1, failed: 0 }, wall_ms: wall, cost_usd: cost } });

/** A full live stream, all events delivered synchronously (one chunk). */
const fullStream: Script = (emit) => {
  emit(plan());
  ASK_IDS.forEach((id, i) => emit(gate(id, i)));
  emit(done());
  return { ok: true, completed: true, status: 200 };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('Run on an unedited preset', () => {
  it('renders the recorded file at once, labelled by its source, and saves the contract shape', () => {
    const { engine, calls, storage, announced } = setup();
    expect(engine.run()).toBe('recorded');
    const s = engine.getState();
    expect(calls).toHaveLength(0);
    expect(s.phase).toBe('done');
    expect(s.run?.source).toBe('authored');
    expect(s.view).toBe('read');
    const c = countDisplays(displaysOf(s).map);
    expect([c.reach, c.held, c.ask, c.declined]).toEqual([2, 1, 1, 8]);
    expect(s.order.slice(0, 4)).toEqual(['a01', 'a03', 'a06', 'a09']);
    expect(announced.at(-1)).toBe('12 example verdicts: 2 reach you, 1 over your cap, 1 question first, 8 declined.');
    const saved = storage.saved.at(-1) as PlaygroundStore;
    expect(saved).toMatchObject({ v: 1, preset: 'engineer', rules: ENGINEER, cap: 2, edited: false, mode: 'recorded', run_rules: ENGINEER, marks: [] });
    expect(saved.results).toHaveLength(12);
    expect(saved.results[0]).toEqual({
      ask_id: 'a01',
      display: 'reach',
      cited: ['founders about Postgres, queues or LLM evals in production', 'a real workload: a table size, a p95 or an error rate'],
    });
    expect(storage.run).toBeNull();
  });
});

describe('live runs (POST /api/try)', () => {
  it('without a key: edited rules never render a verdict; the off notice shows and nothing changes', async () => {
    const { engine, calls, announced } = setup();
    engine.setHealth('off', null);
    engine.setRules(EDITED);
    expect(engine.run()).toBe('blocked');
    expect(calls).toHaveLength(0);
    const s = engine.getState();
    expect(s.phase).toBe('idle');
    expect(s.run).toBeNull();
    expect(s.notes[0]?.text).toBe(liveBlockCopy('off', { date: '', time: '' }));
    expect(announced.at(-1)).toBe(s.notes[0]?.text);
    engine.recordedRun();
    expect(engine.runLive()).toBe(false);
    expect(engine.applyAdd()).toBe(false);
    expect(engine.getState().rules).toBe(EDITED);
    expect(calls).toHaveLength(0);
  });

  it('a 503 before any event puts back the last real result and says why', async () => {
    const { engine, calls } = setup();
    engine.run();
    engine.setRules(EDITED);
    expect(engine.getState().stale).toBe(true);
    expect(engine.run()).toBe('live');
    expect(engine.getState().phase).toBe('running');
    expect(ASK_IDS.every((id) => displaysOf(engine.getState()).map[id].display === 'checking')).toBe(true);
    await flush();
    const s = engine.getState();
    expect(calls).toEqual([{ rules: EDITED }]);
    expect(s.phase).toBe('done');
    expect(s.run?.source).toBe('authored');
    expect(s.stale).toBe(true);
    expect(s.env.health).toBe('off');
    expect(s.notes.map((n) => n.key)).toEqual(['degraded']);
  });

  it('streams one event at a time: CHECKING rows resolve in place, then one re-sort and one announcement', async () => {
    let emit: ((e: TryEvent) => void) | null = null;
    let finish: ((r: PostSseResult) => void) | null = null;
    const { engine, announced, storage } = setup(
      (e) =>
        new Promise<PostSseResult>((resolve) => {
          emit = e;
          finish = resolve;
        }),
    );
    engine.setRules(EDITED);
    engine.run();
    expect(announced).toEqual(['Checking 12 asks']);
    const go = emit as unknown as (e: TryEvent) => void;
    go(plan());
    go(gate('a02', 0));
    let s = engine.getState();
    expect(s.run?.id).toBe('r_live1');
    expect(displaysOf(s).map.a02.display).toBe('decline');
    expect(displaysOf(s).map.a01.display).toBe('checking');
    expect(s.flash.a02).toBe(1);
    expect(s.order).toEqual([...ASK_IDS]);
    ASK_IDS.filter((id) => id !== 'a02').forEach((id, i) => go(gate(id, i + 1)));
    go(done());
    (finish as unknown as (r: PostSseResult) => void)({ ok: true, completed: true, status: 200 });
    await flush();
    s = engine.getState();
    expect(s.phase).toBe('done');
    expect(s.run?.source).toBe('live');
    expect(s.run?.wall_ms).toBe(2300);
    expect(s.run?.cost_usd).toBe(0.0019);
    expect(s.order.slice(0, 4)).toEqual(['a01', 'a03', 'a06', 'a09']);
    expect(announced.filter((m) => m.includes('checked:'))).toHaveLength(1);
    expect(storage.run?.source).toBe('live');
  });

  it('renders the right final state when every event arrives in one chunk', async () => {
    const { engine } = setup(fullStream);
    engine.setRules(EDITED);
    engine.run();
    await flush();
    const s = engine.getState();
    expect(s.phase).toBe('done');
    expect(s.pending).toEqual([]);
    const c = countDisplays(displaysOf(s).map);
    expect([c.reach, c.held, c.ask, c.declined, c.notChecked]).toEqual([2, 1, 1, 8, 0]);
  });

  it('a lost stream keeps what arrived and re-requests only the missing ask ids', async () => {
    const firstSeven = ASK_IDS.slice(0, 7);
    let n = 0;
    const { engine, calls } = setup((emit, body) => {
      n++;
      if (n === 1) {
        emit(plan());
        firstSeven.forEach((id, i) => emit(gate(id, i)));
        return { ok: true, completed: false, status: 200 };
      }
      emit(plan(body.ask_ids));
      (body.ask_ids ?? []).forEach((id, i) => emit(gate(id, i)));
      emit(done(1200, 0.0008));
      return { ok: true, completed: true, status: 200 };
    });
    engine.setRules(EDITED);
    engine.run();
    await flush();
    let s = engine.getState();
    expect(s.phase).toBe('done');
    expect(s.notes.find((x) => x.key === 'lost')).toMatchObject({ text: 'Lost the connection after 7 of 12.', actionLabel: 'Retry the other 5' });
    expect(countDisplays(displaysOf(s).map).notChecked).toBe(5);
    expect(engine.retryLost()).toBe(true);
    expect(calls[1]).toEqual({ rules: EDITED, ask_ids: ['a08', 'a09', 'a10', 'a11', 'a12'] });
    await flush();
    s = engine.getState();
    expect(s.notes.find((x) => x.key === 'lost')).toBeUndefined();
    expect(countDisplays(displaysOf(s).map).checked).toBe(12);
    expect(s.run?.id).toBe('r_live1');
  });

  it('a timed-out gate is NOT CHECKED (never an accept) and Retry asks for that row only', async () => {
    let n = 0;
    const { engine, calls } = setup((emit, body) => {
      n++;
      emit(plan(body.ask_ids ?? ASK_IDS));
      for (const [i, id] of (body.ask_ids ?? ASK_IDS).entries()) {
        if (n === 1 && id === 'a09') emit({ event: 'error', data: { i: 8, ask_id: 'a09', kind: 'timeout' } });
        else emit(gate(id, i));
      }
      emit(done());
      return { ok: true, completed: true, status: 200 };
    });
    engine.setRules(EDITED);
    engine.run();
    await flush();
    let m = displaysOf(engine.getState()).map;
    expect(m.a09.display).toBe('failed');
    expect(countDisplays(m)).toMatchObject({ checked: 11, notChecked: 1, reach: 2, held: 0 });
    expect(engine.retryOne('a09')).toBe(true);
    expect(calls[1]).toEqual({ rules: EDITED, ask_ids: ['a09'] });
    await flush();
    m = displaysOf(engine.getState()).map;
    expect(m.a09.display).toBe('held');
  });

  it('a run-level budget error stops the waiting gates and pauses live checks', async () => {
    const { engine } = setup((emit) => {
      emit(plan());
      emit(gate('a01', 0));
      emit({ event: 'error', data: { kind: 'budget' } });
      emit(done(800, null));
      return { ok: true, completed: true, status: 200 };
    });
    engine.setRules(EDITED);
    engine.run();
    await flush();
    const s = engine.getState();
    const c = countDisplays(displaysOf(s).map);
    expect(c.failed).toBe(11);
    expect(c.reach).toBe(1);
    expect(s.env.health).toBe('budget');
    expect(s.notes.find((x) => x.key === 'degraded')?.text).toBe('Live checks are paused until next month. Your rules stay in this tab.');
    expect(engine.runLive()).toBe(false);
  });

  it('429: the limited notice names the next live run; presets still run', async () => {
    const { engine, calls } = setup(() => ({ ok: false, status: 429, body: { error: 'rate_limited', retry_at: '2026-11-09T18:42:00Z' } }));
    engine.setRules(EDITED);
    engine.run();
    await flush();
    const s = engine.getState();
    expect(s.env.limitedUntil).toBe(Date.parse('2026-11-09T18:42:00Z'));
    expect(s.notes[0]?.text).toMatch(/^You ran 20 live checks in 10 minutes\. The next live run is at \d\d:\d\d\. Presets are unlimited\.$/);
    expect(engine.run()).toBe('blocked');
    expect(calls).toHaveLength(1);
    engine.usePreset('engineer');
    expect(engine.run()).toBe('recorded');
  });

  it('400 and network failures before any event show their own notice', async () => {
    const bad = setup(() => ({ ok: false, status: 400, body: { error: 'invalid_rules', message: 'Rules must be 1 to 1,000 characters.' } }));
    bad.engine.setRules(EDITED);
    bad.engine.run();
    await flush();
    expect(bad.engine.getState().notes[0]).toMatchObject({ kind: 'error', text: 'Rules must be 1 to 1,000 characters.' });
    const down = setup(() => ({ ok: false, status: 0, offline: true }));
    down.engine.setRules(EDITED);
    down.engine.run();
    await flush();
    expect(down.engine.getState().notes[0]?.text).toBe('The live check couldn’t reach the server. Your rules stay in this tab.');
    expect(down.engine.getState().phase).toBe('idle');
  });

  it('done with rows missing is treated as a lost stream', async () => {
    const { engine } = setup((emit) => {
      emit(plan());
      ASK_IDS.slice(0, 10).forEach((id, i) => emit(gate(id, i)));
      emit(done());
      return { ok: true, completed: true, status: 200 };
    });
    engine.setRules(EDITED);
    engine.run();
    await flush();
    expect(engine.getState().notes.find((n) => n.key === 'lost')?.text).toBe('Lost the connection after 10 of 12.');
  });

  it('says “Still checking” after 4 s and gives up on a silent stream after 25 s', async () => {
    vi.useFakeTimers();
    const { engine, tick } = setup(
      (emit, _b, signal) =>
        new Promise<PostSseResult>((resolve) => {
          emit(plan());
          emit(gate('a01', 0));
          signal.addEventListener('abort', () => resolve({ ok: false, status: 0, aborted: true }));
        }),
    );
    engine.setRules(EDITED);
    engine.run();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(engine.getState().slowNote).toBe(true);
    tick(25_000);
    await vi.advanceTimersByTimeAsync(21_000);
    const s = engine.getState();
    expect(s.phase).toBe('done');
    expect(s.notes.find((n) => n.key === 'lost')?.text).toBe('Lost the connection after 1 of 12.');
    expect(s.slowNote).toBe(false);
  });

  it('a client-side quote check backs the server: a quote marked not found is a decline by code', async () => {
    const { engine } = setup((emit) => {
      emit(plan());
      ASK_IDS.forEach((id, i) =>
        emit(id === 'a01' ? gate(id, i, { cited: [{ text: 'Happy to take any intro', found: false }], decided_by: 'gate', verdict: 'accept' }) : gate(id, i)),
      );
      emit(done());
      return { ok: true, completed: true, status: 200 };
    });
    engine.setRules(EDITED);
    engine.run();
    await flush();
    expect(displaysOf(engine.getState()).map.a01.display).toBe('code');
  });
});

describe('presets, rules, stale', () => {
  it('editing unselects the preset; switching asks first; Keep mine keeps the text', () => {
    const { engine } = setup();
    engine.setRules(`${ENGINEER} `);
    expect(isEdited(engine.getState())).toBe(true);
    engine.selectPreset('health');
    expect(engine.getState().pendingPreset).toBe('health');
    engine.keepMine();
    expect(engine.getState().pendingPreset).toBeNull();
    expect(engine.getState().rules).toBe(`${ENGINEER} `);
    engine.selectPreset('founder');
    expect(engine.replace()).toBe('founder');
    expect(engine.getState().rules).toBe(presetById('founder').rules);
    expect(isEdited(engine.getState())).toBe(false);
  });

  it('editing after a run marks rows stale (never dimmed) and makes Run again the black pill', () => {
    const { engine } = setup();
    engine.run();
    expect(engine.getState().ctaBlack).toBe(false);
    engine.setRules(EDITED);
    let s = engine.getState();
    expect(s.stale).toBe(true);
    expect(s.ctaBlack).toBe(true);
    expect(s.view).toBe('edit');
    engine.setRules(ENGINEER);
    s = engine.getState();
    expect(s.stale).toBe(false);
  });

  it('empty and too-long rules disable Run', () => {
    const { engine } = setup();
    engine.setRules('   ');
    expect(engine.run()).toBeNull();
    engine.setRules('x'.repeat(1001));
    expect(engine.run()).toBeNull();
  });
});

describe('Try a change', () => {
  it('Cap 2 → 1 is recomputed here with no model call; Undo puts it back', () => {
    const { engine, calls, announced } = setup();
    engine.run();
    expect(engine.applyCapEdit()).toBe(true);
    let s = engine.getState();
    expect(calls).toHaveLength(0);
    expect(s.cap).toBe(1);
    expect(s.capNote).toBe('Cap changed to 1. Applied in code, no model call.');
    expect(s.diff).toBe('1 changed since your last run: Tallow AI.');
    expect(s.changed).toEqual({ a03: 'reach' });
    expect(announced.at(-1)).toBe('Cap changed to 1. Applied in code, no model call. 1 verdict changed.');
    engine.undoApplied();
    s = engine.getState();
    expect(s.cap).toBe(2);
    expect(s.applied).toBeNull();
  });

  it('Test the quote check: a labelled fake output through the real clause finder; Undo restores; never on a live run', async () => {
    const { engine, storage } = setup(fullStream);
    engine.run();
    expect(engine.applyQuoteTest()).toBe(true);
    let s = engine.getState();
    const m = displaysOf(s).map;
    expect(m.a11.display).toBe('code');
    expect(m.a11.gate?.source).toBe('test');
    expect(s.changed).toEqual({ a11: 'decline' });
    engine.save();
    expect((storage.saved.at(-1) as PlaygroundStore).results.find((r) => r.ask_id === 'a11')?.display).toBe('decline');
    engine.undoApplied();
    expect(displaysOf(engine.getState()).map.a11.display).toBe('decline');
    engine.runLive();
    await flush();
    s = engine.getState();
    expect(s.run?.source).toBe('live');
    expect(engine.applyQuoteTest()).toBe(false);
  });

  it('+ No asks from health companies. reruns live with the line; a refusal undoes the edit', async () => {
    const { engine, calls } = setup();
    engine.run();
    expect(engine.applyAdd()).toBe(true);
    expect(calls[0]).toEqual({ rules: `${ENGINEER}\nNo asks from health companies.` });
    await flush();
    const s = engine.getState();
    expect(s.rules).toBe(ENGINEER);
    expect(s.applied).toBeNull();
    expect(s.run?.source).toBe('authored');
    expect(s.notes[0]?.key).toBe('degraded');
  });
});

describe('marks and storage', () => {
  it('Disagree marks persist with the run id and drop for rows that changed', () => {
    const { engine, storage } = setup();
    engine.run();
    engine.toggleMark('a08');
    let saved = storage.saved.at(-1) as PlaygroundStore;
    expect(saved.marks).toEqual(['a08']);
    expect(saved.run_id).toBe(engine.getState().run?.id);
    engine.applyCapEdit();
    engine.toggleMark('a08');
    saved = storage.saved.at(-1) as PlaygroundStore;
    expect(saved.marks).toEqual([]);
  });

  it('a refresh restores rules, cap, the recorded run and marks; edited rules restore as stale', () => {
    const storage = memoryStorage();
    const first = setup(undefined, storage);
    first.engine.run();
    first.engine.toggleMark('a12');
    first.engine.setRules(EDITED);
    first.engine.save();
    const second = setup(undefined, storage);
    second.engine.boot({ qaState: null, degraded: null, preset: null, offline: false });
    const s = second.engine.getState();
    expect(s.rules).toBe(EDITED);
    expect(s.run?.rules).toBe(ENGINEER);
    expect(s.stale).toBe(true);
    expect(s.marks).toEqual(['a12']);
  });

  it('a live run restores exactly from this tab, never by calling the model again', async () => {
    const storage = memoryStorage();
    const first = setup(fullStream, storage);
    first.engine.setRules(EDITED);
    first.engine.run();
    await flush();
    const second = setup(undefined, storage);
    second.engine.boot({ qaState: null, degraded: null, preset: null, offline: false });
    const s = second.engine.getState();
    expect(second.calls).toHaveLength(0);
    expect(s.run?.source).toBe('live');
    expect(s.run?.id).toBe('r_live1');
    expect(s.stale).toBe(false);
    expect(countDisplays(displaysOf(s).map).reach).toBe(2);
  });
});

describe('QA states (prototype names)', () => {
  it('every state applies without a network call and nothing is stored', () => {
    for (const state of QA_STATES.playground) {
      const { engine, calls, storage } = setup();
      engine.boot({ qaState: state, degraded: null, preset: null, offline: false });
      applyQaState(engine, state);
      expect(calls).toHaveLength(0);
      expect(storage.saved).toHaveLength(0);
    }
  });

  const at = (state: (typeof QA_STATES.playground)[number]) => {
    const { engine } = setup();
    engine.boot({ qaState: state, degraded: null, preset: null, offline: false });
    applyQaState(engine, state);
    const s = engine.getState();
    return { s, c: countDisplays(displaysOf(s).map), map: displaysOf(s).map };
  };

  it('fixture runs are labelled and carry no timing', () => {
    const { s } = at('done-live');
    expect(s.run?.source).toBe('fixture');
    expect(Object.values(s.run?.gates ?? {}).every((g) => g?.ms === null && g?.confidence === null)).toBe(true);
  });

  it('the states show what the spec says', () => {
    expect(at('running').s.phase).toBe('running');
    expect(at('running').c.checking).toBe(5);
    expect(at('rerun-changed').s.diff).toBe('1 changed since your last run: Wrenby Health.');
    expect(at('rerun-nochange').s.diff).toBe('No verdict changed. That line did not decide any of these 12 asks.');
    expect(at('stale').s.stale).toBe(true);
    expect(at('cap-changed').s.capNote).toBe('Cap changed to 1. Applied in code, no model call.');
    expect(at('partial-timeout').c).toMatchObject({ checked: 11, notChecked: 1 });
    const cc = at('clause-check');
    expect(cc.map.a11.display).toBe('code');
    expect(cc.s.open).toBe('a11');
    expect(at('marks').s.marks).toEqual(['a08']);
    expect(at('empty-rules').s.rules).toBe('');
    expect(at('too-long').s.rules.length).toBe(1040);
    expect(at('all-declined').c.declined).toBe(12);
    expect(at('all-accepted').c).toMatchObject({ reach: 2, held: 10 });
    expect(at('rate-limited').s.notes[0]?.text).toBe('You ran 20 live checks in 10 minutes. The next live run is at 10:42. Presets are unlimited.');
    expect(at('api-down').s.env.qa).toBe('down');
    expect(at('budget').s.env.qa).toBe('budget');
    expect(at('offline').s.env.qa).toBe('offline');
    expect(at('lost-stream').s.notes.find((n) => n.key === 'lost')?.text).toBe('Lost the connection after 7 of 12.');
  });
});
