import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh for the paths that read the signed-in member (Next 16 “proxy”, formerly middleware).
 * It refreshes an expiring Supabase session and writes the new cookies on the response, the way @supabase/ssr
 * requires, and does nothing else: it never redirects, never reads request bodies (SSE routes stream through it
 * untouched) and is a no-op when Supabase isn't configured. Pages decide access themselves (requireMember).
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // No session cookie, no work: anonymous visitors (most of /ask) skip the auth round trip.
  const hasSession = request.cookies.getAll().some((c) => /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i.test(c.name));
  if (!url || !key || !hasSession) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  try {
    // getClaims() validates the JWT and refreshes the session when it is about to expire.
    await supabase.auth.getClaims();
  } catch {
    // Auth unreachable: let the page render its own state; never block the request here.
  }
  return response;
}

export const config = {
  matcher: ['/me/:path*', '/join', '/ask/:path*', '/api/asks/:path*'],
};
