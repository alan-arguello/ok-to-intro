/**
 * S3 server actions (/join, /me) and the /me loader, with Supabase, BE2 and Next's request APIs stubbed: who the
 * member is always comes from the verified session, signed-out calls change nothing, results are small UI shapes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  userReason: 'signed_out' as 'signed_out' | 'error' | 'not_configured',
  cookies: new Map<string, string>(),
  refreshed: 0,
  calls: [] as { fn: string; args: unknown[] }[],
  signOut: 0,
  headers: new Map<string, string>([['x-forwarded-for', '203.0.113.7, 10.0.0.1']]),
}));

vi.mock('next/cache', () => ({ refresh: () => void h.refreshed++ }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => h.headers.get(k.toLowerCase()) ?? null }),
  cookies: async () => ({
    getAll: () => [...h.cookies].map(([name, value]) => ({ name, value })),
    delete: (name: string) => void h.cookies.delete(name),
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getUser: async () => (h.user ? { ok: true, user: h.user } : { ok: false, reason: h.userReason }),
  getServerClient: async () => ({ ok: true, client: { auth: { signOut: async () => void h.signOut++ } } }),
}));
vi.mock('@/lib/server/member', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/member')>();
  const record =
    (fn: string, result: unknown) =>
    async (...args: unknown[]) => {
      h.calls.push({ fn, args });
      return result;
    };
  return {
    ...real,
    saveMemberSettings: async (...args: unknown[]) => {
      h.calls.push({ fn: 'saveMemberSettings', args });
      const input = args[1] as { rules: string };
      return { ok: true, version: input.rules.includes('new') ? 4 : 3, saved_at: '2026-11-09T20:00:00.000Z', rules_changed: input.rules.includes('new'), status: 'on' };
    },
    turnOnGate: record('turnOnGate', { ok: true, version: 1, saved_at: '2026-11-09T20:00:00.000Z', rules_changed: true, status: 'on' }),
    pauseMember: async (...args: unknown[]) => {
      h.calls.push({ fn: 'pauseMember', args });
      return { ok: true, paused_until: args[1] };
    },
    resumeMember: record('resumeMember', { ok: true }),
    deleteMember: record('deleteMember', { ok: true }),
    requestSignInCode: record('requestSignInCode', { ok: true, sent_at: 1, resend_in_s: 60 }),
    verifySignInCode: record('verifySignInCode', { ok: true, next: '/me?first=1', created: true }),
    getMemberProfile: async () => ({
      ok: true,
      member: {
        id: 'u1',
        email: 'priya@example.invalid',
        name: 'Priya Shah',
        one_line: '',
        company: 'Oakline Health',
        stage: 'Seed',
        city: '',
        scheduling_url: null,
        cap: 2,
        show_matched: false,
        accept_guests: false,
        status: 'on',
        paused_until: null,
        rules: 'Happy to help with Postgres.\nNo fundraising asks.',
        rules_version: 2,
        rules_saved_at: '2026-11-09T17:04:00.000Z',
        created_at: '2026-11-01T02:00:00.000Z',
      },
    }),
    getRulesSource: async () => 'playground',
    getCapUsed: async () => ({ ok: true, used: 1, month: '2026-11-01' }),
    getMonthLedger: async () => ({
      ok: true,
      ledger: {
        month: '2026-11-01',
        reached_gate: 3,
        reached_you: 1,
        declined: 2,
        failed: 0,
        no_line: 1,
        old_lines: 0,
        tallies: ['1 let in', '1 kept out'],
        // “Postgres” in 'Happy to help with Postgres.\nNo fundraising asks.' (offsets into the current rules)
        ranges: [{ start: 19, end: 27 }],
        example: 'Postgres',
      },
    }),
  };
});
vi.mock('@/lib/server/api-tokens', () => ({
  createApiToken: async () => ({ ok: true, token: 'oti_AAAAAAAAAAAAAAAAAAAAAA', created_at: '2026-11-09T20:00:00.000Z' }),
  revokeApiToken: async () => ({ ok: true, revoked_at: '2026-11-09T20:00:00.000Z' }),
  getApiTokenStatus: async () => ({ ok: true, status: { state: 'active', created_at: '2026-11-09T12:00:00.000Z', last_used_at: '2026-11-09T17:04:00.000Z', last_used_from: 'claude_code' } }),
}));
vi.mock('@/lib/server/offers', () => ({
  listPendingForMember: async () => ({
    ok: true,
    pending: {
      offers: [{ offer_id: 'o_3Fp9kL', title: 'Enterprise deals stuck 5 months', asker: { name: 'Maya Bennett', first: 'Maya', company: 'Oakline Health', stage: 'Seed', city: 'Chicago' }, matched: null, facts: [], ask_text: '', expires_at: '2026-11-12T05:04:00.000Z' }],
      questions: [],
      checkins: [],
      cap: { cap: 2, used: 1, month: '2026-11-01' },
    },
  }),
}));
vi.mock('@/lib/server/asks', () => ({
  listMyAsks: async () => ({ ok: true, items: [{ id: 'a_91xQ2k', subject: 'Churn after month 3', network: 'real', outcome: 'offered', status_line: '', created_at: '2026-11-09T05:04:00.000Z' }] }),
}));

import { sendCode, verifyCode } from '@/app/(site)/join/actions';
import { createTokenAction, deleteAction, pauseAction, resumeAction, saveSettingsAction, turnOnAction } from '@/app/(site)/me/actions';
import { loadMe } from '@/app/(site)/me/load';

const settings = { name: 'Priya Shah', one_line: '', company: '', stage: '', city: '', scheduling_url: '', cap: 2, show_matched: false, rules: 'Happy to help.' };

beforeEach(() => {
  h.user = null;
  h.userReason = 'signed_out';
  h.refreshed = 0;
  h.calls.length = 0;
  h.signOut = 0;
  h.cookies = new Map([
    ['sb-abcd-auth-token.0', 'x'],
    ['sb-abcd-auth-token.1', 'y'],
    ['sb-abcd-auth-token-code-verifier', 'z'],
    ['other', 'keep'],
  ]);
});

describe('/me actions', () => {
  it('do nothing when signed out', async () => {
    expect(await saveSettingsAction(settings)).toEqual({ ok: false, reason: 'signed_out' });
    expect(await turnOnAction(settings)).toEqual({ ok: false, reason: 'signed_out' });
    expect(await pauseAction('month')).toEqual({ ok: false, reason: 'signed_out' });
    expect(await resumeAction()).toEqual({ ok: false, reason: 'signed_out' });
    expect(await createTokenAction()).toEqual({ ok: false, reason: 'signed_out' });
    expect(await deleteAction()).toEqual({ ok: false, reason: 'signed_out' });
    expect(h.calls).toEqual([]);
  });

  it('act for the session’s member only, and re-render the page when rules changed', async () => {
    h.user = { id: 'u1', email: 'priya@example.invalid' };
    expect(await saveSettingsAction(settings)).toMatchObject({ ok: true, version: 3, rules_changed: false });
    expect(h.refreshed).toBe(0);
    expect(await saveSettingsAction({ ...settings, rules: 'Happy to help, new line.' })).toMatchObject({ ok: true, version: 4 });
    expect(h.refreshed).toBe(1);
    expect(h.calls[0]).toEqual({ fn: 'saveMemberSettings', args: ['u1', settings, { requireName: true }] });
    expect(await turnOnAction(settings)).toMatchObject({ ok: true });
    expect(h.calls.at(-1)).toEqual({ fn: 'turnOnGate', args: [h.user, settings] });
  });

  it('pause takes a choice, never a date from the browser', async () => {
    h.user = { id: 'u1', email: 'priya@example.invalid' };
    expect(await pauseAction('2099-01-01' as 'month')).toEqual({ ok: false, reason: 'bad_input' });
    const res = await pauseAction('month');
    expect(res.ok).toBe(true);
    const until = h.calls.at(-1)?.args[1] as string;
    expect(Date.parse(until)).toBeGreaterThan(Date.now());
    await pauseAction('off');
    expect(h.calls.at(-1)?.args[1]).toBeNull();
  });

  it('delete signs this browser out and clears the session cookies, nothing else', async () => {
    h.user = { id: 'u1', email: 'priya@example.invalid' };
    expect(await deleteAction()).toEqual({ ok: true });
    expect(h.calls.at(-1)).toEqual({ fn: 'deleteMember', args: ['u1'] });
    expect(h.signOut).toBe(1);
    expect([...h.cookies.keys()]).toEqual(['other']);
  });
});

describe('/join actions', () => {
  it('pass the first forwarded address (for HMAC’d limits) and never trust a browser-sent identity', async () => {
    await sendCode({ email: 'priya@example.invalid' });
    expect(h.calls[0]?.args[1]).toEqual({ email: 'priya@example.invalid', ip: '203.0.113.7' });
    await verifyCode({ email: 'priya@example.invalid', code: '482913', sent_at: 1, carried: { rules: 'x', cap: 2 }, next: '/me' });
    expect(h.calls[1]?.args[1]).toEqual({ email: 'priya@example.invalid', code: '482913', sent_at: 1, carried: { rules: 'x', cap: 2 }, next: '/me', ip: '203.0.113.7' });
    // Vercel's own header wins over X-Forwarded-For (BE1's clientIp), and junk never becomes a key.
    h.headers.set('x-vercel-forwarded-for', '198.51.100.4');
    await sendCode({ email: 'priya@example.invalid' });
    expect(h.calls[2]?.args[1]).toMatchObject({ ip: '198.51.100.4' });
    h.headers = new Map([['x-forwarded-for', '<script>']]);
    await sendCode({ email: 'priya@example.invalid' });
    expect(h.calls[3]?.args[1]).toMatchObject({ ip: null });
    h.headers = new Map([['x-forwarded-for', '203.0.113.7, 10.0.0.1']]);
  });
});

describe('/me loader', () => {
  it('maps the member, ledger, token, the waiting offer and the asks into the view’s shape', async () => {
    const now = new Date('2026-11-09T18:15:00.000Z');
    const res = await loadMe({ id: 'u1', email: 'priya@example.invalid' }, now, { first: false, carried: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const i = res.initial;
    expect(i).toMatchObject({ mode: 'real', status: 'on', capUsed: 1, month: '2026-11-01', rulesVersion: 2, rulesSourceLabel: 'From the playground', exportHref: '/me/export' });
    expect(i.saved).toEqual({ iso: '2026-11-09T17:04:00.000Z', label: '09:04', fmt: 'clock' });
    expect(i.ledger?.lines).toEqual([
      { text: 'Happy to help with Postgres.', tally: '1 let in' },
      { text: 'No fundraising asks.', tally: '1 kept out' },
    ]);
    expect(i.ledger?.quotes).toEqual(['Postgres']);
    expect(i.pending).toEqual({ title: 'Enterprise deals stuck 5 months', from: 'Maya Bennett', hoursLeft: 58, href: '/o/o_3Fp9kL' });
    expect(i.token).toEqual({ state: 'active', created: { iso: '2026-11-09T12:00:00.000Z', label: 'Nov 9', fmt: 'day' }, lastUsed: { iso: '2026-11-09T17:04:00.000Z', label: '09:04', fmt: 'last' } });
    expect(i.asks).toEqual({ state: 'ok', example: false, items: [{ id: 'a_91xQ2k', subject: 'Churn after month 3', outcome: 'offered', created: { iso: '2026-11-09T05:04:00.000Z', label: 'Nov 8', fmt: 'day' }, href: '/ask/a_91xQ2k' }] });
  });
});
