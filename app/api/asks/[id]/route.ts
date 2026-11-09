import { getAskerView } from '@/lib/server/asks';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. GET /api/asks/[id] — the asker's serialized view (AskerAskView), owner only.
 * 200 view · 401 signed_out · 404 not_found (also for someone else's ask) · 503 not_configured | db_down.
 * With `Accept: text/event-stream` (EventSource, Last-Event-ID) BE2 tails new fan-out events after a snapshot.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const who = await getUser();
  if (!who.ok) return Response.json({ error: who.reason }, { status: who.reason === 'signed_out' ? 401 : 503, headers: NO_STORE });
  const res = await getAskerView(id, who.user);
  if (res.ok) return Response.json(res.view, { headers: NO_STORE });
  return Response.json({ error: res.reason }, { status: res.reason === 'not_found' ? 404 : 503, headers: NO_STORE });
}
