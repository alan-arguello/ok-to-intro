import 'server-only';
import { flags } from '@/lib/env';
import type { HealthSnapshot } from '@/lib/types';
import { getLiveState } from './live';

/**
 * Owner: BE1. The snapshot GET /api/health returns and the banner reads (components/site/banner.tsx).
 * The same for every viewer, so the route may cache it for a few seconds at the edge.
 *
 * STUB (foundation): signature final. Until BE1 replaces the body it reports configuration (db: 'ok' means
 * “configured”, not “reachable”).
 */
export async function getHealth(): Promise<HealthSnapshot> {
  const live = await getLiveState();
  return {
    live: live.state,
    live_paused_until: live.paused_until,
    db: flags.hasSupabaseAdmin ? 'ok' : 'off',
    email: flags.hasResend ? 'ok' : 'off',
    network: flags.realNetwork ? 'real' : 'sample_only',
    checked_at: new Date().toISOString(),
  };
}
