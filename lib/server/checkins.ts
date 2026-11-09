import 'server-only';
import type { CheckinAnswer, CheckinLookup, CheckinSaveResult } from '@/lib/types';

/**
 * Owner: BE2. Follow-through: +1 day (both people: did the call happen, useful 1–5) and +14 days (the asker:
 * unblocked · a customer · a hire · an investor · nothing yet). GET preselects, one POST saves; the answer can
 * change until the window closes. Check-in emails are scheduled at intro time (Resend scheduled send) with the
 * daily cron as a backstop.
 *
 * `/c/[token]` takes the link token from the email (or a check-in id `c_…` for its signed-in recipient).
 *
 * STUB (foundation): signatures are final. Until BE2 replaces the bodies every call reports `not_configured`.
 */

export type CheckinRef = { token: string } | { checkin_id: string; member_id: string };

export async function getCheckin(ref: CheckinRef, now: Date = new Date()): Promise<CheckinLookup> {
  void ref;
  void now;
  return { found: false, reason: 'not_configured' };
}

/** Saves (or changes) an answer. Idempotent per (check-in, idempotency key). Used by /c and MCP record_outcome. */
export async function saveCheckin(ref: CheckinRef, answer: CheckinAnswer, idempotencyKey: string, now: Date = new Date()): Promise<CheckinSaveResult> {
  void ref;
  void answer;
  void idempotencyKey;
  void now;
  return { ok: false, reason: 'not_configured' };
}
