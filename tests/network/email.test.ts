import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TOKEN_HMAC_SECRET = 'test-token-hmac-secret-0123456789abcdef';
});
vi.mock('@/lib/server/member', () => ({ createPauseLink: async () => 'http://localhost:3200/pause/PauseToken0123456789ab' }));

import { looksLikeToken } from '@/lib/oti/ids';
import { hashToken } from '@/lib/oti/tokens';
import { __setNetworkDbForTests } from '@/lib/server/audit';
import {
  __setEmailTransportForTests,
  cancelEmailKey,
  cancelMemberEmails,
  EMAIL_NOT_CONFIGURED,
  linkToken,
  linkTokenHash,
  memberFooter,
  sendEmail,
} from '@/lib/server/email-send';
import type { EmailMessage } from '@/lib/types';
import { captureEmails, createNetworkDb, type NetworkDb } from './support';

const message: EmailMessage = { subject: 'Enterprise deals stuck 5 months, 20 min?', preheader: 'p', html: '<p>x</p>', text: 'x', headers: {} };

let net: NetworkDb;
let member: string;

beforeAll(async () => {
  net = await createNetworkDb();
  __setNetworkDbForTests(net.transport);
  member = await net.member('priya@example.com', { name: 'Priya Shah', rules: 'Happy to talk about hospitals.' });
});

afterAll(async () => {
  __setNetworkDbForTests(null);
  __setEmailTransportForTests(undefined);
  await net?.close();
});

describe('link tokens', () => {
  it('are 22-character base64url tokens derived per purpose and id; only their HMAC is stored', () => {
    const t = linkToken('offer', 'o_3Fp9kLm2Qx7a');
    expect(t && looksLikeToken(t)).toBe(true);
    expect(linkToken('offer', 'o_3Fp9kLm2Qx7a')).toBe(t);
    expect(linkToken('checkin', 'o_3Fp9kLm2Qx7a')).not.toBe(t);
    expect(linkToken('offer', 'o_3Fp9kLm2Qx7b')).not.toBe(t);
    expect(linkTokenHash('offer', 'o_3Fp9kLm2Qx7a')).toBe(hashToken('offer', t!));
    expect(linkTokenHash('offer', 'o_3Fp9kLm2Qx7a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the member footer points every link at this site, and one-click unsubscribe at /api/pause with the pause token', async () => {
    expect(await memberFooter(member)).toEqual({
      role: 'member',
      pause_url: 'http://localhost:3200/pause/PauseToken0123456789ab',
      rules_url: 'http://localhost:3200/me#settings',
      delete_url: 'http://localhost:3200/me#delete',
      unsubscribe_post_url: 'http://localhost:3200/api/pause?token=PauseToken0123456789ab',
    });
  });
});

describe('sendEmail', () => {
  it('without RESEND_API_KEY records “not sent: email not configured” and never reports a send', async () => {
    __setEmailTransportForTests(null);
    const res = await sendEmail({ key: 'offer:o_nokey000001', kind: 'offer', member_id: member, to: ['priya@example.com'], message });
    expect(res).toEqual({ status: 'not_sent', reason: 'not_configured', message: EMAIL_NOT_CONFIGURED });
    const row = await net.one<{ status: string; last_error: string; attempts: number }>(`select status, last_error, attempts from public.email_outbox where key = 'offer:o_nokey000001'`);
    expect(row).toEqual({ status: 'failed', last_error: EMAIL_NOT_CONFIGURED, attempts: 1 });
  });

  it('sends each key once: the outbox and Resend’s Idempotency-Key both carry offer:<id>, intro:<id>, checkin1:<id>, checkin14:<id>', async () => {
    const cap = captureEmails();
    __setEmailTransportForTests(cap.transport);
    const keys = ['offer:o_aaaaaa000001', 'intro:i_aaaaaa0001', 'checkin1:c_aaaaaa000001', 'checkin14:c_aaaaaa000002', 'withdrawn:o_aaaaaa000001', 'outcome:i_aaaaaa0001'];
    for (const key of keys) {
      const first = await sendEmail({ key, kind: key.startsWith('checkin') ? 'checkin' : key.startsWith('intro') ? 'intro' : key.startsWith('outcome') ? 'outcome_note' : key.startsWith('withdrawn') ? 'withdrawn' : 'offer', member_id: member, to: ['Priya@Example.com', 'priya@example.com'], message });
      expect(first).toMatchObject({ status: 'sent', repeated: false });
      const again = await sendEmail({ key, kind: 'offer', member_id: member, to: ['priya@example.com'], message });
      expect(again).toMatchObject({ status: 'sent', repeated: true });
    }
    expect(cap.sent.map((s) => s.key)).toEqual(keys);
    expect(cap.sent[0]!.to).toEqual(['priya@example.com']);
  });

  it('schedules a send that is due later (Resend scheduled send), and cancels a member’s check-ins on pause, everything on delete', async () => {
    const cap = captureEmails();
    __setEmailTransportForTests(cap.transport);
    const due = new Date(Date.now() + 24 * 3_600_000);
    const sched = await sendEmail({ key: 'checkin1:c_sched0000001', kind: 'checkin', member_id: member, to: ['priya@example.com'], message, send_at: due });
    expect(sched).toMatchObject({ status: 'scheduled' });
    expect(cap.sent[0]!.scheduledAt).toBe(due.toISOString());
    await sendEmail({ key: 'checkin14:c_sched0000002', kind: 'checkin', member_id: member, to: ['priya@example.com'], message, send_at: new Date(Date.now() + 14 * 24 * 3_600_000) });
    await sendEmail({ key: 'offer:o_sched0000001', kind: 'offer', member_id: member, to: ['priya@example.com'], message, send_at: due });

    const pause = await cancelMemberEmails(member, 'checkins');
    expect(pause).toEqual({ ok: true, cancelled: 2 });
    expect(cap.cancelled).toHaveLength(2);
    // A cancelled key is never sent again, by a retry or by the cron.
    const after = await sendEmail({ key: 'checkin1:c_sched0000001', kind: 'checkin', member_id: member, to: ['priya@example.com'], message, send_at: due });
    expect(after).toMatchObject({ status: 'not_sent', reason: 'cancelled' });
    const cancelledRow = await net.one<{ status: string }>(`select status from public.email_outbox where key = 'checkin14:c_sched0000002'`);
    expect(cancelledRow?.status).toBe('cancelled');
    const neverAgain = await sendEmail({ key: 'checkin14:c_sched0000002', kind: 'checkin', member_id: member, to: ['priya@example.com'], message, send_at: due });
    expect(neverAgain).toMatchObject({ status: 'not_sent', reason: 'cancelled' });

    // Delete cancels everything still unsent: the scheduled offer and the one that failed for lack of a key.
    const all = await cancelMemberEmails(member, 'all');
    expect(all).toEqual({ ok: true, cancelled: 2 });
    await cancelEmailKey('checkin1:c_none');
  });

  it('a retry after a timeout (same key, same body) is not a second email', async () => {
    let calls = 0;
    __setEmailTransportForTests({
      async send() {
        calls += 1;
        return calls === 1 ? { id: null, error: { name: 'application_error', message: 'timeout' } } : { id: null, error: { name: 'invalid_idempotent_request', message: 'already processed' } };
      },
      async cancel() {
        return { ok: true };
      },
    });
    const first = await sendEmail({ key: 'intro:i_retry00001', kind: 'intro', member_id: member, to: ['priya@example.com'], message });
    expect(first).toMatchObject({ status: 'not_sent', reason: 'failed' });
    const retry = await sendEmail({ key: 'intro:i_retry00001', kind: 'intro', member_id: member, to: ['priya@example.com'], message });
    expect(retry).toMatchObject({ status: 'sent', repeated: true });
  });
});

describe('without a database', () => {
  it('cancelMemberEmails says not_configured (nothing could have been scheduled)', async () => {
    __setNetworkDbForTests(null);
    expect(await cancelMemberEmails(member, 'all')).toEqual({ ok: false, reason: 'not_configured' });
    __setNetworkDbForTests(net.transport);
  });
});
