import { getHealth } from '@/lib/server/health';

/**
 * Owner: BE1. GET /api/health — HealthSnapshot (lib/types.ts), the same for every viewer.
 * `{live: ok|slow|down|budget|off, live_paused_until, db: ok|down|off, email: ok|off, network: real|sample_only,
 * checked_at}`. The banner reads it on every page; the edge may cache it for 15 s. Never 500s: every field has a
 * designed value without keys.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await getHealth();
  return Response.json(health, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' } });
}
