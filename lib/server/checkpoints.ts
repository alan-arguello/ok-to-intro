import 'server-only';
import { askerAsOf, lastCheckpoint, nextCheckpoint, toMs } from '@/lib/oti/time';

/**
 * Owner: BE2. When an asker may see what a member did (docs/CONTRACT.md §d.5, ux-spec §1 “Conflicts resolved”).
 *
 * Asker-visible changes other than “intro made” land at the next 09:00 or 21:00 Pacific time (PT), computed on read:
 * a member who passes at 10:13 and one who lets 72 hours run out at 20:59 both show up at 21:00, so the asker can't
 * time a No, or tell it from an expiry. Machine results the asker triggered (the send's fan-out, the rerun after their
 * answer) and their own actions show at once. SQL has the same rule (public.net__ceil_checkpoint in 0002).
 *
 * Pure functions over instants; lib/oti/time.ts holds the calendar math (Pacific time observes DST, so two
 * checkpoints are 11 or 13 hours apart twice a year; nothing here assumes 12).
 */

export { askerAsOf, lastCheckpoint, nextCheckpoint };

/** True when `t` is exactly a checkpoint (09:00:00.000 or 21:00:00.000 in Pacific time). */
export function isCheckpoint(t: Date | number | string): boolean {
  const ms = toMs(t);
  return lastCheckpoint(ms).getTime() === ms;
}

/** The first checkpoint at or after `t`: when a change a member caused at `t` becomes visible to the asker. */
export function ceilCheckpoint(t: Date | number | string): Date {
  const ms = toMs(t);
  return isCheckpoint(ms) ? new Date(ms) : nextCheckpoint(ms);
}

/**
 * When the asker may see a member-driven event that happened at `t`. Events at or before the send finished
 * (`gatedAt`) were part of the fan-out the asker watched, so they show as they happened.
 */
export function memberEventVisibleAt(t: Date | number | string, gatedAt: Date | number | string | null): number {
  const ms = toMs(t);
  if (gatedAt !== null && ms <= toMs(gatedAt)) return ms;
  return ceilCheckpoint(ms).getTime();
}

/**
 * The reply-by an asker sees for an offer the line moved to (position 2 and later, or any offer made after the send):
 * rounded up to a checkpoint, because the exact minute is the previous holder's pass (or expiry) plus 72 hours.
 */
export function roundedReplyBy(expiresAt: Date | number | string): Date {
  return ceilCheckpoint(expiresAt);
}
