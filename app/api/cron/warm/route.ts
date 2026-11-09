import { env, hasCron } from '@/lib/env';
import { warmGate } from '@/lib/server/gate';

/**
 * Owner: BE2 (calls BE1's warmGate). GET /api/cron/warm — one real gate call so the structured-output grammar
 * never sits 24 h unused (vercel.json runs it daily; Hobby allows two crons). Bearer CRON_SECRET, like /daily.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!hasCron) return Response.json({ error: 'not_configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await warmGate());
}
