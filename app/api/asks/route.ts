import { createAsk, type CreateAskInput } from '@/lib/server/asks';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks — create a REAL ask (persisted; not sent).
 * Body: CreateAskInput `{text, compiled, idempotency_key}`. 201 `{id, status: 'ready'|'queued', repeated, created_at}`;
 * 400 invalid · 401 signed_out · 403 not_allowed (not on the REAL askers list) · 503 not_configured | db_down.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const who = await getUser();
  if (!who.ok) {
    const status = who.reason === 'signed_out' ? 401 : 503;
    return Response.json({ error: who.reason, message: status === 401 ? 'Sign in to ask the real network.' : 'Sign-in isn’t available right now. Nothing was sent to anyone.' }, { status, headers: NO_STORE });
  }
  let body: Partial<CreateAskInput> | null = null;
  try {
    body = (await request.json()) as Partial<CreateAskInput>;
  } catch {
    body = null;
  }
  if (!body || typeof body.text !== 'string' || !body.compiled || typeof body.idempotency_key !== 'string') {
    return Response.json({ error: 'invalid', message: 'Send {text, compiled, idempotency_key}.' }, { status: 400, headers: NO_STORE });
  }
  const res = await createAsk(who.user, { text: body.text, compiled: body.compiled, idempotency_key: body.idempotency_key });
  if (res.ok) return Response.json(res, { status: res.repeated ? 200 : 201, headers: NO_STORE });
  const status = res.reason === 'invalid' ? 400 : res.reason === 'not_allowed' ? 403 : 503;
  return Response.json({ error: res.reason, message: res.message }, { status, headers: NO_STORE });
}
