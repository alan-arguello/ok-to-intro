/**
 * Email-code sign-in through the REAL @supabase/ssr server client and auth-js (nothing of supabase-js is mocked),
 * against a small fake of Supabase Auth (GoTrue) on `fetch`. It proves what unit fakes can't:
 * - signInWithOtp asks GoTrue for a code (POST /otp, create_user, no redirect_to): never a magic link;
 * - a wrong code is rejected without a session, and Supabase's “after N seconds” answer reads as “code just sent”;
 * - verifyOtp writes the session cookies through the cookie adapter (what a server action's cookies().set gets),
 *   getUser on the same client reads the VERIFIED user, and the next request's client finds the session in them;
 * - the members row is created from that verified user, with the playground rules, in the real migration (PGlite).
 */
import { createServerClient } from '@supabase/ssr';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/harness';
import { FakeSupabase } from './fake-supabase';

const h = vi.hoisted(() => {
  process.env.TOKEN_HMAC_SECRET = 'test-token-secret-0123456789abcdef-0123456789';
  process.env.RATE_LIMIT_SALT_SECRET = 'test-rate-salt-0123456789abcdef';
  return { client: null as unknown };
});

vi.mock('@/lib/supabase/admin', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/supabase/admin')>();
  return { ...real, getAdminClient: () => (h.client ? { ok: true, client: h.client } : { ok: false, reason: 'not_configured', missing: [] }) };
});
vi.mock('@/lib/server/audit', () => ({ recordAudit: async () => undefined }));
vi.mock('@/lib/server/email-send', () => ({ cancelMemberEmails: async () => ({ ok: true, cancelled: 0 }) }));

import { __resetOtpMemoryForTests, getMemberProfile, requestSignInCode, verifySignInCode } from '@/lib/server/member';
import { presetById } from '@/lib/sample/presets';

const SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const COOKIE_RE = /^sb-abcdefghijklmnopqrst-auth-token(\.\d+)?$/;
const CODE = '482913';
const ENGINEER = presetById('engineer').rules;

type Call = { method: string; path: string; search: string; body: Record<string, unknown> | null; auth: string | null };

/** The slice of GoTrue the sign-in uses: /otp, /verify, /user. */
function fakeGoTrue(user: { id: string; email: string }, otp: { status: number; body: unknown } | null = null) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, search: url.search, body, auth: headers.get('authorization') });
    if (url.pathname === '/auth/v1/otp') return otp ? json(otp.status, otp.body) : json(200, {});
    if (url.pathname === '/auth/v1/verify') {
      if (body?.token !== CODE || body?.type !== 'email') return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      const now = Math.floor(Date.now() / 1000);
      return json(200, {
        access_token: 'at-verified',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: 'rt-verified',
        user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: new Date().toISOString() },
      });
    }
    if (url.pathname === '/auth/v1/user') {
      if (headers.get('authorization') !== 'Bearer at-verified') return json(401, { code: 401, error_code: 'no_authorization', msg: 'This endpoint requires a valid Bearer token' });
      return json(200, { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
    }
    return json(404, { msg: 'not found' });
  };
  return { calls, fetch: fetchImpl as typeof fetch };
}

/** A request's server client over a cookie jar (lib/supabase/server.ts does the same with next/headers cookies()). */
function serverClient(jar: Map<string, string>, fetchImpl: typeof fetch) {
  return createServerClient(SUPABASE_URL, 'anon-key-for-tests', {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          if (c.value) jar.set(c.name, c.value);
          else jar.delete(c.name);
        }
      },
    },
    global: { fetch: fetchImpl },
  });
}

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  h.client = new FakeSupabase(db);
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  __resetOtpMemoryForTests();
});

describe('email-code sign-in through supabase-js', () => {
  it('asks for a code, rejects a wrong one, signs in with the right one and creates the member from the verified user', async () => {
    const mail = 'priya.otp@example.invalid';
    const id = await db.createUser(mail);
    const gotrue = fakeGoTrue({ id, email: mail });
    const jar = new Map<string, string>();
    const client = serverClient(jar, gotrue.fetch);

    // 1. Send: a 6-digit code, never a link (no redirect_to), new users created.
    const sent = await requestSignInCode(client.auth, { email: ' Priya.OTP@Example.invalid ', ip: '203.0.113.20' });
    expect(sent).toMatchObject({ ok: true, resend_in_s: 60 });
    const otp = gotrue.calls.find((c) => c.path === '/auth/v1/otp');
    expect(otp?.method).toBe('POST');
    expect(otp?.body).toMatchObject({ email: mail, create_user: true });
    expect(otp?.search).not.toMatch(/redirect_to/);
    expect(JSON.stringify(otp?.body)).not.toMatch(/redirect/);

    // 2. A wrong code: rejected, tries counted, no session cookie written.
    const wrong = await verifySignInCode(client.auth, { email: mail, code: '000000', sent_at: Date.now(), carried: null, next: null, ip: '203.0.113.20' });
    expect(wrong).toMatchObject({ ok: false, error: 'rejected', tries_left: 4 });
    expect([...jar.keys()].filter((k) => COOKIE_RE.test(k))).toEqual([]);

    // 3. The right code: session cookies set on this response, the members row from the verified user, rules saved.
    const ok = await verifySignInCode(client.auth, { email: mail, code: CODE, sent_at: Date.now(), carried: { rules: ENGINEER, cap: 3 }, next: null, ip: '203.0.113.20' });
    expect(ok).toEqual({ ok: true, next: '/me?first=1', created: true });
    expect([...jar.keys()].some((k) => COOKIE_RE.test(k))).toBe(true);
    const verify = gotrue.calls.find((c) => c.path === '/auth/v1/verify' && c.body?.token === CODE);
    expect(verify?.body).toMatchObject({ email: mail, token: CODE, type: 'email' });
    // getUser asked Auth with the new session's token (the verified user, not anything the browser sent).
    expect(gotrue.calls.some((c) => c.path === '/auth/v1/user' && c.auth === 'Bearer at-verified')).toBe(true);
    const profile = await getMemberProfile(id);
    expect(profile.ok && profile.member).toMatchObject({ email: mail, status: 'pending', rules: ENGINEER, cap: 3, rules_version: 1 });

    // 4. The next request (/me) builds a new client from those cookies and is signed in as the same person.
    const next = serverClient(new Map(jar), gotrue.fetch);
    const me = await next.auth.getUser();
    expect(me.error).toBeNull();
    expect(me.data.user).toMatchObject({ id, email: mail });
  });

  it('reads Supabase’s once-a-minute answer as “a code was just sent” and an outage as down', async () => {
    const id = await db.createUser('maya.otp@example.invalid');
    const recent = fakeGoTrue(
      { id, email: 'maya.otp@example.invalid' },
      { status: 429, body: { code: 429, error_code: 'over_email_send_rate_limit', msg: 'For security purposes, you can only request this after 42 seconds.' } },
    );
    expect(await requestSignInCode(serverClient(new Map(), recent.fetch).auth, { email: 'maya.otp@example.invalid', ip: null })).toMatchObject({ ok: true, resend_in_s: 42 });

    const team = fakeGoTrue({ id, email: 'maya.otp@example.invalid' }, { status: 400, body: { code: 400, error_code: 'email_address_not_authorized', msg: 'Email address not authorized' } });
    expect(await requestSignInCode(serverClient(new Map(), team.fetch).auth, { email: 'maya.otp@example.invalid', ip: null })).toMatchObject({ ok: false, error: 'not_authorized' });

    const down = fakeGoTrue({ id, email: 'maya.otp@example.invalid' }, { status: 503, body: { msg: 'upstream' } });
    expect(await requestSignInCode(serverClient(new Map(), down.fetch).auth, { email: 'maya.otp@example.invalid', ip: null })).toMatchObject({ ok: false, error: 'down' });
  });
});
