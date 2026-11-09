/**
 * Whether the browser holds a Supabase session cookie, without loading supabase-js (the header island uses it
 * to say “Your gate” instead of “Sign in”). A hint only: /me verifies the session on the server and redirects
 * to /join when it is stale. @supabase/ssr names the cookie `sb-<project-ref>-auth-token`, chunked as `.0`, `.1`…
 */
export function hasSessionCookie(cookieString: string): boolean {
  return /(?:^|;\s*)sb-[a-z0-9-]+-auth-token(?:\.\d+)?=[^;]+/i.test(cookieString);
}
