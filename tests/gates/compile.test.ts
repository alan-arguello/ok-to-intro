import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/compile/route';
import { YC_APPLICATION_REFUSAL } from '@/lib/oti/ask';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { __resetBudgetForTests } from '@/lib/server/budget';
import {
  __resetCompilerForTests,
  codeRefusal,
  createTopLevelScanner,
  normalizePart,
  normalizeSubject,
  normalizeTopic,
  startCompile,
  TEXT_EMPTY_COPY,
  TEXT_TOO_LONG_COPY,
  VAGUE_COPY,
} from '@/lib/server/compiler';
import { __setModelFetchForTests, getLiveState } from '@/lib/server/live';
import { __setRateLimitDbForTests } from '@/lib/server/ratelimit';
import { COMPILE_SCHEMA, COMPILER_PROMPT, PART_QUESTIONS } from '@/lib/server/rubric';
import { readSse } from '@/lib/sse';
import type { CompiledPart, CompileEvent } from '@/lib/types';
import { apiError, chunk, fakeFetch, sse, textStreamEvents } from './fake-api';

const ENG = SAMPLE_NETWORK_ASKS.engineer;
const PARTIAL = ENG.partial;

const GOOD = {
  decision: 'compile',
  challenge: { state: 'found', text: 'Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows', sources: ['Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows'] },
  tried: { state: 'found', text: 'monthly partitions and a read replica', sources: ['monthly partitions and a read replica'] },
  needs: { state: 'suggested', text: 'someone who has run Postgres past 100M rows', sources: ['writes still block', '40M rows'] },
  by: { state: 'missing', text: '', sources: [] },
  offers: { state: 'missing', text: '', sources: [] },
  subject: 'Postgres p95 at 40M rows, 20 min?',
  topic: 'Postgres at scale',
};

type Received = CompileEvent & { id: string | null; at: number };

function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  return POST(new Request('http://localhost:3200/api/compile', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.4' }, body: JSON.stringify(body), signal }));
}

async function events(res: Response): Promise<Received[]> {
  const out: Received[] = [];
  await readSse<CompileEvent>(res, (e, id) => out.push({ ...e, id, at: Date.now() } as Received));
  return out;
}

const streamOf = (json: unknown, opts: { size?: number; delayMs?: number; stop_reason?: string } = {}) => () =>
  sse(textStreamEvents(chunk(typeof json === 'string' ? json : JSON.stringify(json), opts.size ?? 7), { stop_reason: opts.stop_reason }), { delayMs: opts.delayMs });

let api: ReturnType<typeof fakeFetch>;

beforeEach(() => {
  __resetBudgetForTests();
  __resetCompilerForTests();
  __setRateLimitDbForTests(null);
});
afterEach(() => {
  __setModelFetchForTests(null);
  __resetCompilerForTests();
  __resetBudgetForTests();
});

describe('createTopLevelScanner', () => {
  const doc = JSON.stringify({ decision: 'compile', a: { s: 'x "quoted" {not a brace} [nor this]', n: [1, { z: '}' }] }, b: 'tail\\', c: 12.5, d: null, e: [] });
  const expected = Object.entries(JSON.parse(doc) as Record<string, unknown>).map(([k, v]) => [k, v]);

  it('emits each top-level value once, at every possible chunk split', () => {
    for (let cut = 0; cut <= doc.length; cut++) {
      const got: [string, unknown][] = [];
      const s = createTopLevelScanner((k, raw) => got.push([k, JSON.parse(raw)]));
      s.push(doc.slice(0, cut));
      s.push(doc.slice(cut));
      expect(got, `cut at ${cut}`).toEqual(expected);
    }
  });

  it('emits a value as soon as it is complete, character by character', () => {
    const got: string[] = [];
    const s = createTopLevelScanner((k) => got.push(k));
    const stop = doc.indexOf('"b"');
    for (const ch of doc.slice(0, stop)) s.push(ch);
    expect(got).toEqual(['decision', 'a']);
    for (const ch of doc.slice(stop)) s.push(ch);
    expect(got).toEqual(['decision', 'a', 'b', 'c', 'd', 'e']);
  });
});

describe('code refusals (no model call, with or without a key)', () => {
  it('refuses asks about YC applications and the vague samples', () => {
    expect(codeRefusal('Need 20 minutes with a YC alum to review our YC application before the batch deadline.')).toBe('yc_application');
    for (const s of Object.values(SAMPLE_NETWORK_ASKS)) expect(codeRefusal(s.vague)).toBe('vague');
    expect(codeRefusal('  need   INTROS to hospital buyers in mexico. ')).toBe('vague');
    expect(codeRefusal('Help with fundraising')).toBe('vague');
    expect(codeRefusal(PARTIAL)).toBeNull();
    expect(codeRefusal(ENG.complete)).toBeNull();
  });

  it('streams plan then refused with the exact copy, without a key', async () => {
    const yc = await events(await post({ text: 'We want a YC alum to do a mock interview before our batch interview.', network: 'sample' }));
    expect(yc.map((e) => e.event)).toEqual(['plan', 'refused']);
    expect(yc[1]!.data).toEqual({ kind: 'yc_application', message: YC_APPLICATION_REFUSAL });
    const vague = await events(await post({ text: ENG.vague, network: 'sample' }));
    expect(vague[1]!.data).toEqual({ kind: 'vague', message: VAGUE_COPY });
    expect(vague[0]!.data).toMatchObject({ network: 'sample', words: 11 });
  });
});

describe('POST /api/compile: input and availability', () => {
  it('400 before streaming, with copy', async () => {
    const empty = await post({ text: '   ', network: 'sample' });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'invalid_text', message: TEXT_EMPTY_COPY });
    expect(await (await post({ text: 'x'.repeat(601), network: 'sample' })).json()).toEqual({ error: 'invalid_text', message: TEXT_TOO_LONG_COPY });
    expect((await post({ network: 'sample' })).status).toBe(400);
  });

  it('503 live_unavailable without a key (the page shows the manual 5-part form)', async () => {
    const res = await post({ text: PARTIAL, network: 'sample' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'live_unavailable', live: 'off', until: null });
  });

  it('429 with retry_at when this address checked 20 asks in 10 minutes', async () => {
    __setModelFetchForTests(fakeFetch().fetch);
    const retry_at = new Date(Date.now() + 60_000).toISOString();
    __setRateLimitDbForTests(async () => ({ ok: false, retry_at, limit: 20, window_s: 600 }));
    const res = await post({ text: PARTIAL, network: 'sample' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited', retry_at });
    __setRateLimitDbForTests(null);
  });
});

describe('POST /api/compile live (fake streamed API)', () => {
  beforeEach(() => {
    api = fakeFetch();
    __setModelFetchForTests(api.fetch);
  });

  it('streams plan, each part as soon as it is complete, then done; facts are the founder’s own words', async () => {
    api.next(streamOf(GOOD, { size: 9, delayMs: 4 }));
    const evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    expect(evs.map((e) => e.event)).toEqual(['plan', 'part', 'part', 'part', 'part', 'part', 'done']);
    expect(evs.map((e) => e.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    const parts = evs.filter((e) => e.event === 'part').map((e) => e.data as { i: number; part: CompiledPart });
    expect(parts.map((p) => p.i)).toEqual([0, 1, 2, 3, 4]);
    expect(parts.map((p) => p.part.state)).toEqual(['found', 'found', 'suggested', 'missing', 'missing']);
    for (const p of parts) for (const s of p.part.source) expect(PARTIAL.slice(s.start!, s.end!)).toBe(s.text);
    expect(parts[0]!.part.text).toBe('Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows');
    expect(parts[2]!.part).toMatchObject({ key: 'needs', text: 'someone who has run Postgres past 100M rows' });
    expect(parts[2]!.part.source.map((s) => s.text)).toEqual(['writes still block', '40M rows']);
    expect(parts[3]!.part).toEqual({ key: 'by', state: 'missing', text: '', source: [], question: PART_QUESTIONS.by });
    // The first part arrives while the model is still writing (it streams; it doesn't wait for done).
    expect(evs[evs.length - 1]!.at - evs[1]!.at).toBeGreaterThan(40);
    const done = evs[evs.length - 1]!.data as { draft_id: string; subject: string; topic: string | null; parts: CompiledPart[]; ms: number };
    expect(done.draft_id).toBe((evs[0]!.data as { draft_id: string }).draft_id);
    expect(done.draft_id).toMatch(/^d_/);
    expect(done).toMatchObject({ subject: 'Postgres p95 at 40M rows, 20 min?', topic: 'Postgres at scale' });
    expect(done.parts.map((p) => p.key)).toEqual(['challenge', 'tried', 'needs', 'by', 'offers']);
  });

  it('sends Sonnet at low effort with its lowest thinking setting, the schema, and the text as JSON data', async () => {
    api.next(streamOf(GOOD));
    await events(await post({ text: PARTIAL, network: 'real' }));
    const req = api.requests[0]!;
    expect(req.url).toContain('/v1/messages');
    expect(req.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({ model: 'claude-sonnet-5-5', stream: true, thinking: { type: 'between_tools' }, fallbacks: 'default' });
    expect(req.body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: JSON.parse(JSON.stringify(COMPILE_SCHEMA)) } });
    expect((req.body.system as { text: string }[])[0]!.text).toBe(COMPILER_PROMPT);
    expect((req.body.messages as { content: string }[])[0]!.content).toContain(JSON.stringify(PARTIAL));
    for (const banned of ['temperature', 'top_p', 'top_k']) expect(req.body).not.toHaveProperty(banned);
  });

  it('never shows an invented fact: a “found” part not in the text, a suggested fact, an unsourced suggestion', async () => {
    api.next(
      streamOf({
        ...GOOD,
        tried: { state: 'found', text: 'sharding with Citus and 14 buyer calls', sources: [] },
        by: { state: 'suggested', text: 'Nov 30', sources: ['writes still block'] },
        offers: { state: 'suggested', text: 'our load-test harness', sources: ['writes still block'] },
        needs: { state: 'suggested', text: 'someone who has run Postgres past 100M rows', sources: ['a DBA with 100M-row experience'] },
      }),
    );
    const evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    const done = evs[evs.length - 1]!.data as { parts: CompiledPart[] };
    expect(done.parts.map((p) => p.state)).toEqual(['found', 'missing', 'missing', 'missing', 'missing']);
    expect(done.parts[1]).toEqual({ key: 'tried', state: 'missing', text: '', source: [], question: PART_QUESTIONS.tried });
  });

  it('the model’s own refusal decision streams as refused, and nothing after it', async () => {
    api.next(streamOf({ ...GOOD, decision: 'vague', subject: '', topic: '' }));
    const evs = await events(await post({ text: 'We need some help growing our company in new markets soon.', network: 'sample' }));
    expect(evs.map((e) => e.event)).toEqual(['plan', 'refused']);
    expect(evs[1]!.data).toEqual({ kind: 'vague', message: VAGUE_COPY });
  });

  it('a safety refusal, max_tokens and unparseable output are errors (the page falls back to the manual form)', async () => {
    api.next(
      () => sse(textStreamEvents([], { stop_reason: 'refusal' })),
      streamOf('{"decision":"compile","challenge":{"state":"fou', { stop_reason: 'max_tokens' }),
      streamOf('this is not json'),
    );
    for (const kind of ['refused', 'parse', 'parse']) {
      const evs = await events(await post({ text: PARTIAL, network: 'sample' }));
      expect(evs[evs.length - 1]).toMatchObject({ event: 'error', data: { kind } });
      expect(evs.some((e) => e.event === 'done')).toBe(false);
    }
  });

  it('times out at the deadline with error timeout', async () => {
    __resetCompilerForTests(150);
    api.next((_req, signal) => new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const t0 = Date.now();
    const evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    expect(evs.map((e) => e.event)).toEqual(['plan', 'error']);
    expect(evs[1]!.data).toEqual({ kind: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('rate limits, overloads and budget stops map to their error kinds', async () => {
    api.next(() => apiError(429, 'rate_limit_error', 'Slow down.', { 'retry-after': '9' }));
    let evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    expect(evs[1]!.data).toEqual({ kind: 'rate_limited', retry_after_s: 9 });
    api.next(() => apiError(529, 'overloaded_error', 'Overloaded.', { 'retry-after-ms': '5' }), () => apiError(529, 'overloaded_error', 'Overloaded.', { 'retry-after-ms': '5' }));
    evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    expect(evs[1]!.data).toEqual({ kind: 'overloaded' });
    api.next(() => apiError(429, 'rate_limit_error', 'Spend limit.', {}, { error_code: 'enforced_spend_limit_reached' }));
    evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    expect(evs[1]!.data).toEqual({ kind: 'budget' });
    expect((await getLiveState()).state).toBe('budget');
    expect((await post({ text: PARTIAL, network: 'sample' })).status).toBe(503);
  });

  it('when the API rejects the refusal-fallback beta, compiles without it from then on', async () => {
    api.next(() => apiError(400, 'invalid_request_error', 'Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.'), streamOf(GOOD), streamOf(GOOD));
    let evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    expect(evs[evs.length - 1]!.event).toBe('done');
    evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    expect(evs[evs.length - 1]!.event).toBe('done');
    expect(api.requests).toHaveLength(3);
    expect(api.requests[0]!.body.fallbacks).toBe('default');
    for (const r of api.requests.slice(1)) {
      expect(r.body).not.toHaveProperty('fallbacks');
      expect(r.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
    }
  });

  it('after a server-side fallback, the fallback model’s answer replaces the declined partial output', async () => {
    const partialFromFirst = chunk(JSON.stringify({ decision: 'compile', challenge: { state: 'found', text: 'Our Postgres p95', sources: [] } }).slice(0, 60), 10);
    api.next(() => sse(textStreamEvents(chunk(JSON.stringify(GOOD), 11), { fallbackFirst: partialFromFirst })));
    const evs = await events(await post({ text: PARTIAL, network: 'sample' }));
    const done = evs[evs.length - 1]!;
    expect(done.event).toBe('done');
    expect((done.data as { parts: CompiledPart[] }).parts[0]!.text).toBe('Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows');
  });

  it('startCompile serves MCP draft_ask the same events', async () => {
    api.next(streamOf(GOOD));
    const start = await startCompile({ text: PARTIAL, network: 'sample' }, { clientKey: null });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const kinds: string[] = [];
    for await (const e of start.events) kinds.push(e.event);
    expect(kinds).toEqual(['plan', 'part', 'part', 'part', 'part', 'part', 'done']);
  });
});

describe('part, subject and topic checks', () => {
  it('normalizePart widens a found span to whole words and drops trailing punctuation', () => {
    const p = normalizePart('tried', { state: 'found', text: 'onthly partitions and a read replica;', sources: [] }, PARTIAL);
    expect(p).toMatchObject({ state: 'found', text: 'monthly partitions and a read replica' });
    expect(PARTIAL.slice(p.source[0]!.start!, p.source[0]!.end!)).toBe(p.text);
  });

  it('normalizePart cuts a found span longer than 200 characters at a word, still the founder’s words', () => {
    const long = `${'word '.repeat(60)}end.`;
    const p = normalizePart('challenge', { state: 'found', text: long, sources: [] }, long);
    expect(p.state).toBe('found');
    expect(p.text.length).toBeLessThanOrEqual(200);
    expect(long.slice(p.source[0]!.start!, p.source[0]!.end!)).toBe(p.text);
  });

  it('normalizeSubject keeps the model’s subject when it fits and derives one from the challenge otherwise', () => {
    expect(normalizeSubject('Postgres p95 at 40M rows, 20 min?', null)).toBe('Postgres p95 at 40M rows, 20 min?');
    expect(normalizeSubject('Postgres p95 at 40M rows', null)).toBe('Postgres p95 at 40M rows, 20 min?');
    const derived = normalizeSubject('A subject that is far too long to fit in an inbox line, 20 min?', 'Our Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows');
    expect(derived.length).toBeLessThanOrEqual(45);
    expect(derived).toMatch(/^Postgres p95 went from 40 ms to 900.*, 20 min\?$/);
    expect(normalizeSubject('', null)).toBe('Your ask, 20 min?');
  });

  it('normalizeTopic is short and single-line, or null', () => {
    expect(normalizeTopic('  Hospital procurement,\nMexico. ')).toBe('Hospital procurement, Mexico');
    expect(normalizeTopic('')).toBeNull();
    expect(normalizeTopic(5)).toBeNull();
    expect(normalizeTopic('x '.repeat(80))!.length).toBeLessThanOrEqual(80);
  });
});
