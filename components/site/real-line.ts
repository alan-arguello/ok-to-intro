import { REAL_LINE_OFF } from '@/lib/oti/copy';
import { plural } from '@/lib/oti/text';
import type { RealLineResult } from '@/lib/types';

/**
 * The dated REAL line under a lede (`/` and `/rules`), from real counts only: not connected on this instance →
 * REAL_LINE_OFF; nobody joined yet → honest zeros; database down → no line at all (never stale numbers presented as
 * current). Pure; the pages call getRealLine() and pass the result here.
 */
export function realLineText(result: RealLineResult): string | null {
  if (!result.ok) return result.reason === 'not_configured' ? REAL_LINE_OFF : null;
  const l = result.line;
  if (l.since === null) return 'Real network: no members yet.';
  return `Network since ${l.since}: ${plural(l.members, 'member')}, ${plural(l.asks, 'ask')}, ${plural(l.intros, 'intro')}.`;
}
