import { after } from 'next/server';
import { jsonNoStore } from '@/lib/http';
import { startCompile } from '@/lib/server/compiler';
import { settleBackground } from '@/lib/server/live';
import { clientKey } from '@/lib/server/ratelimit';
import { sseFromIterable } from '@/lib/sse';

/**
 * Owner: BE1. POST /api/compile — the 5-part compiler as SSE (ux-spec S2).
 * Body (JSON): CompileRequest `{text, network}`. Before streaming: 400 `{error:'invalid_text', message}`,
 * 429 `{error:'rate_limited', retry_at}` (+ Retry-After), 503 `{error:'live_unavailable', live, until}`.
 * Then plan → part × 5 → done, or refused, or error. Refusals that code decides (an ask about a YC application, an
 * ask too short to name a blocker, a SAMPLE “Vague” chip) stream without a model call, with or without a key.
 * The founder's text is never stored or logged.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const MAX_BODY_CHARS = 16_384;
const BAD_BODY = 'Send JSON: {"text": "…", "network": "sample"} with Content-Type: application/json.';

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
  if (!body || typeof body.text !== 'string') return jsonNoStore({ error: 'invalid_text', message: BAD_BODY }, 400);

  // The model call stops when the visitor leaves: the request aborts, or the stream is cancelled.
  const stop = new AbortController();
  if (request.signal.aborted) stop.abort();
  else request.signal.addEventListener('abort', () => stop.abort(), { once: true });
  const start = await startCompile({ text: body.text, network: body.network === 'real' ? 'real' : 'sample' }, { clientKey: clientKey(request), signal: stop.signal });
  if (!start.ok) {
    const headers: Record<string, string> = start.body.error === 'rate_limited' ? { 'Retry-After': String(secondsUntil(start.body.retry_at)) } : {};
    return jsonNoStore(start.body, start.status, headers);
  }
  try {
    after(() => settleBackground());
  } catch {
    /* outside a request scope (unit tests) */
  }
  return sseFromIterable(request, (streamSignal) => {
    streamSignal.addEventListener('abort', () => stop.abort(), { once: true });
    return start.events;
  });
}
