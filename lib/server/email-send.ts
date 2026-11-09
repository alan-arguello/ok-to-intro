import 'server-only';

/**
 * Owner: BE2. Email delivery through Resend: every send goes through `public.email_outbox` with an idempotency key
 * (`offer:<offer_id>`, `intro:<intro_id>`, `checkin1:<checkin_id>`, `checkin14:<checkin_id>`, `withdrawn:<offer_id>`,
 * `outcome:<intro_id>`), check-ins use Resend scheduled send (cancelled on pause or delete), and the daily cron
 * retries failures. Templates come from lib/emails (R). Never logs bodies or addresses.
 *
 * STUB (foundation): signatures are final. Until BE2 replaces the bodies, nothing is sent or cancelled.
 */

export type CancelEmailsResult = { ok: true; cancelled: number } | { ok: false; reason: 'not_configured' | 'db_down' };

/**
 * Cancels this member's queued and scheduled emails, including Resend scheduled sends. `checkins` (one-click
 * unsubscribe, “Pause all asks” with stop emails) cancels check-ins only; `all` (before deleting a member) cancels
 * everything still unsent. Called by S3 (pauseMember / pauseByToken with `stopEmails`, and delete) BEFORE the rows
 * go away. Never throws; `not_configured` means there was nothing that could have been scheduled.
 */
export async function cancelMemberEmails(memberId: string, scope: 'checkins' | 'all' = 'all'): Promise<CancelEmailsResult> {
  void memberId;
  void scope;
  return { ok: false, reason: 'not_configured' };
}
