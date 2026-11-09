import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks/[id]/resolve — after a 2-line answer: `{solved: boolean, idempotency_key}`
 * (“Yes, close my ask” / “No, keep it open”). 200 `{ok:true, outcome}` · 401 · 404 · 409 · 503.
 *
 * STUB (foundation): BE2 replaces the body.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await ctx.params;
  const who = await getUser();
  if (!who.ok) return Response.json({ error: who.reason }, { status: who.reason === 'signed_out' ? 401 : 503, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ error: 'not_configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
