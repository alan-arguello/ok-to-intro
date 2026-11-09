import { describe, expect, it, vi } from 'vitest';
import { POST as createAsk } from '@/app/api/asks/route';
import { GET as getAsk } from '@/app/api/asks/[id]/route';
import { POST as send } from '@/app/api/asks/[id]/send/route';
import { POST as answer } from '@/app/api/asks/[id]/answer/route';
import { POST as withdraw } from '@/app/api/asks/[id]/withdraw/route';
import { POST as resolve } from '@/app/api/asks/[id]/resolve/route';
import { POST as sample } from '@/app/api/asks/sample/route';
import { POST as sampleAnswer } from '@/app/api/asks/sample/answer/route';
import { GET as daily } from '@/app/api/cron/daily/route';
import { GET as warm } from '@/app/api/cron/warm/route';
import { GET as pauseLink, POST as pause } from '@/app/api/pause/route';
import { assembleAskText } from '@/lib/oti/ask';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { readSse } from '@/lib/sse';
import type { CompiledAsk, FanoutEvent } from '@/lib/types';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

/**
 * This instance has no keys at all (no Supabase, no model, no Resend, no cron secret): every REAL route answers its
 * designed “not set up on this instance” state, and the SAMPLE network still works end to end.
 */

const ORIGIN = 'http://localhost:3200';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, host: 'localhost:3200', ...headers }, body: JSON.stringify(body) });

const ENG = SAMPLE_NETWORK_ASKS.engineer;
const parts = { challenge: ENG.compiledPartial[0]!.text, tried: ENG.compiledPartial[1]!.text, needs: ENG.compiledPartial[2]!.text, by: 'Nov 21', offers: 'our load-test harness' };
const compiled: CompiledAsk = { parts, subject: ENG.subject, text: assembleAskText(ENG.partial, parts, ['needs', 'by', 'offers']), price: null, topic: null };

describe('REAL routes without keys', () => {
  it('say the real network is not set up, never “down”, and change nothing', async () => {
    const created = await createAsk(post('/api/asks', { text: ENG.partial, compiled, idempotency_key: 'k' }));
    expect(created.status).toBe(503);
    expect(await created.json()).toEqual({ error: 'not_configured', message: 'The real network isn’t set up on this instance. Nothing was sent to anyone.' });
    expect(created.headers.get('cache-control')).toBe('no-store');
    for (const [handler, path, body] of [
      [send, '/api/asks/a_91xQ2k/send', {}],
      [answer, '/api/asks/a_91xQ2k/answer', { question_id: 'q_1234', answer: 'x', idempotency_key: 'k' }],
      [withdraw, '/api/asks/a_91xQ2k/withdraw', { idempotency_key: 'k' }],
      [resolve, '/api/asks/a_91xQ2k/resolve', { solved: true, idempotency_key: 'k' }],
    ] as const) {
      const res = await handler(post(path, body), params('a_91xQ2k'));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'not_configured', message: 'The real network isn’t set up on this instance. Nothing was sent to anyone.' });
    }
    const view = await getAsk(new Request(`${ORIGIN}/api/asks/a_91xQ2k`), params('a_91xQ2k'));
    expect(view.status).toBe(503);
    expect(view.headers.get('cache-control')).toBe('private, no-store');
    expect(JSON.stringify(await view.json())).not.toMatch(/down|isn’t answering/);
  });

  it('refuse a cross-site POST before anything else', async () => {
    const res = await createAsk(post('/api/asks', {}, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'cross_origin' });
    const w = await withdraw(post('/api/asks/a_91xQ2k/withdraw', {}, { origin: 'https://evil.example' }), params('a_91xQ2k'));
    expect(w.status).toBe(403);
  });

  it('crons answer 503 without CRON_SECRET', async () => {
    const d = await daily(new Request(`${ORIGIN}/api/cron/daily`, { headers: { authorization: 'Bearer x' } }));
    expect(d.status).toBe(503);
    const w = await warm(new Request(`${ORIGIN}/api/cron/warm`));
    expect(w.status).toBe(503);
  });

  it('pause: one-click answers plain text, the /pause form answers 303 back to the page with the reason', async () => {
    const oneClick = await pause(
      new Request(`${ORIGIN}/api/pause?token=Tok0123456789abcdefghi`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }),
    );
    expect(oneClick.status).toBe(503);
    expect(oneClick.headers.get('content-type')).toMatch(/text\/plain/);
    const form = await pause(
      new Request(`${ORIGIN}/api/pause`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=Tok0123456789abcdefghi&until=2w' }),
    );
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toBe(`${ORIGIN}/pause/Tok0123456789abcdefghi?error=not_configured`);
    const bad = await pause(
      new Request(`${ORIGIN}/api/pause`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=Tok0123456789abcdefghi&until=forever' }),
    );
    expect(bad.headers.get('location')).toBe(`${ORIGIN}/pause/Tok0123456789abcdefghi?error=bad_input`);
    // A client that opens the List-Unsubscribe link (GET) lands on the page, which asks first: a GET changes nothing.
    const opened = await pauseLink(new Request(`${ORIGIN}/api/pause?token=Tok0123456789abcdefghi`));
    expect(opened.status).toBe(303);
    expect(opened.headers.get('location')).toBe(`${ORIGIN}/pause/Tok0123456789abcdefghi`);
  });
});

describe('the SAMPLE routes without keys', () => {
  it('POST /api/asks/sample streams the whole fan-out: plan, 40 cells, a question, the offer, done', async () => {
    const res = await sample(post('/api/asks/sample', { sample_ask_id: 'sa_eng', text: ENG.partial, compiled, you: null }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const events: FanoutEvent[] = [];
    const ids: (string | null)[] = [];
    await readSse<FanoutEvent>(res, (e, id) => (events.push(e), ids.push(id)));
    expect(events[0]?.event).toBe('plan');
    expect(events.filter((e) => e.event === 'cell')).toHaveLength(40);
    expect(events.filter((e) => e.event === 'offer')).toHaveLength(1);
    expect(events.at(-1)?.event).toBe('done');
    expect(ids.every((id) => id !== null)).toBe(true);
  });

  it('custom text is refused with the live-off copy before any stream; a bad body is a 400', async () => {
    const res = await sample(post('/api/asks/sample', { sample_ask_id: null, text: 'Our queue drops jobs. Tried retries.', compiled: { ...compiled, text: 'Our queue drops jobs. Tried retries.' }, you: null }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'live_unavailable', live: 'off' });
    const bad = await sample(post('/api/asks/sample', { nope: true }));
    expect(bad.status).toBe(400);
  });

  it('POST /api/asks/sample/answer reruns the gate that asked', async () => {
    const res = await sampleAnswer(post('/api/asks/sample/answer', { sample_ask_id: 'sa_eng', compiled, you: null, question: { type: 'role', text: 'Who on your team would join the call, and what is their role?' }, answer: 'Our CTO, who owns the events pipeline.' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reran: 1, accepted: 1, offer: null });
  });
});
