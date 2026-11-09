/**
 * The browser Supabase client (sign-in with an email code on /join, nothing else).
 * Load it only from pages that need it: supabase-js is ~50 KB gzip and stays off the landing page.
 * Returns a typed “not configured” result instead of throwing when the public env vars are missing.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotConfigured } from '@/lib/types';
import { SUPABASE_ANON_KEY, SUPABASE_PUBLIC_CONFIGURED, SUPABASE_PUBLIC_VARS, SUPABASE_URL } from './config';
import type { Database } from './database.types';

export type BrowserClientResult = { ok: true; client: SupabaseClient<Database> } | NotConfigured;

let cached: SupabaseClient<Database> | null = null;

export function getBrowserClient(): BrowserClientResult {
  if (!SUPABASE_PUBLIC_CONFIGURED || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, reason: 'not_configured', missing: [...SUPABASE_PUBLIC_VARS] };
  }
  cached ??= createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return { ok: true, client: cached };
}
