import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/try/route';
import { AUTHORED_VERDICTS } from '@/lib/sample/verdicts';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import { PRESETS } from '@/lib/sample/presets';
import { __resetBudgetForTests } from '@/lib/server/budget';
import { __setGateTimingForTests, RULES_EMPTY_COPY, RULES_TOO_LONG_COPY, startTry } from '@/lib/server/gate';
import { __setModelFetchForTests } from '@/lib/server/live';
import { __setRateLimitDbForTests } from '@/lib/server/ratelimit';
import { readSse } from '@/lib/sse';
import type { TryDoneEvent, TryErrorEvent, TryEvent, TryGateEvent } from '@/lib/types';
import { apiError, fakeFetch, message, verdict, type FakeRequest, type Responder } from './fake-api';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

const ENGINEER = PRESETS.find((p) => p.id === 'engineer')!.rules;
const CUSTOM = ['Happy to talk to founders about Postgres at scale.', 'Only with real numbers.', 'No asks to review a deck.'].join('\n');

type Received = TryEvent & { id: string | null };

function post(body: unknown, init: { signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<Response> {
  return POST(
    new Request('http://localhost:3200/api/try', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...(init.headers ?? {}) },
      body: JSON.stringify(body),
      signal: init.signal,
    }),
  );
}

async function events(res: Response): Promise<Received[]> {
  const out: Received[] = [];
  await readSse<TryEvent>(res, (e, id) => out.push({ ...e, id } as Received));
  return out;
}

function askIdOf(req: FakeRequest): string {
  const content = (req.body.messages as { content: string }[])[0]!.content;
  const data = JSON.parse(content.slice(content.indexOf('{'))) as { text: string };
  return SAMPLE_ASKS.find((a) => a.text === data.text)!.id;
}

/** Every row resolves exactly once; the run starts with plan and ends with done; ids count up from 1. */
function expectWellFormed(evs: Received[], rows: number) {
  expect(evs[0]!.event).toBe('plan');
  expect(evs[evs.length - 1]!.event).toBe('done');
  expect(evs.map((e) => e.id)).toEqual(evs.map((_, n) => String(n + 1)));
  const resolved = evs.filter((e) => (e.event === 'gate' || e.event === 'error') && typeof (e.data as { i?: number }).i === 'number').map((e) => (e.data as { i: number }).i);
  expect(new Set(resolved).size).toBe(resolved.length);
  expect(resolved).toHaveLength(rows);
}

let api: ReturnType<typeof fakeFetch>;

beforeEach(() => {
  __resetBudgetForTests();
  __setRateLimitDbForTests(null);
});
afterEach(() => {
  __setModelFetchForTests(null);
  __setGateTimingForTests();
  __setRateLimitDbForTests(null);
  __resetBudgetForTests();
});

describe('POST /api/try: input', () => {
  it('answers 400 with the designed copy before streaming', async () => {
    const empty = await post({ rules: '  \n ' });
    expect(empty.status).toBe(400);
    expect(empty.headers.get('cache-control')).toBe('no-store');
    expect(await empty.json()).toEqual({ error: 'invalid_rules', message: RULES_EMPTY_COPY });
    const long = await post({ rules: 'x'.repeat(1001) });
    expect(await long.json()).toEqual({ error: 'invalid_rules', message: RULES_TOO_LONG_COPY });
    expect((await post({ rules: CUSTOM, ask_ids: ['a99'] })).status).toBe(400);
    expect((await post({ rules: CUSTOM, ask_ids: [] })).status).toBe(400);
    expect((await post({ rules: 5 })).status).toBe(400);
    const notJson = await POST(new Request('http://localhost/api/try', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ rules: CUSTOM }) }));
    expect(notJson.status).toBe(400);
  });
});

describe('POST /api/try without a key', () => {
  it('custom rules: 503 live_unavailable with live off (never a fake verdict)', async () => {
    const res = await post({ rules: CUSTOM });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'live_unavailable', live: 'off', until: null });
  });

  it('“Run live” on an unedited preset gets the 503 too (only live verdicts stream by default)', async () => {
    for (const body of [{ rules: ENGINEER }, { rules: ENGINEER, mode: 'live' }]) {
      const res = await post(body);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'live_unavailable', live: 'off', until: null });
    }
  });

  it('mode auto: an unedited preset streams its recorded file, labelled by its real source', async () => {
    const res = await post({ rules: ENGINEER, mode: 'auto' });
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const evs = await events(res);
    expectWellFormed(evs, 12);
    const plan = evs[0]!.data as { mode: string; recorded_at?: string; rules_chars: number };
    expect(plan).toMatchObject({ mode: 'recorded', rules_chars: ENGINEER.length });
    expect(plan.recorded_at).toBeTruthy();
    const gates = evs.filter((e) => e.event === 'gate').map((e) => e.data as TryGateEvent);
    expect(gates).toHaveLength(12);
    for (const g of gates) {
      expect(g.source).toBe('authored');
      expect(g.ms).toBeNull();
      expect(g.confidence).toBeNull();
    }
    expect(gates.map((g) => g.verdict)).toEqual(AUTHORED_VERDICTS.engineer.map((v) => v.verdict));
    const done = evs[evs.length - 1]!.data as TryDoneEvent;
    expect(done.cost_usd).toBeNull();
    expect(done.wall_ms).toBe(0);
    expect(done.counts).toEqual({ accept: 3, decline: 8, ask_back: 1, failed: 0 });
  });

  it('retrying missing rows of a preset returns only those rows, at their own indices', async () => {
    const evs = await events(await post({ rules: ENGINEER, ask_ids: ['a12', 'a03'], mode: 'recorded' }));
    expectWellFormed(evs, 2);
    expect((evs[0]!.data as { gates: unknown[] }).gates).toEqual([
      { i: 2, ask_id: 'a03' },
      { i: 11, ask_id: 'a12' },
    ]);
  });
});

describe('POST /api/try live (fake API)', () => {
  /** a01 accepts, a06 asks, a05 is overloaded, a07 is refused, a09 doesn't parse, the rest decline. */
  const responder: Responder = (req) => {
    const id = askIdOf(req);
    if (id === 'a01') return verdict({ verdict: 'accept', cited: ['founders about Postgres at scale', 'Only with real numbers.'], reason: 'Postgres at 40M rows with a 900 ms p95.' });
    if (id === 'a06') return verdict({ verdict: 'ask_back', cited: ['founders about Postgres at scale'], reason_code: 'proof', question: { type: 'metric', text: 'How many jobs a day do you run?' } });
    if (id === 'a05') return apiError(529, 'overloaded_error', 'Overloaded.', { 'retry-after-ms': '5' });
    if (id === 'a07') return message('', { stop_reason: 'refusal' });
    if (id === 'a09') return message('not json at all');
    if (id === 'a12') return verdict({ verdict: 'decline', cited: ['No asks to review a deck.'], reason_code: 'rule_says_no' });
    return verdict({ verdict: 'decline', reason: 'No line in your rules covers this ask.' });
  };

  beforeEach(() => {
    api = fakeFetch(responder);
    __setModelFetchForTests(api.fetch);
  });

  it('streams plan, one gate or error per ask in completion order, then done', async () => {
    const res = await post({ rules: CUSTOM });
    expect(res.status).toBe(200);
    const evs = await events(res);
    expectWellFormed(evs, 12);
    const plan = evs[0]!.data as { mode: string; run_id: string; gates: { i: number; ask_id: string }[]; rules_chars: number };
    expect(plan.mode).toBe('live');
    expect(plan.run_id).toMatch(/^r_/);
    expect(plan.rules_chars).toBe(CUSTOM.length);
    expect(plan.gates).toEqual(SAMPLE_ASKS.map((a, i) => ({ i, ask_id: a.id })));

    const byAsk = new Map(evs.slice(1, -1).map((e) => [(e.data as { ask_id: string }).ask_id, e]));
    const a01 = byAsk.get('a01')!;
    expect(a01.event).toBe('gate');
    expect(a01.data).toMatchObject({ i: 0, verdict: 'accept', decided_by: 'gate', source: 'live' });
    expect(typeof (a01.data as TryGateEvent).ms).toBe('number');
    for (const c of (a01.data as TryGateEvent).cited) expect(CUSTOM.slice(c.start!, c.end!)).toBe(c.text);
    expect(byAsk.get('a06')!.data).toMatchObject({ verdict: 'ask_back', question: { type: 'metric', text: 'How many jobs a day do you run?' } });
    expect(byAsk.get('a05')).toMatchObject({ event: 'error', data: { i: 4, ask_id: 'a05', kind: 'overloaded' } });
    expect(byAsk.get('a07')).toMatchObject({ event: 'error', data: { kind: 'refused' } });
    expect(byAsk.get('a09')).toMatchObject({ event: 'error', data: { kind: 'parse' } });

    const done = evs[evs.length - 1]!.data as TryDoneEvent;
    // refused and parse count as declines (declined by code); only a05 is not checked.
    expect(done.counts).toEqual({ accept: 1, ask_back: 1, decline: 9, failed: 1 });
    expect(done.wall_ms).toBeGreaterThanOrEqual(0);
    expect(done.cost_usd).toBeGreaterThan(0);
  });

  it('an unedited preset runs live when live calls can run (the playground’s “Run live”)', async () => {
    const evs = await events(await post({ rules: ENGINEER }));
    expect((evs[0]!.data as { mode: string }).mode).toBe('live');
    expect(api.requests.length).toBeGreaterThanOrEqual(12);
  });

  it('mode recorded serves the preset’s file with no model call', async () => {
    const evs = await events(await post({ rules: ENGINEER, mode: 'recorded' }));
    expect((evs[0]!.data as { mode: string }).mode).toBe('recorded');
    expect(api.requests).toHaveLength(0);
  });

  it('rate limited: custom rules get 429 with retry_at and Retry-After; presets stay unlimited', async () => {
    const retry_at = new Date(Date.now() + 120_000).toISOString();
    __setRateLimitDbForTests(async () => ({ ok: false, retry_at, limit: 20, window_s: 600 }));
    const res = await post({ rules: CUSTOM });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited', retry_at });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(100);
    const preset = await events(await post({ rules: ENGINEER, mode: 'auto' }));
    expect((preset[0]!.data as { mode: string }).mode).toBe('recorded');
    const strict = await post({ rules: ENGINEER });
    expect(strict.status).toBe(429);
    expect(api.requests).toHaveLength(0);
  });

  it('a budget stop mid-run ends the run: one run-level error, every unresolved row as budget, then done', async () => {
    api = fakeFetch((req, signal) => {
      if (askIdOf(req) === 'a03') return apiError(429, 'rate_limit_error', 'Spend limit reached.', {}, { error_code: 'enforced_spend_limit_reached' });
      return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    __setModelFetchForTests(api.fetch);
    const evs = await events(await post({ rules: CUSTOM }));
    expect(evs[0]!.event).toBe('plan');
    expect(evs[evs.length - 1]!.event).toBe('done');
    const runLevel = evs.filter((e) => e.event === 'error' && (e.data as TryErrorEvent).i === undefined);
    expect(runLevel).toEqual([expect.objectContaining({ event: 'error', data: { kind: 'budget' } })]);
    const rows = evs.filter((e) => e.event === 'error' && (e.data as TryErrorEvent).i !== undefined).map((e) => e.data as TryErrorEvent);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.kind === 'budget')).toBe(true);
    expect((evs[evs.length - 1]!.data as TryDoneEvent).counts).toEqual({ accept: 0, decline: 0, ask_back: 0, failed: 12 });
    // The next request sees the pause: custom rules 503 budget, presets keep their recorded run.
    const next = await post({ rules: CUSTOM });
    expect(next.status).toBe(503);
    expect(await next.json()).toMatchObject({ error: 'live_unavailable', live: 'budget' });
  });

  it('a gate with no answer in 6 s is a timeout row; the others still resolve', async () => {
    __setGateTimingForTests({ gateTimeoutMs: 150 });
    api = fakeFetch((req, signal) => {
      if (askIdOf(req) === 'a04') return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      return verdict({ verdict: 'decline' });
    });
    __setModelFetchForTests(api.fetch);
    const evs = await events(await post({ rules: CUSTOM }));
    expectWellFormed(evs, 12);
    expect(evs.find((e) => (e.data as { ask_id?: string }).ask_id === 'a04')).toMatchObject({ event: 'error', data: { i: 3, kind: 'timeout' } });
    expect((evs[evs.length - 1]!.data as TryDoneEvent).counts).toEqual({ accept: 0, decline: 11, ask_back: 0, failed: 1 });
  });

  it('the hard stop keeps partial results: unresolved rows become timeouts and done still arrives', async () => {
    __setGateTimingForTests({ gateTimeoutMs: 10_000, hardStopMs: 200 });
    api = fakeFetch((req, signal) => {
      if (['a01', 'a02'].includes(askIdOf(req))) return verdict({ verdict: 'decline' });
      return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    __setModelFetchForTests(api.fetch);
    const t0 = Date.now();
    const evs = await events(await post({ rules: CUSTOM }));
    expect(Date.now() - t0).toBeLessThan(3_000);
    expectWellFormed(evs, 12);
    const done = evs[evs.length - 1]!.data as TryDoneEvent;
    expect(done.counts).toEqual({ accept: 0, decline: 2, ask_back: 0, failed: 10 });
  });

  it('when the visitor leaves, the in-flight model calls are aborted', async () => {
    let aborted = 0;
    api = fakeFetch((_req, signal) => new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => {
      aborted += 1;
      reject(new DOMException('aborted', 'AbortError'));
    })));
    __setModelFetchForTests(api.fetch);
    const controller = new AbortController();
    const res = await post({ rules: CUSTOM }, { signal: controller.signal });
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(': open');
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(api.requests.length).toBe(12);
    expect(aborted).toBe(12);
  });

  it('every event arriving in one chunk still parses to the same final state', async () => {
    const res = await post({ rules: CUSTOM });
    const text = await res.text();
    const evs = await events(new Response(text, { headers: { 'content-type': 'text/event-stream' } }));
    expectWellFormed(evs, 12);
  });
});

describe('startTry (the MCP tool calls it directly)', () => {
  it('validates, then returns events the receipt formatter can consume', async () => {
    expect(await startTry({ rules: '' }, { clientKey: null })).toEqual({ ok: false, status: 400, body: { error: 'invalid_rules', message: RULES_EMPTY_COPY } });
    const start = await startTry({ rules: ENGINEER, mode: 'recorded' } as Parameters<typeof startTry>[0], { clientKey: null });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const all: TryEvent[] = [];
    for await (const e of start.events) all.push(e);
    expect(all[0]!.event).toBe('plan');
    expect(all.filter((e) => e.event === 'gate')).toHaveLength(12);
    expect(all[all.length - 1]!.event).toBe('done');
  });
});
