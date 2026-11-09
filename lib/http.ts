/**
 * Route-handler helpers (owner: F). Server actions get Next's Origin check for free; route handlers don't. Every
 * cookie-authenticated POST route (POST /api/asks, /api/asks/[id]/send | answer | withdraw | resolve) calls
 * `isSameOrigin` first and answers 403 `{error: 'cross_origin'}` otherwise. Not for /api/pause (mail clients POST it
 * cross-site for one-click unsubscribe; the token is the capability) or bearer-token routes (/mcp, /api/hook).
 */

/**
 * False when a browser says the request came from another site. Browsers send Origin on every POST; a request
 * without it (curl, server-to-server) carries no ambient cookies worth forging, so it passes.
 */
export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  if (origin === 'null') return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const own = forwarded || request.headers.get('host') || new URL(request.url).host;
  return originHost === own;
}

/** `Cache-Control: no-store` JSON, the shape every API error uses: `{error, message?, …}`. */
export function jsonNoStore(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** The 403 for a cross-site POST. */
export function crossOrigin(): Response {
  return jsonNoStore({ error: 'cross_origin', message: 'This request came from another site. Nothing was sent to anyone.' }, 403);
}
