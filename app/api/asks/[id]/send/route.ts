import { startSend } from '@/lib/server/dispatch';
import { clientKey } from '@/lib/server/ratelimit';
import { sseFromIterable } from '@/lib/sse';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks/[id]/send — fan out a persisted REAL ask as SSE (asker-serialized events).
 * Before streaming: 401 · 403 · 404 · 409 (queued / already sent) · 429 · 503 with a FanoutRefusal body.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await getUser();
  if (!who.ok) {
    return Response.json({ error: who.reason, message: 'Sign in to send to the real network. Nothing was sent to anyone.' }, { status: who.reason === 'signed_out' ? 401 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const start = await startSend(id, who.user, { clientKey: clientKey(request), signal: request.signal });
  if (!start.ok) return Response.json(start.body, { status: start.status, headers: { 'Cache-Control': 'no-store' } });
  return sseFromIterable(request, () => start.events);
}
