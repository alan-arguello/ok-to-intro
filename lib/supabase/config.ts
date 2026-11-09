/**
 * Public Supabase settings, read literally so Next inlines them into client bundles.
 * Safe in client and server code. Server-only secrets live in lib/env.ts.
 */

export const SUPABASE_URL: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
export const SUPABASE_ANON_KEY: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;

/** True when sign-in and user-scoped reads can work (URL + anon key present). */
export const SUPABASE_PUBLIC_CONFIGURED: boolean = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** The names a “not configured” result reports (never values). */
export const SUPABASE_PUBLIC_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;
