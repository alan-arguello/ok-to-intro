import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { MemberRef, NotConfigured } from '@/lib/types';
import { SUPABASE_ANON_KEY, SUPABASE_PUBLIC_CONFIGURED, SUPABASE_PUBLIC_VARS, SUPABASE_URL } from './config';
import type { Database } from './database.types';

/**
 * The user-scoped server client (RLS applies, the session comes from cookies). Use it in server components,
 * server actions and route handlers to act as the signed-in person. Server-side writes that must bypass RLS
 * use lib/supabase/admin.ts instead.
 *
 * Reading cookies makes a route dynamic. The shared layouts never call this (ux-spec §3: the header's
 * “Sign in / Your gate” is a client island).
 */

export type ServerClientResult = { ok: true; client: SupabaseClient<Database> } | NotConfigured;

export async function getServerClient(): Promise<ServerClientResult> {
  if (!SUPABASE_PUBLIC_CONFIGURED || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, reason: 'not_configured', missing: [...SUPABASE_PUBLIC_VARS] };
  }
  const store = await cookies();
  const client = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a server component, where cookies are read-only. proxy.ts refreshes the session,
          // so this is safe to ignore (the documented @supabase/ssr pattern).
        }
      },
    },
  });
  return { ok: true, client };
}

export type UserResult =
  | { ok: true; user: MemberRef }
  | { ok: false; reason: 'not_configured' | 'signed_out' | 'error' };

/**
 * The signed-in person, verified with Supabase Auth (getUser contacts the auth server, so a revoked session
 * reads as signed out). Never throws.
 */
export async function getUser(): Promise<UserResult> {
  const res = await getServerClient();
  if (!res.ok) return { ok: false, reason: 'not_configured' };
  try {
    const { data, error } = await res.client.auth.getUser();
    if (error || !data.user) return { ok: false, reason: error && error.status !== 401 && error.name !== 'AuthSessionMissingError' ? 'error' : 'signed_out' };
    return { ok: true, user: { id: data.user.id, email: (data.user.email ?? '').toLowerCase() } };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * For pages and actions that need a signed-in person: returns them, or redirects to
 * `/join?next=<path>` (ux-spec S3 [signed-out]). When Supabase isn't configured the redirect still happens,
 * and /join renders its designed “sign-in isn't set up on this instance” state.
 * Note: on a first visit the `members` row may not exist yet; S3 creates it when the code verifies.
 */
export async function requireMember(options: { next?: string } = {}): Promise<MemberRef> {
  const res = await getUser();
  if (res.ok) return res.user;
  const next = options.next && options.next.startsWith('/') && !options.next.startsWith('//') ? options.next : '/me';
  redirect(`/join?next=${encodeURIComponent(next)}`);
}
