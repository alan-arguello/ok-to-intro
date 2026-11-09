import { crossOrigin, isSameOrigin } from '@/lib/http';
import { NOTHING_SENT, REAL_ASK_COPY } from '@/lib/oti/copy';
import { createAsk, type CreateAskInput } from '@/lib/server/asks';
import { getUser } from '@/lib/supabase/server';

/**
 * Owner: BE2. POST /api/asks — create a REAL ask (persisted; not sent).
 * Body: CreateAskInput `{text, compiled, idempotency_key, resend_of?}`. 201 `{id, status: 'ready'|'queued', repeated,
 * created_at}` (200 for an idempotent repeat); 400 invalid | refused (YC application) · 401 signed_out ·
 * 403 not_allowed (not invited in allowlist mode, or the asker profile is incomplete) · 409 too_soon (`retry_at`) ·
 * 503 not_configured | db_down.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return crossOrigin();
  const who = await getUser();
  if (!who.ok) {
    const status = who.reason === 'signed_out' ? 401 : 503;
    const message =
      who.reason === 'signed_out'
        ? REAL_ASK_COPY.signedOutOpen
        : who.reason === 'not_configured'
          ? `${REAL_ASK_COPY.notConfigured} ${NOTHING_SENT}`
          : `Sign-in isn’t answering right now. ${NOTHING_SENT}`;
    return Response.json({ error: who.reason, message }, { status, headers: NO_STORE });
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
  const res = await createAsk(who.user, {
    text: body.text,
    compiled: body.compiled,
    idempotency_key: body.idempotency_key,
    resend_of: typeof body.resend_of === 'string' ? body.resend_of : null,
  });
  if (res.ok) return Response.json(res, { status: res.repeated ? 200 : 201, headers: NO_STORE });
  const status = { invalid: 400, refused: 400, not_allowed: 403, too_soon: 409 }[res.reason as string] ?? 503;
  return Response.json({ error: res.reason, message: res.message, ...(res.retry_at ? { retry_at: res.retry_at } : {}) }, { status, headers: NO_STORE });
}
