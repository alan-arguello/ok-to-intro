/**
 * A fake Anthropic API for tests: a `fetch` the real SDK calls (lib/server/live.ts `__setModelFetchForTests`), so
 * the SDK's own retries, error classes, headers and request ids run as in production. No network, no key.
 */

export interface FakeRequest {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}

export type Responder = (req: FakeRequest, signal: AbortSignal | null) => Response | Promise<Response>;

let reqCounter = 0;

/** A Messages API response whose text block is `text` (the structured output). */
export function message(text: string, extra: { stop_reason?: string; model?: string; usage?: Record<string, number> } = {}): Response {
  reqCounter += 1;
  const body = {
    id: `msg_test_${reqCounter}`,
    type: 'message',
    role: 'assistant',
    model: extra.model ?? 'claude-haiku-5-5',
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: extra.stop_reason ?? 'end_turn',
    stop_sequence: null,
    stop_details: extra.stop_reason === 'refusal' ? { type: 'refusal', category: 'general_harms', explanation: null } : null,
    usage: { input_tokens: 250, output_tokens: 90, cache_creation_input_tokens: 0, cache_read_input_tokens: 800, ...(extra.usage ?? {}) },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'request-id': `req_test_${reqCounter}` } });
}

/** A gate verdict as the model would return it. */
export function verdict(v: {
  verdict: string;
  cited?: string[];
  reason_code?: string;
  reason?: string;
  question?: { type: string; text: string } | null;
  flags?: string[];
  confidence?: number;
}): Response {
  return message(
    JSON.stringify({
      verdict: v.verdict,
      cited: v.cited ?? [],
      reason_code: v.reason_code ?? (v.verdict === 'accept' ? 'match' : 'no_rule'),
      reason: v.reason ?? 'A reason.',
      question: v.question ?? null,
      flags: v.flags ?? [],
      confidence: v.confidence ?? 0.9,
    }),
  );
}

/** An API error response (`{type:'error', error:{type, message, details?}}`). */
export function apiError(status: number, type: string, msg: string, headers: Record<string, string> = {}, details?: Record<string, unknown>): Response {
  reqCounter += 1;
  const body = { type: 'error', error: { type, message: msg, ...(details ? { details } : {}) }, request_id: `req_err_${reqCounter}` };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': `req_err_${reqCounter}`, ...headers } });
}

/** A streamed Messages response (text/event-stream) from raw stream events. */
export function sse(events: Record<string, unknown>[], opts: { delayMs?: number } = {}): Response {
  reqCounter += 1;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const ev of events) {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        controller.enqueue(encoder.encode(`event: ${String(ev.type)}\ndata: ${JSON.stringify(ev)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': `req_stream_${reqCounter}` } });
}

/** The raw events of a streamed message whose single text block arrives in `chunks`. */
export function textStreamEvents(chunks: string[], opts: { stop_reason?: string; model?: string; fallbackFirst?: string[] } = {}): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    { type: 'message_start', message: { id: 'msg_s', type: 'message', role: 'assistant', model: opts.model ?? 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 600, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
  ];
  let index = 0;
  if (opts.fallbackFirst) {
    out.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    for (const c of opts.fallbackFirst) out.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: c } });
    out.push({ type: 'content_block_stop', index });
    index += 1;
    out.push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: { model: 'claude-sonnet-5-5' }, to: { model: 'claude-sonnet-5' } } });
    out.push({ type: 'content_block_stop', index });
    index += 1;
  }
  out.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
  for (const c of chunks) out.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: c } });
  out.push({ type: 'content_block_stop', index });
  out.push({ type: 'message_delta', delta: { stop_reason: opts.stop_reason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } });
  out.push({ type: 'message_stop' });
  return out;
}

/** Splits a string into chunks of `n` characters (stream deltas). */
export function chunk(text: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

/**
 * A fake fetch. Each call takes the next responder from `queue` (or `fallback` when the queue is empty) and records
 * the request. A responder that never resolves still honours the abort signal, like real fetch.
 */
export function fakeFetch(fallback?: Responder) {
  const queue: Responder[] = [];
  const requests: FakeRequest[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? {});
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const req: FakeRequest = { url, method: init?.method ?? 'GET', headers, body };
    requests.push(req);
    const signal = init?.signal ?? null;
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const responder = queue.shift() ?? fallback;
    if (!responder) throw new Error(`fake API: no responder for request ${requests.length}`);
    const pending = Promise.resolve(responder(req, signal));
    if (!signal) return pending;
    return await new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      pending.then(
        (r) => {
          signal.removeEventListener('abort', onAbort);
          resolve(r);
        },
        (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }) as typeof fetch;
  return {
    fetch: impl,
    requests,
    /** Queue responders for the next calls, in order. */
    next(...responders: Responder[]) {
      queue.push(...responders);
      return this;
    },
  };
}

/** A responder that never answers (until the request is aborted). */
export const hang: Responder = () => new Promise<Response>(() => undefined);

/** Wraps a Response in a responder. */
export const reply = (make: () => Response): Responder => () => make();
