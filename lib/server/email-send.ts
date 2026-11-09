import 'server-only';
import { createHmac } from 'node:crypto';
import { Resend } from 'resend';
import { env } from '@/lib/env';
import { hashToken } from '@/lib/oti/tokens';
import { absoluteUrl } from '@/lib/site';
import type { EmailFooter, EmailMessage } from '@/lib/types';
import { createPauseLink } from './member';
import { rpc } from './audit';

/**
 * Owner: BE2. Email delivery through Resend: every send goes through `public.email_outbox` with an idempotency key
 * (`offer:<offer_id>`, `intro:<intro_id>`, `checkin1:<checkin_id>`, `checkin14:<checkin_id>`, `withdrawn:<offer_id>`,
 * `outcome:<intro_id>`, and `checkin1:<checkin_id>:reminder` for the one d1 reminder), the same key is Resend's
 * Idempotency-Key, check-ins use Resend scheduled send (cancelled on pause or delete), and the daily cron retries
 * failures by rebuilding the email from the database. Templates come from lib/emails (R). Never logs bodies or
 * addresses.
 *
 * Without RESEND_API_KEY and EMAIL_FROM nothing is sent: the outbox row records “not sent: email not configured”,
 * and the caller gets `not_sent`, never a pretend success.
 *
 * Link tokens: an offer's or a check-in's link token is derived from TOKEN_HMAC_SECRET and the object id
 * (`linkToken`), and only its HMAC is stored (lib/oti/tokens.ts `hashToken`, the same lookup R uses). Deriving it
 * means a retry or a reminder rebuilds the exact same email, so Resend's idempotency key always meets the same body,
 * and no raw token is ever stored. A token is 128 bits of HMAC output: unguessable without the secret.
 */

export type EmailKind = 'offer' | 'intro' | 'checkin' | 'question' | 'outcome_note' | 'withdrawn';

export const EMAIL_NOT_CONFIGURED = 'not sent: email not configured';

export interface OutgoingEmail {
  /** The idempotency key, e.g. `offer:o_3Fp9kLm2Qx7a`. */
  key: string;
  kind: EmailKind;
  /** The member the email is about (pause and delete cancel by this), or null. */
  member_id: string | null;
  to: string[];
  reply_to?: string[];
  message: EmailMessage;
  /** Schedule for later (Resend scheduled send) when this is more than a minute ahead. */
  send_at?: Date | null;
  /** Stamps intros.sent_at / checkins.sent_at when the send goes through. */
  intro_id?: string;
  checkin_id?: string;
}

export type SendOutcome =
  | { status: 'sent' | 'scheduled'; id: string | null; repeated: boolean }
  | { status: 'not_sent'; reason: 'not_configured' | 'failed' | 'cancelled' | 'db_down'; message: string };

/* ========================================================================== *
 * Transport (Resend), replaceable in tests
 * ========================================================================== */

export interface EmailTransport {
  send(
    payload: { from: string; to: string[]; replyTo?: string[]; subject: string; html: string; text: string; headers?: Record<string, string>; scheduledAt?: string },
    options: { idempotencyKey: string },
  ): Promise<{ id: string | null; error: { name: string; message: string } | null }>;
  cancel(id: string): Promise<{ ok: boolean }>;
}

let testTransport: EmailTransport | null | undefined;
let resendClient: Resend | null = null;

/** Tests capture sends. `undefined` restores Resend; `null` simulates an instance without email. */
export function __setEmailTransportForTests(transport: EmailTransport | null | undefined): void {
  testTransport = transport;
}

function emailTransport(): EmailTransport | null {
  if (testTransport !== undefined) return testTransport;
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!key || !from) return null;
  resendClient ??= new Resend(key);
  const client = resendClient;
  return {
    async send(payload, options) {
      const res = await client.emails.send(
        {
          from: payload.from,
          to: payload.to,
          replyTo: payload.replyTo,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          headers: payload.headers,
          scheduledAt: payload.scheduledAt,
        },
        { idempotencyKey: options.idempotencyKey },
      );
      if (res.error) return { id: null, error: { name: res.error.name, message: res.error.message } };
      return { id: res.data?.id ?? null, error: null };
    },
    async cancel(id) {
      const res = await client.emails.cancel(id);
      return { ok: !res.error };
    },
  };
}

/** True when this instance can send email (Resend key and a From address). */
export function emailConfigured(): boolean {
  return emailTransport() !== null;
}

/* ========================================================================== *
 * Link tokens and footers
 * ========================================================================== */

/** The link token for an offer or a check-in (22 characters, base64url), or null without TOKEN_HMAC_SECRET. */
export function linkToken(purpose: 'offer' | 'checkin', id: string): string | null {
  const secret = env.TOKEN_HMAC_SECRET;
  if (!secret) return null;
  const mac = createHmac('sha256', secret).update(`link:${purpose}:${id}`).digest();
  return mac.subarray(0, 16).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The stored hash of that link token (what offers.token_hash / checkins.token_hash hold). */
export function linkTokenHash(purpose: 'offer' | 'checkin', id: string): string | null {
  const token = linkToken(purpose, id);
  return token ? hashToken(purpose, token) : null;
}

/** Footer links for an email to a member (ux-spec S5: footers follow the recipient's role). */
export async function memberFooter(memberId: string): Promise<Extract<EmailFooter, { role: 'member' }>> {
  let pauseUrl: string | null = null;
  try {
    pauseUrl = await createPauseLink(memberId);
  } catch {
    pauseUrl = null;
  }
  const token = pauseUrl?.match(/\/pause\/([^/?#]+)/)?.[1] ?? null;
  return {
    role: 'member',
    pause_url: pauseUrl ?? absoluteUrl('/me#settings'),
    rules_url: absoluteUrl('/me#settings'),
    delete_url: absoluteUrl('/me#delete'),
    unsubscribe_post_url: token ? absoluteUrl(`/api/pause?token=${token}`) : absoluteUrl('/api/pause'),
  };
}

/** Footer links for an email to an asker. */
export function askerFooter(askId: string): Extract<EmailFooter, { role: 'asker' }> {
  return { role: 'asker', ask_url: absoluteUrl(`/ask/${encodeURIComponent(askId)}`), delete_url: absoluteUrl('/me#delete') };
}

/* ========================================================================== *
 * Sending
 * ========================================================================== */

interface OutboxRow {
  key: string;
  status: 'queued' | 'scheduled' | 'sent' | 'failed' | 'cancelled';
  resend_id: string | null;
  attempts: number;
}

/** Resend allows scheduling up to 30 days ahead; later than that waits for the daily cron. */
const MAX_SCHEDULE_MS = 29 * 24 * 3_600_000;

/**
 * Sends (or schedules) one email at most once per key. A key already sent or scheduled returns `repeated`; a
 * cancelled key (the member paused or deleted) is never sent.
 */
export async function sendEmail(email: OutgoingEmail, now: Date = new Date()): Promise<SendOutcome> {
  const sendAt = email.send_at && email.send_at.getTime() > now.getTime() + 60_000 ? email.send_at : null;
  const claim = await rpc<OutboxRow>('net_outbox_claim', {
    p_key: email.key,
    p_kind: email.kind,
    p_member: email.member_id,
    p_send_at: (sendAt ?? now).toISOString(),
    p_now: now.toISOString(),
  });
  if (!claim.ok) return { status: 'not_sent', reason: claim.reason === 'not_configured' ? 'not_configured' : 'db_down', message: claim.message };
  const row = claim.data;
  if (row && (row.status === 'sent' || row.status === 'scheduled')) return { status: row.status, id: row.resend_id, repeated: true };
  if (row && row.status === 'cancelled') return { status: 'not_sent', reason: 'cancelled', message: 'cancelled' };

  const result = (status: 'sent' | 'scheduled' | 'failed', id: string | null, error: string | null) =>
    rpc<null>('net_outbox_result', {
      p_key: email.key,
      p_status: status,
      p_resend_id: id,
      p_error: error,
      p_now: now.toISOString(),
      p_intro: email.intro_id ?? null,
      p_checkin: email.checkin_id ?? null,
    });

  const transport = emailTransport();
  if (!transport) {
    await result('failed', null, EMAIL_NOT_CONFIGURED);
    return { status: 'not_sent', reason: 'not_configured', message: EMAIL_NOT_CONFIGURED };
  }
  if (sendAt && sendAt.getTime() - now.getTime() > MAX_SCHEDULE_MS) {
    // Too far ahead for Resend's scheduler: the outbox row waits (send_at) and the daily cron sends it on the day.
    return { status: 'not_sent', reason: 'failed', message: 'queued for the daily cron' };
  }
  const to = [...new Set(email.to.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) {
    await result('failed', null, 'no recipient');
    return { status: 'not_sent', reason: 'failed', message: 'no recipient' };
  }
  let sent: Awaited<ReturnType<EmailTransport['send']>>;
  try {
    sent = await transport.send(
      {
        from: env.EMAIL_FROM ?? '',
        to,
        replyTo: email.reply_to?.length ? [...new Set(email.reply_to.map((a) => a.trim().toLowerCase()))] : undefined,
        subject: email.message.subject,
        html: email.message.html,
        text: email.message.text,
        headers: Object.keys(email.message.headers ?? {}).length ? email.message.headers : undefined,
        scheduledAt: sendAt ? sendAt.toISOString() : undefined,
      },
      { idempotencyKey: email.key },
    );
  } catch (err) {
    sent = { id: null, error: { name: 'application_error', message: err instanceof Error ? err.message : 'send failed' } };
  }
  if (sent.error) {
    // Same key, same body already accepted (a retry after a timeout): it went out.
    if (sent.error.name === 'invalid_idempotent_request' || sent.error.name === 'concurrent_idempotent_requests') {
      await result(sendAt ? 'scheduled' : 'sent', null, null);
      return { status: sendAt ? 'scheduled' : 'sent', id: null, repeated: true };
    }
    console.error(`[email] ${email.kind} not sent:`, sent.error.name);
    await result('failed', null, `${sent.error.name}: ${sent.error.message}`.slice(0, 300));
    return { status: 'not_sent', reason: 'failed', message: sent.error.name };
  }
  await result(sendAt ? 'scheduled' : 'sent', sent.id, null);
  return { status: sendAt ? 'scheduled' : 'sent', id: sent.id, repeated: false };
}

export type CancelEmailsResult = { ok: true; cancelled: number } | { ok: false; reason: 'not_configured' | 'db_down' };

async function cancelRows(rows: { key: string; resend_id: string | null }[]): Promise<void> {
  const transport = emailTransport();
  if (!transport) return;
  for (const row of rows) {
    if (!row.resend_id) continue;
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        ok = (await transport.cancel(row.resend_id)).ok;
      } catch {
        ok = false;
      }
    }
    if (!ok) console.error('[email] a scheduled email could not be cancelled at Resend');
  }
}

/**
 * Cancels this member's queued and scheduled emails, including Resend scheduled sends. `checkins` (one-click
 * unsubscribe, “Pause all asks” with stop emails) cancels check-ins only; `all` (before deleting a member) cancels
 * everything still unsent. Called by S3 (pauseMember / pauseByToken with `stopEmails`, and delete) BEFORE the rows
 * go away. Never throws; `not_configured` means there was nothing that could have been scheduled.
 */
export async function cancelMemberEmails(memberId: string, scope: 'checkins' | 'all' = 'all'): Promise<CancelEmailsResult> {
  const res = await rpc<{ key: string; resend_id: string | null }[]>('net_outbox_cancel', { p_member: memberId, p_scope: scope, p_key: null });
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const rows = Array.isArray(res.data) ? res.data : [];
  await cancelRows(rows);
  return { ok: true, cancelled: rows.length };
}

/** Cancels one email by key (a reminder made moot by an answer). Never throws. */
export async function cancelEmailKey(key: string): Promise<void> {
  const res = await rpc<{ key: string; resend_id: string | null }[]>('net_outbox_cancel', { p_member: null, p_scope: 'all', p_key: key });
  if (res.ok && Array.isArray(res.data)) await cancelRows(res.data);
}

/* ========================================================================== *
 * Small helpers the builders share
 * ========================================================================== */

/** “Lucía” from “Lucía Ferrer”; the email's local part when no name was given. */
export function firstName(name: string | null | undefined, email?: string | null): string {
  const n = String(name ?? '').trim();
  if (n) return n.split(/\s+/)[0] as string;
  const local = String(email ?? '').split('@')[0] ?? '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there';
}

/** The full name, or the email's local part. */
export function displayName(name: string | null | undefined, email?: string | null): string {
  const n = String(name ?? '').trim();
  return n || firstName(null, email);
}
