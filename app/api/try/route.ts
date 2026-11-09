import { after } from 'next/server';
import { jsonNoStore } from '@/lib/http';
import { startTry, type TryMode } from '@/lib/server/gate';
import { settleBackground } from '@/lib/server/live';
import { clientKey } from '@/lib/server/ratelimit';
import { sseFromIterable } from '@/lib/sse';
import type { SampleAskKey, TryRequest } from '@/lib/types';

/**
 * Owner: BE1. POST /api/try — the playground's live run as SSE (ux-spec §8).
 * Body (JSON): TryRequest `{rules, ask_ids?}`, plus optional `mode`: 'live' (the default: only live verdicts stream),
 * 'recorded' (an unedited preset's recorded run, no model call) or 'auto' (live when possible, else an unedited
 * preset's recorded run; lib/server/gate.ts startTry).
 * Before streaming: 400 `{error:'invalid_rules', message}`, 429 `{error:'rate_limited', retry_at}` (+ Retry-After),
 * 503 `{error:'live_unavailable', live, until}`. Then `text/event-stream`: plan → gate|error × n → done, with `id: n`
 * on every event and `: ping` every 10 s. The rules are never stored or logged; the stream stops its model calls when
 * the client goes away.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const MAX_BODY_CHARS = 16_384;
const BAD_BODY = 'Send JSON: {"rules": "…"} with Content-Type: application/json.';

/** The JSON object in the body, or null (wrong type, too big, not an object). Never logs it. */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return null;
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_CHARS * 4) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function secondsUntil(iso: string): number {
  return Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 1000));
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || typeof body.rules !== 'string') return jsonNoStore({ error: 'invalid_rules', message: BAD_BODY }, 400);

  const input: TryRequest & { mode?: TryMode } = { rules: body.rules };
  if (body.ask_ids !== undefined) input.ask_ids = body.ask_ids as SampleAskKey[]; // startTry validates every id
  if (body.mode === 'recorded' || body.mode === 'live' || body.mode === 'auto') input.mode = body.mode;

  // Model calls stop when the visitor leaves: the request aborts, or the stream is cancelled.
  const stop = new AbortController();
  if (request.signal.aborted) stop.abort();
  else request.signal.addEventListener('abort', () => stop.abort(), { once: true });
  const start = await startTry(input, { clientKey: clientKey(request), signal: stop.signal });
  if (!start.ok) {
    const headers: Record<string, string> = start.body.error === 'rate_limited' ? { 'Retry-After': String(secondsUntil(start.body.retry_at)) } : {};
    return jsonNoStore(start.body, start.status, headers);
  }
  try {
    // Usage totals and the playground_run audit row are written after the response ends.
    after(() => settleBackground());
  } catch {
    /* outside a request scope (unit tests): nothing to keep alive */
  }
  return sseFromIterable(request, (streamSignal) => {
    streamSignal.addEventListener('abort', () => stop.abort(), { once: true });
    return start.events;
  });
}
