/**
 * S3 server functions (lib/server/member.ts, lib/server/api-tokens.ts) against the real migration in PGlite, through
 * a supabase-js stand-in that runs every statement as service_role (tests/member/fake-supabase.ts).
 * BE2's recordAudit and cancelMemberEmails are spies here, so these tests don't depend on BE2's implementation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/harness';
import { FakeSupabase } from './fake-supabase';

const h = vi.hoisted(() => {
  process.env.TOKEN_HMAC_SECRET = 'test-token-secret-0123456789abcdef-0123456789';
  process.env.RATE_LIMIT_SALT_SECRET = 'test-rate-salt-0123456789abcdef';
  return {
    client: null as unknown,
    configured: true,
    audit: [] as { action: string; input: Record<string, unknown> }[],
    cancelled: [] as { memberId: string; scope: string }[],
  };
});

vi.mock('@/lib/supabase/admin', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/supabase/admin')>();
  return {
    ...real,
    getAdminClient: () => (h.configured && h.client ? { ok: true, client: h.client } : { ok: false, reason: 'not_configured', missing: ['SUPABASE_SERVICE_ROLE_KEY'] }),
  };
});
vi.mock('@/lib/server/audit', () => ({
  recordAudit: async (action: string, input: Record<string, unknown> = {}) => {
    h.audit.push({ action, input });
  },
}));
vi.mock('@/lib/server/email-send', () => ({
  cancelMemberEmails: async (memberId: string, scope = 'all') => {
    h.cancelled.push({ memberId, scope });
    return { ok: true, cancelled: 0 };
  },
}));

import { createApiToken, getApiTokenStatus, parseBearer, revokeApiToken, verifyApiToken } from '@/lib/server/api-tokens';
import {
  __resetOtpMemoryForTests,
  appendRuleLine,
  buildLedger,
  createPauseLink,
  deleteMember,
  ensureMemberRow,
  exportMemberData,
  getMemberProfile,
  getMonthLedger,
  getPauseLinkView,
  normalizeRules,
  pauseByToken,
  pauseMember,
  requestSignInCode,
  resumeMember,
  safeNext,
  saveMemberSettings,
  saveRules,
  setCap,
  turnOnGate,
  undoPauseByToken,
  verifySignInCode,
  type OtpAuthClient,
} from '@/lib/server/member';
import { capMonth } from '@/lib/oti/time';
import { presetById } from '@/lib/sample/presets';

let db: TestDb;
let fake: FakeSupabase;
let n = 0;
const email = (tag: string) => `${tag}-${++n}@example.invalid`;
const ENGINEER = presetById('engineer').rules;
const HEALTH = presetById('health').rules;

beforeAll(async () => {
  db = await createTestDb();
  fake = new FakeSupabase(db);
  h.client = fake;
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  h.configured = true;
  fake.down = false;
  h.audit.length = 0;
  h.cancelled.length = 0;
  __resetOtpMemoryForTests();
});

async function memberRow(id: string) {
  const r = await db.pg.query<{ status: string; paused_until: Date | null; cap: number; name: string }>('select status, paused_until, cap, name from public.members where id = $1', [id]);
  return r.rows[0];
}

describe('not configured and database down', () => {
  it('reports not_configured without the service role, and never throws', async () => {
    h.configured = false;
    expect(await getMemberProfile('00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, reason: 'not_configured' });
    expect(await saveRules('00000000-0000-4000-8000-000000000000', 'x', 'web')).toEqual({ ok: false, reason: 'not_configured' });
    expect(await pauseByToken('A'.repeat(22), null)).toEqual({ ok: false, reason: 'not_configured' });
    expect(await createPauseLink('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await verifyApiToken(`Bearer oti_${'a'.repeat(22)}`)).toBeNull();
  });

  it('reports db_down when the database is unreachable', async () => {
    const id = await db.createMember(email('down'), { rules: ENGINEER });
    fake.down = true;
    expect(await getMemberProfile(id)).toEqual({ ok: false, reason: 'db_down' });
    expect(await saveRules(id, HEALTH, 'web')).toEqual({ ok: false, reason: 'db_down' });
    expect(await setCap(id, 3)).toEqual({ ok: false, reason: 'db_down' });
    expect(await deleteMember(id)).toEqual({ ok: false, reason: 'db_down' });
  });
});

describe('profile', () => {
  it('is null for a signed-in person without a members row, and a full profile with rules otherwise', async () => {
    expect(await getMemberProfile('00000000-0000-4000-8000-000000000000')).toEqual({ ok: true, member: null });
    expect(await getMemberProfile('not-a-uuid')).toEqual({ ok: true, member: null });
    const id = await db.createMember(email('priya'), { rules: HEALTH, cap: 2 });
    const res = await getMemberProfile(id);
    expect(res.ok && res.member).toMatchObject({ id, status: 'on', rules: HEALTH, rules_version: 1, cap: 2, company: '', one_line: '' });
  });

  it('reads a timed pause that has ended as on', async () => {
    const id = await db.createMember(email('ended'), { rules: ENGINEER });
    await db.pg.query(`update public.members set status = 'paused', paused_until = now() - interval '1 hour' where id = $1`, [id]);
    const res = await getMemberProfile(id);
    expect(res.ok && res.member).toMatchObject({ status: 'on', paused_until: null });
  });
});

describe('rules', () => {
  it('saves versions, skips identical text, and audits', async () => {
    const id = await db.createMember(email('rules'));
    expect(await saveRules(id, ENGINEER, 'web')).toEqual({ ok: true, version: 1 });
    expect(await saveRules(id, `${ENGINEER}\r\n`, 'web')).toEqual({ ok: true, version: 1 });
    expect(await saveRules(id, HEALTH, 'mcp')).toEqual({ ok: true, version: 2 });
    expect(h.audit.filter((a) => a.action === 'rules_saved').map((a) => a.input.detail)).toEqual([
      { version: 1, source: 'web' },
      { version: 2, source: 'mcp' },
    ]);
    const versions = await db.pg.query<{ version: number; source: string }>('select version, source from public.rule_versions where member_id = $1 order by version', [id]);
    expect(versions.rows).toEqual([
      { version: 1, source: 'web' },
      { version: 2, source: 'mcp' },
    ]);
  });

  it('rejects empty and too-long rules, unknown members and unknown sources', async () => {
    const id = await db.createMember(email('bad'));
    expect(await saveRules(id, '   \n  ', 'web')).toMatchObject({ ok: false, reason: 'bad_input' });
    expect(await saveRules(id, 'x'.repeat(1001), 'web')).toMatchObject({ ok: false, reason: 'bad_input' });
    expect(await saveRules('00000000-0000-4000-8000-000000000001', ENGINEER, 'web')).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await saveRules(id, ENGINEER, 'nope' as 'web')).toMatchObject({ ok: false, reason: 'bad_input' });
    expect(normalizeRules('a\r\nb  \n\n')).toBe('a\nb');
  });

  it('appends one line, treats a normalized duplicate as a no-op, and refuses to pass 1,000 characters', async () => {
    const id = await db.createMember(email('append'), { rules: ENGINEER });
    expect(await appendRuleLine(id, 'No asks from health companies.')).toEqual({ ok: true, version: 2 });
    expect(await appendRuleLine(id, '  no asks from  health companies  ')).toEqual({ ok: true, version: 2 });
    const r = await db.pg.query<{ text: string }>('select text from public.rules where member_id = $1', [id]);
    expect(r.rows[0]?.text).toBe(`${ENGINEER}\nNo asks from health companies.`);
    const long = await db.createMember(email('long'), { rules: 'y'.repeat(990) });
    expect(await appendRuleLine(long, 'No asks about hiring.')).toMatchObject({ ok: false, reason: 'bad_input' });
  });
});

describe('cap, pause and resume', () => {
  it('sets the cap within 1–5', async () => {
    const id = await db.createMember(email('cap'), { rules: ENGINEER });
    expect(await setCap(id, 4)).toEqual({ ok: true });
    expect((await memberRow(id))?.cap).toBe(4);
    for (const bad of [0, 6, 2.5]) expect(await setCap(id, bad)).toEqual({ ok: false, reason: 'bad_input' });
    expect(await setCap('00000000-0000-4000-8000-000000000002', 2)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('pauses until a date or until turned back on, and resumes; a gate that isn’t on can’t pause', async () => {
    const id = await db.createMember(email('pause'), { rules: ENGINEER });
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect(await pauseMember(id, until)).toEqual({ ok: true, paused_until: until });
    expect((await memberRow(id))?.status).toBe('paused');
    expect(await pauseMember(id, null, { stopEmails: true })).toEqual({ ok: true, paused_until: null });
    expect(h.cancelled).toEqual([{ memberId: id, scope: 'checkins' }]);
    expect(await pauseMember(id, new Date(Date.now() - 1000).toISOString())).toEqual({ ok: false, reason: 'bad_input' });
    expect(await resumeMember(id)).toEqual({ ok: true });
    expect(await memberRow(id)).toMatchObject({ status: 'on', paused_until: null });
    const pending = await db.createMember(email('pending'), { status: 'pending' });
    expect(await pauseMember(pending, null)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(h.audit.map((a) => a.action)).toEqual(['member_paused', 'member_paused', 'member_resumed']);
  });
});

describe('pause links', () => {
  const tokenOf = (url: string) => url.split('/pause/')[1] as string;

  it('pauses without sign-in, shows Undo for 24 hours, and Undo restores the state before', async () => {
    const id = await db.createMember(email('link'), { rules: ENGINEER });
    await db.pg.query(`update public.members set name = 'Priya Shah' where id = $1`, [id]);
    const url = await createPauseLink(id);
    expect(url).toMatch(/^http:\/\/localhost:3200\/pause\/[A-Za-z0-9_-]{22}$/);
    const token = tokenOf(url as string);
    const stored = await db.pg.query<{ token_hash: string }>('select token_hash from public.pause_tokens where member_id = $1', [id]);
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.token_hash).not.toContain(token);

    const view = await getPauseLinkView(token);
    expect(view).toEqual({ ok: true, view: { member_name: 'Priya Shah', cap: 2, status: 'on', paused_until: null, can_undo: false } });

    const until = new Date(Date.now() + 14 * 86_400_000).toISOString();
    expect(await pauseByToken(token, until)).toEqual({ ok: true, paused_until: until });
    // A repeated POST keeps the state from before the first pause.
    expect(await pauseByToken(token, until)).toEqual({ ok: true, paused_until: until });
    const after = await getPauseLinkView(token);
    expect(after.ok && after.view).toMatchObject({ status: 'paused', can_undo: true });

    expect(await undoPauseByToken(token)).toEqual({ ok: true, status: 'on', paused_until: null });
    expect(await memberRow(id)).toMatchObject({ status: 'on', paused_until: null });
    expect(await undoPauseByToken(token)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('can’t undo after 24 hours, or after the member paused or resumed elsewhere', async () => {
    const id = await db.createMember(email('stale'), { rules: ENGINEER });
    const token = tokenOf((await createPauseLink(id)) as string);
    await pauseByToken(token, null, { stopEmails: true });
    expect(h.cancelled).toEqual([{ memberId: id, scope: 'checkins' }]);
    await db.pg.query(`update public.pause_tokens set paused_at = now() - interval '25 hours' where member_id = $1`, [id]);
    expect(await undoPauseByToken(token)).toEqual({ ok: false, reason: 'invalid' });

    const other = await db.createMember(email('elsewhere'), { rules: ENGINEER });
    const t2 = tokenOf((await createPauseLink(other)) as string);
    await pauseByToken(t2, null);
    await resumeMember(other);
    await pauseMember(other, null);
    expect(await undoPauseByToken(t2)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects unknown and malformed tokens', async () => {
    expect(await pauseByToken('A'.repeat(22), null)).toEqual({ ok: false, reason: 'invalid' });
    expect(await pauseByToken('short', null)).toEqual({ ok: false, reason: 'invalid' });
    expect(await getPauseLinkView('B'.repeat(22))).toEqual({ ok: false, reason: 'invalid' });
    expect(await undoPauseByToken('../etc')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('join, settings, turning on, delete', () => {
  it('creates the members row once, from the verified email, lower-cased', async () => {
    const mail = email('Join').toUpperCase();
    const id = await db.createUser(mail);
    const first = await ensureMemberRow({ id, email: mail });
    expect(first.ok && first.created).toBe(true);
    expect(first.ok && first.row.email).toBe(mail.toLowerCase());
    const again = await ensureMemberRow({ id, email: mail });
    expect(again.ok && again.created).toBe(false);
    expect(h.audit.map((a) => a.action)).toEqual(['member_joined']);
  });

  it('saves settings and makes a rules version only when the text changed', async () => {
    const id = await db.createMember(email('settings'), { rules: HEALTH });
    const base = { name: 'Priya Shah', one_line: 'Ran procurement for a public hospital network in Illinois.', company: 'Oakline Health', stage: 'Seed', city: 'Chicago', scheduling_url: 'https://cal.com/priya-shah/20min', cap: 3, show_matched: true, rules: HEALTH };
    const a = await saveMemberSettings(id, base);
    expect(a).toMatchObject({ ok: true, version: 1, rules_changed: false, status: 'on' });
    const b = await saveMemberSettings(id, { ...base, rules: `${HEALTH}\nNo asks about hiring.` });
    expect(b).toMatchObject({ ok: true, version: 2, rules_changed: true });
    const res = await getMemberProfile(id);
    expect(res.ok && res.member).toMatchObject({ name: 'Priya Shah', company: 'Oakline Health', cap: 3, show_matched: true, scheduling_url: 'https://cal.com/priya-shah/20min' });
    expect(await saveMemberSettings(id, { ...base, scheduling_url: 'http://cal.com/x' })).toMatchObject({ ok: false, field: 'scheduling_url' });
    expect(await saveMemberSettings(id, { ...base, cap: 9 })).toMatchObject({ ok: false, field: 'cap' });
    expect(await saveMemberSettings(id, { ...base, rules: ' ' })).toMatchObject({ ok: false, field: 'rules' });
    expect(await saveMemberSettings(id, { ...base, scheduling_url: '' })).toMatchObject({ ok: true });
    expect((await getMemberProfile(id)).ok).toBe(true);
  });

  it('turns the gate on for a first visit, creating the row if verify didn’t', async () => {
    const mail = email('first');
    const id = await db.createUser(mail);
    const input = { name: '', one_line: '', company: '', stage: '', city: '', scheduling_url: '', cap: 2, show_matched: false, rules: ENGINEER };
    expect(await turnOnGate({ id, email: mail }, input)).toMatchObject({ ok: false, field: 'name' });
    const on = await turnOnGate({ id, email: mail }, { ...input, name: 'Marcus Reed' });
    expect(on).toMatchObject({ ok: true, version: 1, status: 'on' });
    expect(h.audit.map((a) => a.action)).toEqual(['member_joined', 'rules_saved', 'member_gate_on']);
  });

  it('deletes everything: emails cancelled first, rows cascade, the audit fact has no id', async () => {
    const id = await db.createMember(email('delete'), { rules: ENGINEER });
    await createPauseLink(id);
    await createApiToken(id);
    h.audit.length = 0;
    expect(await deleteMember(id)).toEqual({ ok: true });
    expect(h.cancelled).toEqual([{ memberId: id, scope: 'all' }]);
    expect(h.audit).toEqual([{ action: 'member_deleted', input: { detail: { via: 'web' } } }]);
    for (const table of ['members', 'rules', 'rule_versions', 'pause_tokens', 'api_tokens']) {
      const col = table === 'members' ? 'id' : 'member_id';
      const r = await db.pg.query(`select 1 from public.${table} where ${col} = $1`, [id]);
      expect(r.rows, table).toHaveLength(0);
    }
    expect(await getMemberProfile(id)).toEqual({ ok: true, member: null });
  });
});

describe('the monthly ledger', () => {
  const at = (iso: string) => iso;
  const cited = (...texts: string[]) => texts.map((t) => ({ text: t, found: true }));

  it('tallies the final decision per ask on the current rules lines', () => {
    const rules = HEALTH;
    const decisions = [
      { ask_id: 'a1', attempt: 1, verdict: 'ask_back' as const, cited: cited('B2B founders selling to public hospitals or insurers in the US or Canada', 'have a price'), created_at: at('2026-11-02T12:00:00Z') },
      { ask_id: 'a1', attempt: 2, verdict: 'accept' as const, cited: cited('B2B founders selling to public hospitals or insurers in the US or Canada', 'talked to 10+ buyers and have a price'), created_at: at('2026-11-02T13:00:00Z') },
      { ask_id: 'a2', attempt: 1, verdict: 'ask_back' as const, cited: cited('talked to 10+ buyers'), created_at: at('2026-11-03T12:00:00Z') },
      { ask_id: 'a3', attempt: 1, verdict: 'decline' as const, cited: cited('No asks to review a deck.'), created_at: at('2026-11-04T12:00:00Z') },
      { ask_id: 'a4', attempt: 1, verdict: 'decline' as const, cited: [], created_at: at('2026-11-05T12:00:00Z') },
      { ask_id: 'a5', attempt: 1, verdict: 'decline' as const, cited: [{ text: 'Happy to take any intro', found: false }], created_at: at('2026-11-05T13:00:00Z') },
      { ask_id: 'a6', attempt: 1, verdict: null, cited: [], created_at: at('2026-11-06T12:00:00Z') },
      { ask_id: 'a7', attempt: 1, verdict: 'decline' as const, cited: cited('No asks about crypto.'), created_at: at('2026-11-07T12:00:00Z') },
    ];
    const l = buildLedger(rules, decisions, 1, '2026-11-01');
    expect(l).toMatchObject({ reached_gate: 7, reached_you: 1, declined: 4, failed: 1, no_line: 2, old_lines: 1 });
    expect(l.tallies).toEqual(['1 let in', '1 let in · 1 question', 'not used this month', '1 kept out']);
    expect(l.example).toBe('B2B founders selling to public hospitals or insurers in the US or Canada');
    for (const r of l.ranges) expect(rules.slice(r.start, r.end).length).toBeGreaterThan(3);
    expect(buildLedger(rules, [], 0, '2026-11-01')).toMatchObject({ reached_gate: 0, tallies: null, example: null });
  });

  it('reads the member’s own decisions for this Pacific-time month and the cap used', async () => {
    const asker = await db.createMember(email('asker'), { rules: ENGINEER });
    const id = await db.createMember(email('ledger'), { rules: HEALTH });
    const month = capMonth(new Date());
    await db.pg.query(`insert into public.asks (id, asker_id, raw, compiled, subject, status) values ('a_L1x', $1, 'raw', '{}'::jsonb, 'Hospital procurement in the US', 'open')`, [asker]);
    await db.pg.query(`insert into public.asks (id, asker_id, raw, compiled, subject, status) values ('a_L2x', $1, 'raw', '{}'::jsonb, 'Old ask', 'closed')`, [asker]);
    await db.pg.query(`insert into public.ask_members (ask_id, member_id, position) values ('a_L1x', $1, 0), ('a_L2x', $1, 0)`, [id]);
    await db.pg.query(
      `insert into public.gate_decisions (ask_id, member_id, rules_version, verdict, model_verdict, cited, decided_by, reason_code) values
       ('a_L1x', $1, 1, 'accept', 'accept', $2::jsonb, 'gate', 'match')`,
      [id, JSON.stringify([{ text: 'talked to 10+ buyers and have a price', found: true, start: 0, end: 1 }])],
    );
    await db.pg.query(
      `insert into public.gate_decisions (ask_id, member_id, rules_version, verdict, model_verdict, cited, decided_by, reason_code, created_at) values
       ('a_L2x', $1, 1, 'decline', 'decline', '[]'::jsonb, 'gate', 'no_rule', now() - interval '45 days')`,
      [id],
    );
    await db.pg.query(`insert into public.cap_usage (member_id, month, used) values ($1, $2, 1)`, [id, month]);
    const res = await getMonthLedger(id, HEALTH);
    expect(res.ok && res.ledger).toMatchObject({ reached_gate: 1, reached_you: 1, month, tallies: ['not used this month', '1 let in', 'not used this month', 'not used this month'] });
  });
});

describe('export', () => {
  it('returns the member’s own rows without token hashes or other people’s asks', async () => {
    const id = await db.createMember(email('export'), { rules: ENGINEER });
    await saveRules(id, HEALTH, 'web');
    await createApiToken(id);
    await createPauseLink(id);
    const res = await exportMemberData(id);
    expect(res.ok).toBe(true);
    const json = JSON.stringify(res.ok ? res.data : null);
    expect(json).not.toMatch(/token_hash|[0-9a-f]{64}/);
    const data = res.ok ? (res.data as { rules_versions: unknown[]; claude_code_tokens: unknown[]; pause_links: unknown[] }) : null;
    expect(data?.rules_versions).toHaveLength(2);
    expect(data?.claude_code_tokens).toHaveLength(1);
    expect(data?.pause_links).toHaveLength(1);
  });
});

describe('Claude Code tokens', () => {
  it('creates once, verifies Bearer and bare forms, records the last use, revokes', async () => {
    const id = await db.createMember(email('token'), { rules: ENGINEER });
    expect(await getApiTokenStatus(id)).toEqual({ ok: true, status: { state: 'none' } });
    const created = await createApiToken(id);
    expect(created.ok).toBe(true);
    const token = created.ok ? created.token : '';
    expect(token).toMatch(/^oti_[A-Za-z0-9_-]{22}$/);
    const stored = await db.pg.query<{ token_hash: string }>('select token_hash from public.api_tokens where member_id = $1', [id]);
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(await verifyApiToken(`Bearer ${token}`)).toMatchObject({ id });
    expect(await verifyApiToken(token, 'hook')).toMatchObject({ id });
    const status = await getApiTokenStatus(id);
    expect(status.ok && status.status).toMatchObject({ state: 'active', last_used_from: 'hook' });
    expect(await verifyApiToken('Bearer nope')).toBeNull();
    expect(await verifyApiToken(null)).toBeNull();
    expect(parseBearer(`bearer   ${token}`)).toBe(token);

    const second = await createApiToken(id);
    expect(second.ok).toBe(true);
    expect(await verifyApiToken(token)).toBeNull();
    expect(await revokeApiToken(id)).toMatchObject({ ok: true });
    expect(await verifyApiToken(second.ok ? second.token : '')).toBeNull();
    const after = await getApiTokenStatus(id);
    expect(after.ok && after.status.state).toBe('revoked');
    expect(h.audit.map((a) => a.action)).toEqual(['token_created', 'token_revoked', 'token_created', 'token_revoked']);
  });
});

describe('email-code sign-in', () => {
  function fakeAuth(over: Partial<{ send: (email: string) => { message: string; status?: number; code?: string } | null; verify: (code: string) => { message: string; status?: number; code?: string } | null; user: { id: string; email: string } }> = {}) {
    const calls = { send: 0, verify: 0 };
    const auth: OtpAuthClient = {
      async signInWithOtp({ email }) {
        calls.send++;
        return { error: over.send ? over.send(email) : null };
      },
      async verifyOtp({ token }) {
        calls.verify++;
        return { error: over.verify ? over.verify(token) : null };
      },
      async getUser() {
        return { data: { user: over.user ?? null }, error: over.user ? null : { message: 'no session', status: 401 } };
      },
    };
    return { auth, calls };
  }

  it('validates, sends a code, and limits codes per email to 3 in 15 minutes', async () => {
    const { auth, calls } = fakeAuth();
    expect(await requestSignInCode(auth, { email: 'priya@example', ip: '203.0.113.9' })).toMatchObject({ ok: false, error: 'invalid_email' });
    const mail = email('otp');
    for (let i = 0; i < 3; i++) expect(await requestSignInCode(auth, { email: mail, ip: '203.0.113.9' })).toMatchObject({ ok: true, resend_in_s: 60 });
    const limited = await requestSignInCode(auth, { email: mail, ip: '203.0.113.9' });
    expect(limited).toMatchObject({ ok: false, error: 'limited' });
    expect(Date.parse((limited as { retry_at: string }).retry_at)).toBeGreaterThan(Date.now());
    expect(calls.send).toBe(3);
    // The counters are HMAC keys in Postgres, never a raw email or address.
    const keys = await db.pg.query<{ key: string }>(`select key from public.rate_limits where bucket = 'otp'`);
    expect(keys.rows.length).toBeGreaterThan(0);
    for (const k of keys.rows) expect(k.key).not.toMatch(/@|203\.0/);
  });

  it('maps Supabase’s answers: a code sent under a minute ago, team-only SMTP, outages', async () => {
    const recent = fakeAuth({ send: () => ({ message: 'For security purposes, you can only request this after 42 seconds.', status: 429, code: 'over_email_send_rate_limit' }) });
    expect(await requestSignInCode(recent.auth, { email: email('recent'), ip: null })).toMatchObject({ ok: true, resend_in_s: 42 });
    const team = fakeAuth({ send: () => ({ message: 'Email address not authorized', status: 400, code: 'email_address_not_authorized' }) });
    expect(await requestSignInCode(team.auth, { email: email('team'), ip: null })).toMatchObject({ ok: false, error: 'not_authorized' });
    const down = fakeAuth({ send: () => ({ message: 'upstream', status: 502 }) });
    expect(await requestSignInCode(down.auth, { email: email('downs'), ip: null })).toMatchObject({ ok: false, error: 'down' });
    expect(await requestSignInCode(null, { email: email('none'), ip: null })).toMatchObject({ ok: false, error: 'not_available' });
  });

  it('counts tries per code and stops after 5', async () => {
    const wrong = fakeAuth({ verify: () => ({ message: 'Token has expired or is invalid', status: 403, code: 'otp_expired' }) });
    const mail = email('tries');
    const sent_at = Date.now() - 5_000;
    const base = { email: mail, sent_at, carried: null, next: null, ip: null };
    expect(await verifySignInCode(wrong.auth, { ...base, code: '12345' })).toMatchObject({ ok: false, error: 'invalid_code' });
    const left: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await verifySignInCode(wrong.auth, { ...base, code: '000000' });
      left.push(r.ok ? -1 : r.tries_left);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(await verifySignInCode(wrong.auth, { ...base, code: '000000' })).toMatchObject({ ok: false, error: 'no_tries' });
    expect(wrong.calls.verify).toBe(5);
    // A new code starts a new count.
    expect(await verifySignInCode(wrong.auth, { ...base, sent_at: sent_at + 61_000, code: '000000' })).toMatchObject({ ok: false, error: 'rejected', tries_left: 4 });
  });

  it('caps tries per email across codes, so a changed send time can’t reset the count', async () => {
    const wrong = fakeAuth({ verify: () => ({ message: 'Token has expired or is invalid', status: 403, code: 'otp_expired' }) });
    const mail = email('brute');
    const t0 = Date.now() - 60_000;
    // A client inventing a new sent_at for every guess gets a fresh per-code count each time …
    for (let i = 0; i < 15; i++) {
      expect(await verifySignInCode(wrong.auth, { email: mail, code: '000000', sent_at: t0 + i, carried: null, next: null, ip: null })).toMatchObject({ ok: false, error: 'rejected', tries_left: 4 });
    }
    // … but the email itself allows 15 tries per 15 minutes, and the 16th never reaches Supabase.
    const capped = await verifySignInCode(wrong.auth, { email: mail, code: '000000', sent_at: t0 + 99, carried: null, next: null, ip: null });
    expect(capped).toMatchObject({ ok: false, error: 'limited' });
    expect(Date.parse((capped as { retry_at: string }).retry_at)).toBeGreaterThan(Date.now());
    expect(wrong.calls.verify).toBe(15);
    // Another address isn't affected.
    expect(await verifySignInCode(wrong.auth, { email: email('other'), code: '000000', sent_at: t0, carried: null, next: null, ip: null })).toMatchObject({ error: 'rejected' });
  });

  it('creates the member from the verified session and saves the carried rules and cap', async () => {
    const mail = email('verified');
    const id = await db.createUser(mail);
    const ok = fakeAuth({ user: { id, email: mail } });
    const res = await verifySignInCode(ok.auth, { email: 'typed-by-the-browser@example.invalid', code: '482913', sent_at: Date.now(), carried: { rules: ENGINEER, cap: 3 }, next: null, ip: null });
    expect(res).toEqual({ ok: true, next: '/me?first=1', created: true });
    const profile = await getMemberProfile(id);
    expect(profile.ok && profile.member).toMatchObject({ email: mail, status: 'pending', rules: ENGINEER, cap: 3 });
    const src = await db.pg.query<{ source: string }>('select source from public.rule_versions where member_id = $1', [id]);
    expect(src.rows).toEqual([{ source: 'playground' }]);
  });

  it('never overwrites a member’s rules with carried ones, and honours a safe ?next=', async () => {
    const mail = email('returning');
    const id = await db.createMember(mail, { rules: HEALTH });
    const ok = fakeAuth({ user: { id, email: mail } });
    const carried = { rules: ENGINEER, cap: 2 };
    expect(await verifySignInCode(ok.auth, { email: mail, code: '111222', sent_at: Date.now(), carried, next: null, ip: null })).toMatchObject({ ok: true, next: '/me?carried=1' });
    expect(await verifySignInCode(ok.auth, { email: mail, code: '111222', sent_at: Date.now() + 1, carried, next: '/o/o_3Fp9kL', ip: null })).toMatchObject({ ok: true, next: '/o/o_3Fp9kL' });
    expect(await verifySignInCode(ok.auth, { email: mail, code: '111222', sent_at: Date.now() + 2, carried: null, next: 'https://evil.example/', ip: null })).toMatchObject({ ok: true, next: '/me' });
    const profile = await getMemberProfile(id);
    expect(profile.ok && profile.member?.rules).toBe(HEALTH);
    for (const bad of ['//evil.example', '/\\evil', 'javascript:alert(1)', '/join?next=/me', '/api/pause', '/me\nx', '/me\tx']) expect(safeNext(bad), bad).toBeNull();
    expect(safeNext('/ask/a_91x?x=1')).toBe('/ask/a_91x?x=1');
  });
});

describe('email-code sign-in after the code is spent', () => {
  it('still continues to /me when the profile can’t be read right after verifying', async () => {
    const auth: OtpAuthClient = {
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ error: null }),
      getUser: async () => ({ data: { user: null }, error: { message: 'upstream', status: 502 } }),
    };
    expect(await verifySignInCode(auth, { email: 'spent@example.invalid', code: '123456', sent_at: Date.now(), carried: null, next: null, ip: null })).toEqual({
      ok: true,
      next: '/me?first=1',
      created: false,
    });
  });
});
