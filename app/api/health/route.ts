import { getHealth } from '@/lib/server/health';

/**
 * Owner: BE1. GET /api/health — HealthSnapshot (lib/types.ts), the same for every viewer.
 * The banner reads it on every page; the edge may cache it for 15 s.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await getHealth();
  return Response.json(health, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' } });
}
