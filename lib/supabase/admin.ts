import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { NotConfigured } from '@/lib/types';
import type { Database } from './database.types';

/**
 * The service-role client: bypasses RLS. Server code only (route handlers, server actions, cron, scripts).
 * Every query through it must check ownership in code (asker_id, member_id) before returning data.
 * Returns a typed “not configured” result instead of throwing when the env vars are missing.
 */

export type AdminClientResult = { ok: true; client: SupabaseClient<Database> } | NotConfigured;

let cached: SupabaseClient<Database> | null = null;

export function getAdminClient(): AdminClientResult {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const missing = [!url && 'NEXT_PUBLIC_SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean) as string[];
    return { ok: false, reason: 'not_configured', missing };
  }
  cached ??= createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'ok-to-intro-server' } },
  });
  return { ok: true, client: cached };
}

/** True when an error from supabase-js means the database couldn't be reached (vs. a constraint or query error). */
export function isDbDown(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return !error.code && /fetch failed|ECONNREFUSED|ETIMEDOUT|network|Failed to fetch|timeout/i.test(error.message ?? '');
}
