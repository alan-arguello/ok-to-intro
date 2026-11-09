import { timingSafeEqual } from 'node:crypto';
import { env, hasCron } from '@/lib/env';
import { jsonNoStore } from '@/lib/http';
import { runDaily } from '@/lib/server/cron';

/**
 * Owner: BE2. GET /api/cron/daily — the Vercel cron backstop (Hobby runs once a day, ±59 min): expire offers past
 * 72 h and move them on, finish sends that never finished, send due check-ins the scheduler missed and the one d1
 * reminder, retry failed emails, delete expired drafts, prune rate-limit windows older than a day, and call BE1's
 * warmGate() too (with /api/cron/warm that is two warm calls a day, so the structured-output grammar never sits
 * 24 h unused despite cron jitter). lib/server/cron.ts does the work; it is idempotent.
 * Requires `Authorization: Bearer <CRON_SECRET>`. 401 without it; 503 when CRON_SECRET isn't set.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET ?? ''}`);
  const got = Buffer.from(request.headers.get('authorization') ?? '');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function GET(request: Request) {
  if (!hasCron) return jsonNoStore({ error: 'not_configured', message: 'CRON_SECRET isn’t set on this instance.' }, 503);
  if (!authorized(request)) return jsonNoStore({ error: 'unauthorized' }, 401);
  return jsonNoStore(await runDaily());
}
