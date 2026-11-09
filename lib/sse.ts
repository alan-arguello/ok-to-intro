/**
 * Server-sent events, both ends (ux-spec §8 “Streaming”).
 *
 * Server: `sseResponse(request, run)` returns a `text/event-stream` Response at once and does the work inside the
 * stream. Every event carries `id: n`; a `: ping` comment goes out every 10 s so idle HTTP/1.1 connections survive;
 * headers say `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. When the client goes away the
 * sink's `signal` aborts so in-flight model calls can stop (playground only; real sends finish and persist).
 *
 * Client: `postSse(url, body, onEvent)` reads a POST stream with fetch + getReader + a small parser. It renders the
 * right final state even when every event arrives in one chunk (proxies and antivirus software buffer streams).
 * Use EventSource only for GET tails of a persisted ask (it reconnects with Last-Event-ID by itself).
 *
 * Route handlers that stream must export `runtime = 'nodejs'` and `maxDuration` (30 for /api/try, 60 for send).
 */

export interface SseEnvelope<N extends string = string, D = unknown> {
  event: N;
  data: D;
}

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
};

export const SSE_PING_MS = 10_000;

/* ========================================================================== *
 * Server
 * ========================================================================== */

export interface SseSink<E extends SseEnvelope> {
  /** Writes one event. `id` defaults to a counter starting at 1; pass a persisted sequence number to make the stream resumable. */
  send(event: E, options?: { id?: number | string }): void;
  /** Writes a comment line (`: text`), ignored by parsers. */
  comment(text: string): void;
  /** True once the client disconnected or the stream was closed. */
  readonly closed: boolean;
  /** Aborts when the client disconnects. */
  readonly signal: AbortSignal;
}

/** Encodes one event block. Exported for tests. */
export function encodeSseEvent(event: string, data: unknown, id?: number | string): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${String(id).replace(/[\r\n]/g, '')}`);
  lines.push(`event: ${event.replace(/[\r\n]/g, '')}`);
  const json = JSON.stringify(data ?? null);
  for (const line of json.split('\n')) lines.push(`data: ${line}`);
  return `${lines.join('\n')}\n\n`;
}

/**
 * A streaming Response that runs `run(sink)` inside the stream. The stream closes when `run` settles.
 * If `run` throws after events were sent, the stream just closes (send your own `error` event first).
 */
export function sseResponse<E extends SseEnvelope>(
  request: Request | null,
  run: (sink: SseSink<E>) => Promise<void>,
  options: { pingMs?: number; status?: number; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let closed = false;
  let counter = 0;
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (ping) clearInterval(ping);
        ping = null;
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const onAbort = () => {
        if (ping) clearInterval(ping);
        closed = true;
        abort.abort();
      };
      if (request?.signal?.aborted) onAbort();
      else request?.signal?.addEventListener('abort', onAbort, { once: true });

      const sink: SseSink<E> = {
        send(e, opts) {
          counter += 1;
          write(encodeSseEvent(e.event, e.data, opts?.id ?? counter));
        },
        comment(text) {
          write(`: ${text.replace(/[\r\n]/g, ' ')}\n\n`);
        },
        get closed() {
          return closed;
        },
        signal: abort.signal,
      };

      ping = setInterval(() => sink.comment('ping'), options.pingMs ?? SSE_PING_MS);
      // Flush the headers and a first byte at once, so the client sees the stream open before any gate answers.
      sink.comment('open');

      run(sink)
        .catch((err: unknown) => {
          // Never log request bodies (rules, asks); the error name and message are enough.
          console.error('[sse] stream failed:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error');
        })
        .finally(close);
    },
    cancel() {
      if (ping) clearInterval(ping);
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, { status: options.status ?? 200, headers: { ...SSE_HEADERS, ...(options.headers ?? {}) } });
}

/** Streams an async iterable of envelopes (e.g. BE1's `runTry`) as SSE. */
export function sseFromIterable<E extends SseEnvelope>(request: Request | null, events: (signal: AbortSignal) => AsyncIterable<E>, options?: { pingMs?: number }): Response {
  return sseResponse<E>(
    request,
    async (sink) => {
      for await (const e of events(sink.signal)) {
        if (sink.closed) break;
        sink.send(e);
      }
    },
    options,
  );
}

/* ========================================================================== *
 * Client
 * ========================================================================== */

export interface SseMessage {
  id: string | null;
  event: string;
  data: string;
}

/**
 * Incremental parser for the text/event-stream format (WHATWG HTML §9.2). Feed it decoded text in any
 * chunking; it emits complete messages only. Comments (`: ping`) are ignored.
 */
export function createSseParser(onMessage: (message: SseMessage) => void): { push(text: string): void; end(): void } {
  let buffer = '';
  let data: string[] = [];
  let event = '';
  let id: string | null = null;
  let lastId: string | null = null;

  const dispatch = () => {
    if (data.length) {
      lastId = id ?? lastId;
      onMessage({ id: lastId, event: event || 'message', data: data.join('\n') });
    }
    data = [];
    event = '';
    id = null;
  };

  const line = (l: string) => {
    if (l === '') return dispatch();
    if (l.startsWith(':')) return;
    const colon = l.indexOf(':');
    const field = colon < 0 ? l : l.slice(0, colon);
    let value = colon < 0 ? '' : l.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\u0000')) id = value;
  };

  return {
    push(text: string) {
      buffer += text;
      // Lines end with \n, \r\n or \r. Keep a trailing \r: the \n may come in the next chunk.
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && i === buffer.length - 1) break;
          line(buffer.slice(start, i));
          if (ch === '\r' && buffer[i + 1] === '\n') i++;
          start = i + 1;
        }
      }
      buffer = buffer.slice(start);
    },
    end() {
      // A held trailing \r ends its line (it was kept only in case \n followed in the next chunk).
      if (buffer.endsWith('\r')) line(buffer.slice(0, -1));
      else if (buffer) line(buffer);
      buffer = '';
      // A final event without its blank line is dropped, as the spec says.
      data = [];
    },
  };
}

/** Reads an SSE Response body to the end, calling `onEvent` with parsed JSON data. */
export async function readSse<E extends SseEnvelope>(
  response: Response,
  onEvent: (event: E, id: string | null) => void,
  signal?: AbortSignal,
): Promise<{ completed: boolean }> {
  if (!response.body) return { completed: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((m) => {
    let data: unknown = null;
    try {
      data = m.data ? JSON.parse(m.data) : null;
    } catch {
      return; // a malformed event is skipped, never guessed
    }
    onEvent({ event: m.event, data } as E, m.id);
  });
  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return { completed: false };
      }
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
    return { completed: true };
  } catch {
    // Lost connection: the caller decides what is missing (the playground re-requests only missing ask ids).
    return { completed: false };
  }
}

export type PostSseResult =
  | { ok: true; completed: boolean; status: number }
  | { ok: false; status: number; /** Parsed JSON error body, e.g. `{error: 'rate_limited', retry_at}`. */ body: unknown }
  | { ok: false; status: 0; offline: true }
  | { ok: false; status: 0; aborted: true };

/**
 * POSTs JSON and streams the SSE response. Non-stream responses (400, 429, 503 before any event) resolve with
 * `ok: false` and their JSON body. A network failure resolves with `offline: true`; an abort with `aborted: true`.
 */
export async function postSse<E extends SseEnvelope>(
  url: string,
  body: unknown,
  onEvent: (event: E, id: string | null) => void,
  options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<PostSseResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(options.headers ?? {}) },
      body: JSON.stringify(body),
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (options.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return { ok: false, status: 0, aborted: true };
    return { ok: false, status: 0, offline: true };
  }
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !type.includes('text/event-stream')) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { ok: false, status: response.status, body: parsed };
  }
  const { completed } = await readSse<E>(response, onEvent, options.signal);
  if (options.signal?.aborted) return { ok: false, status: 0, aborted: true };
  return { ok: true, completed, status: response.status };
}
