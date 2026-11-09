import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks/[id]/withdraw — `{idempotency_key}`. The person holding the ask is told it's no
 * longer needed; nobody else is asked. 200 `{ok:true, withdrawn_at}` · 401 · 404 · 409 (already closed) · 503.
 *
 * STUB (foundation): BE2 replaces the body (lib/server/asks.ts or offers.ts).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await ctx.params;
  const who = await getUser();
  if (!who.ok) return Response.json({ error: who.reason }, { status: who.reason === 'signed_out' ? 401 : 503, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ error: 'not_configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
