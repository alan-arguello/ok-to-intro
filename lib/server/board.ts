import 'server-only';
import type { RealLine } from '@/lib/types';

/**
 * Owner: S7. Real counts for /board (public.board_snapshot) and the playground's REAL line (public.real_line),
 * read with the service role and served through ISR (revalidate 60 on /board, 3600 on /) so the last good page
 * keeps serving when the database is down.
 *
 * STUB (foundation): signature final. Until S7 replaces the body it reports “not connected” (null).
 */

/**
 * The dated REAL line under the S1 lede, or null when the real network isn't connected on this instance
 * (S1 then shows REAL_LINE_OFF from lib/oti/copy.ts) or the database can't be read.
 */
export async function getRealLine(): Promise<RealLine | null> {
  return null;
}
