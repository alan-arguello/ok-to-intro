import 'server-only';
import type { RealLineResult } from '@/lib/types';

/**
 * Owner: S7. Real counts for /board (public.board_snapshot) and the playground's REAL line (public.real_line),
 * read with the service role and served through ISR (revalidate 60 on /board, 3600 on /) so the last good page
 * keeps serving when the database is down.
 *
 * STUB (foundation): signature final. Until S7 replaces the body it reports “not connected” (null).
 */

/**
 * The dated REAL line under the S1 lede (public.real_line). Never throws, also at build time (S1 is prerendered):
 * `not_configured` when the real network isn't connected on this instance (S1 shows REAL_LINE_OFF);
 * `db_down` when it is configured but can't be read (S1 renders no REAL line rather than a wrong one).
 */
export async function getRealLine(): Promise<RealLineResult> {
  return { ok: false, reason: 'not_configured' };
}
