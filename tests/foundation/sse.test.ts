import { describe, expect, it } from 'vitest';
import { createSseParser, encodeSseEvent, readSse, sseResponse, SSE_HEADERS, type SseEnvelope, type SseMessage } from '@/lib/sse';

type Ev = SseEnvelope<'plan' | 'gate' | 'done', unknown>;

const STREAM =
  encodeSseEvent('plan', { run_id: 'r_1', gates: [{ i: 0 }] }, 1) +
  ': ping\n\n' +
  encodeSseEvent('gate', { i: 0, reason: 'line one\nline two' }, 2) +
  encodeSseEvent('done', { counts: { accept: 1 } }, 3);

function parseAll(chunks: string[]): SseMessage[] {
  const out: SseMessage[] = [];
  const p = createSseParser((m) => out.push(m));
  for (const c of chunks) p.push(c);
  p.end();
  return out;
}

describe('SSE parser', () => {
  it('parses every event when they all arrive in one chunk', () => {
    const msgs = parseAll([STREAM]);
    expect(msgs.map((m) => [m.id, m.event])).toEqual([
      ['1', 'plan'],
      ['2', 'gate'],
      ['3', 'done'],
    ]);
    expect(JSON.parse(msgs[1]!.data)).toEqual({ i: 0, reason: 'line one\nline two' });
  });

  it('parses the same stream split at every possible byte boundary', () => {
    const whole = parseAll([STREAM]);
    for (let i = 1; i < STREAM.length; i++) expect(parseAll([STREAM.slice(0, i), STREAM.slice(i)])).toEqual(whole);
  });

  it('handles CRLF and CR line endings, multi-line data and comments', () => {
    const crlf = 'id: 7\r\nevent: gate\r\ndata: {"a":\r\ndata: 1}\r\n\r\n: ping\r\n\r\n';
    expect(parseAll([crlf])).toEqual([{ id: '7', event: 'gate', data: '{"a":\n1}' }]);
    const cr = 'event: done\rdata: {}\r\r';
    expect(parseAll([cr.slice(0, 13), cr.slice(13)])).toEqual([{ id: null, event: 'done', data: '{}' }]);
  });

  it('drops a final event without its blank line', () => {
    expect(parseAll(['event: plan\ndata: {}\n'])).toEqual([]);
  });
});

describe('sseResponse + readSse', () => {
  it('streams events with ids, the right headers, and closes when the work ends', async () => {
    const res = sseResponse<Ev>(null, async (sink) => {
      sink.send({ event: 'plan', data: { n: 1 } });
      await new Promise((r) => setTimeout(r, 5));
      sink.send({ event: 'done', data: { n: 2 } });
    });
    for (const [k, v] of Object.entries(SSE_HEADERS)) expect(res.headers.get(k)).toBe(v);
    const got: [string | null, string, unknown][] = [];
    const { completed } = await readSse<Ev>(res, (e, id) => got.push([id, e.event, e.data]));
    expect(completed).toBe(true);
    expect(got).toEqual([
      ['1', 'plan', { n: 1 }],
      ['2', 'done', { n: 2 }],
    ]);
  });

  it('sends pings while waiting and aborts the work when the client disconnects', async () => {
    let aborted = false;
    const req = new Request('http://localhost/x', { signal: AbortSignal.timeout(60) });
    const res = sseResponse<Ev>(
      req,
      async (sink) => {
        await new Promise<void>((resolve) => {
          sink.signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        });
      },
      { pingMs: 10 },
    );
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain(': open');
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(second).toContain(': ping');
    await new Promise((r) => setTimeout(r, 120));
    expect(aborted).toBe(true);
    await reader.cancel();
  });
});

describe('detachedEvents (REAL sends finish without the client)', () => {
  it('keeps working after the consumer leaves, and replays everything to a consumer that arrives late', async () => {
    const { detachedEvents } = await import('@/lib/sse');
    const persisted: number[] = [];
    const run = detachedEvents<number>(async (emit) => {
      for (let n = 1; n <= 5; n++) {
        await new Promise((r) => setTimeout(r, 5));
        persisted.push(n);
        emit(n);
      }
    });
    const seen: number[] = [];
    for await (const n of run.events) {
      seen.push(n);
      if (n === 2) break; // the client disconnected
    }
    await run.done;
    expect(seen).toEqual([1, 2]);
    expect(persisted).toEqual([1, 2, 3, 4, 5]);
    const replay: number[] = [];
    for await (const n of run.events) replay.push(n);
    expect(replay).toEqual([1, 2, 3, 4, 5]);
  });

  it('never rejects when the work throws', async () => {
    const { detachedEvents } = await import('@/lib/sse');
    const err = console.error;
    console.error = () => undefined;
    try {
      const run = detachedEvents<number>(async (emit) => {
        emit(1);
        throw new Error('boom');
      });
      await expect(run.done).resolves.toBeUndefined();
      const got: number[] = [];
      for await (const n of run.events) got.push(n);
      expect(got).toEqual([1]);
    } finally {
      console.error = err;
    }
  });
});
