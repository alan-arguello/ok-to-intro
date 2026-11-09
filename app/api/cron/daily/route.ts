import { env, hasCron } from '@/lib/env';

/**
 * Owner: BE2. GET /api/cron/daily — the Vercel cron backstop (Hobby runs once a day): expire offers past 72 h and
 * move them on, send due check-ins the scheduler missed, retry failed emails, prune rate-limit windows.
 * Requires `Authorization: Bearer <CRON_SECRET>`. 401 without it; 503 when CRON_SECRET isn't set.
 *
 * STUB (foundation): BE2 replaces the work below with lib/server/cron.ts.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!hasCron) return Response.json({ error: 'not_configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ ok: true, ran: [] });
}
