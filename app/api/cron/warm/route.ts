import { timingSafeEqual } from 'node:crypto';
import { env, hasCron } from '@/lib/env';
import { jsonNoStore } from '@/lib/http';
import { runWarm } from '@/lib/server/cron';

/**
 * Owner: BE2 (calls BE1's warmGate). GET /api/cron/warm — one real gate call so the structured-output grammar
 * never sits 24 h unused (vercel.json runs it daily, 12 h after /api/cron/daily). Bearer CRON_SECRET, like /daily.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET ?? ''}`);
  const got = Buffer.from(request.headers.get('authorization') ?? '');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function GET(request: Request) {
  if (!hasCron) return jsonNoStore({ error: 'not_configured', message: 'CRON_SECRET isn’t set on this instance.' }, 503);
  if (!authorized(request)) return jsonNoStore({ error: 'unauthorized' }, 401);
  return jsonNoStore(await runWarm());
}
