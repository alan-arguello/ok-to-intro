import { isSameOrigin, jsonNoStore } from '@/lib/http';
import { createGate } from '@/lib/server/personal-gates';
import { clientKey } from '@/lib/server/ratelimit';

/**
 * POST /api/gates — create a personal gate from the /rules form. Body (JSON): {name, headline?, slug, rules, cap}.
 * 201 {slug, token} (the token is shown once; only its SHA-256 is stored) · 400 invalid · 409 taken · 429 rate_limited
 * · 503 not_configured | db_down. No accounts, no email.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonNoStore({ error: 'cross_origin' }, 403);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 8_000) return jsonNoStore({ error: 'invalid', message: 'Too long.' }, 400);
    body = JSON.parse(text);
  } catch {
    return jsonNoStore({ error: 'invalid', message: 'Send JSON.' }, 400);
  }
  const res = await createGate(body, clientKey(request));
  if (res.ok) return jsonNoStore({ slug: res.slug, token: res.token }, 201);
  switch (res.reason) {
    case 'invalid':
      return jsonNoStore({ error: 'invalid', message: res.message }, 400);
    case 'taken':
      return jsonNoStore({ error: 'taken' }, 409);
    case 'rate_limited':
      return jsonNoStore({ error: 'rate_limited', retry_at: res.retry_at }, 429);
    default:
      return jsonNoStore({ error: res.reason }, 503);
  }
}
