import 'server-only';
import { flags } from '@/lib/env';
import { getAdminClient } from '@/lib/supabase/admin';
import type { HealthSnapshot } from '@/lib/types';
import { getLiveState } from './live';

/**
 * Owner: BE1. The snapshot GET /api/health returns and the banner reads (components/site/banner.tsx).
 * The same for every viewer, so the route may cache it for a few seconds at the edge.
 *
 * - live: off (no key) · budget (paused until `live_paused_until`) · down · slow · ok (lib/server/live.ts).
 * - db: off when the service role isn't configured; otherwise a tiny read (cached 10 s, 800 ms timeout): ok when it
 *   answers, down when it errors or times out. The board's [stale] notice and the token pages' error copy key off it.
 * - email: ok when Resend and a sender are configured (sending itself is BE2's), off otherwise.
 * - network: real when every variable the REAL network needs is set, else sample_only.
 * Never throws.
 */

const DB_PROBE_TTL_MS = 10_000;
const DB_PROBE_TIMEOUT_MS = 800;

let dbProbe: { value: 'ok' | 'down'; at: number } | null = null;
let probing: Promise<'ok' | 'down'> | null = null;

async function probeDb(): Promise<'ok' | 'down'> {
  const admin = getAdminClient();
  if (!admin.ok) return 'down';
  try {
    const { error } = await admin.client.from('app_state').select('key').limit(1).abortSignal(AbortSignal.timeout(DB_PROBE_TIMEOUT_MS));
    return error ? 'down' : 'ok';
  } catch {
    return 'down';
  }
}

async function dbState(now: number): Promise<HealthSnapshot['db']> {
  if (!flags.hasSupabaseAdmin) return 'off';
  if (dbProbe && now - dbProbe.at < DB_PROBE_TTL_MS) return dbProbe.value;
  probing ??= probeDb().finally(() => {
    probing = null;
  });
  const value = await probing;
  dbProbe = { value, at: Date.now() };
  return value;
}

export async function getHealth(): Promise<HealthSnapshot> {
  const now = Date.now();
  const [live, db] = await Promise.all([getLiveState(now), dbState(now)]);
  return {
    live: live.state,
    live_paused_until: live.paused_until,
    db,
    email: flags.hasResend ? 'ok' : 'off',
    network: flags.realNetwork ? 'real' : 'sample_only',
    checked_at: new Date(now).toISOString(),
  };
}
