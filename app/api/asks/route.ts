import { crossOrigin, isSameOrigin, jsonNoStore } from '@/lib/http';
import { createAsk, sessionRefusal, type CreateAskInput } from '@/lib/server/asks';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks — create a REAL ask (persisted; not sent).
 * Body: CreateAskInput `{text, compiled, idempotency_key, resend_of?}`. 201 `{id, status: 'ready'|'queued', repeated,
 * created_at}` (200 for an idempotent repeat); 400 invalid | refused (YC application) · 401 signed_out ·
 * 403 not_allowed (not invited in allowlist mode, or the asker profile is incomplete) · 409 too_soon (`retry_at`) ·
 * 503 not_configured | db_down. The client then opens /ask/<id>, which sends it (POST /api/asks/<id>/send).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return crossOrigin();
  const who = await getUser();
  if (!who.ok) {
    const refusal = sessionRefusal(who.reason);
    return jsonNoStore(refusal.body, refusal.status);
  }
  let body: Partial<CreateAskInput> | null = null;
  try {
    body = (await request.json()) as Partial<CreateAskInput>;
  } catch {
    body = null;
  }
  if (!body || typeof body.text !== 'string' || !body.compiled || typeof body.compiled !== 'object' || typeof body.idempotency_key !== 'string') {
    return jsonNoStore({ error: 'invalid', message: 'Send {text, compiled, idempotency_key}.' }, 400);
  }
  const res = await createAsk(who.user, {
    text: body.text,
    compiled: body.compiled,
    idempotency_key: body.idempotency_key,
    resend_of: typeof body.resend_of === 'string' ? body.resend_of : null,
  });
  if (res.ok) return jsonNoStore(res, res.repeated ? 200 : 201);
  const status = { invalid: 400, refused: 400, not_allowed: 403, too_soon: 409 }[res.reason as string] ?? 503;
  return jsonNoStore({ error: res.reason, message: res.message, ...(res.retry_at ? { retry_at: res.retry_at } : {}) }, status);
}
