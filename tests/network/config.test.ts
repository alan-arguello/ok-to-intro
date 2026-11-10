import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The REAL network switches on only when every variable it needs is there (lib/env.ts parses the environment at
 * import, so each case loads the modules fresh). Members hear about offers by email and an intro is an email to both
 * people, so an instance that can't email says the network isn't set up rather than claiming an email went out.
 */

const KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TOKEN_HMAC_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const DB = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-for-tests',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
  TOKEN_HMAC_SECRET: 'test-token-hmac-secret-0123456789abcdef',
};
const EMAIL = { RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'OK to Intro <asks@mail.example.com>' };

async function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import('@/lib/server/audit');
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe('the REAL network switches on with its variables', () => {
  it('needs Supabase, the token secret and email', async () => {
    expect((await withEnv({})).networkConfigured()).toBe(false);
    expect((await withEnv(DB)).networkConfigured()).toBe(false);
    expect((await withEnv({ ...EMAIL })).networkConfigured()).toBe(false);
    expect((await withEnv({ ...DB, TOKEN_HMAC_SECRET: '', ...EMAIL })).networkConfigured()).toBe(false);
    expect((await withEnv({ ...DB, ...EMAIL })).networkConfigured()).toBe(true);
  });

  it('with a database but no email, every REAL path says “not set up” and reads nothing', async () => {
    await withEnv(DB);
    const asks = await import('@/lib/server/asks');
    const offers = await import('@/lib/server/offers');
    const checkins = await import('@/lib/server/checkins');
    const dispatch = await import('@/lib/server/dispatch');
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'maya@example.com' };
    expect(await asks.canAskReal(user)).toEqual({ allowed: false, reason: 'not_configured' });
    expect(await asks.listMyAsks(user)).toEqual({ ok: false, reason: 'not_configured' });
    expect(await asks.getAskerView('a_91xQr2', user)).toEqual({ ok: false, reason: 'not_configured' });
    expect(await offers.getOffer({ token: 'A'.repeat(22) })).toEqual({ found: false, reason: 'not_configured' });
    expect(await offers.respondToOffer({ token: 'A'.repeat(22) }, 'ok', { idempotency_key: 'k' })).toEqual({ ok: false, reason: 'not_configured' });
    expect(await offers.listPendingForMember(user.id)).toEqual({ ok: false, reason: 'not_configured' });
    expect(await checkins.getCheckin({ token: 'A'.repeat(22) })).toEqual({ found: false, reason: 'not_configured' });
    const send = await dispatch.startSend('a_91xQr2', user, { clientKey: null });
    expect(send).toMatchObject({ ok: false, status: 503, body: { error: 'not_configured' } });
    if (!send.ok) expect(send.body.message).toContain('Nothing was sent to anyone.');
  });
});
