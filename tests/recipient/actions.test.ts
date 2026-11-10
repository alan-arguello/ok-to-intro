import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The recipient POSTs (server actions) with BE2, S3 and the session mocked. `redirect()` is Next's own: it throws
 * NEXT_REDIRECT with the target in its digest (a 303 for a no-JS form post), which `landing()` reads.
 */

const TOKEN = '3Fp9Kx7QmW2cAbCdEfGhIj';

vi.mock('@/lib/env', () => ({ env: { TOKEN_HMAC_SECRET: 'test-secret-that-is-long-enough-for-hmac-0123456789' } }));

const offers = vi.hoisted(() => ({
  getOffer: vi.fn(),
  respondToOffer: vi.fn(),
  setNoReason: vi.fn(),
  memberForOffer: vi.fn(),
  listPendingForMember: vi.fn(),
}));
vi.mock('@/lib/server/offers', () => offers);

const member = vi.hoisted(() => ({
  appendRuleLine: vi.fn(),
  getMemberProfile: vi.fn(),
  pauseMember: vi.fn(),
  saveRules: vi.fn(),
  setCap: vi.fn(),
}));
vi.mock('@/lib/server/member', () => member);

const checkins = vi.hoisted(() => ({ getCheckin: vi.fn(), saveCheckin: vi.fn() }));
vi.mock('@/lib/server/checkins', () => checkins);

const session = vi.hoisted(() => ({ getUser: vi.fn(), requireMember: vi.fn() }));
vi.mock('@/lib/supabase/server', () => session);

import { checkinSave } from '@/app/(slim)/c/[token]/actions';
import { offerFollow, offerReason, offerRespond } from '@/app/(slim)/o/[token]/actions';
import { csrfToken, csrfValid, serverIdempotencyKey } from '@/components/offer/server-guard';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { PRESETS } from '@/lib/sample/presets';
import type { OfferView } from '@/lib/types';

async function landing(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2] as string;
    throw e;
  }
  throw new Error('the action did not redirect');
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const realOffer = (): OfferView => ({
  offer_id: 'o_3Fp9kL',
  state: 'passed',
  sample: false,
  title: 'Enterprise deals stuck 5 months',
  subject: 'Enterprise deals stuck 5 months, 20 min?',
  asker: { name: 'Maya Bennett', first: 'Maya', company: 'Oakline Health', stage: 'Seed', city: 'Chicago' },
  matched: { text: OFFER_SAMPLE.matched, start: 22, end: 98, line: 'Happy to talk to B2B founders selling to enterprise customers.' },
  rules_version: 3,
  topic: 'Enterprise sales, US',
  scheduling_url: null,
  facts: [...OFFER_SAMPLE.facts],
  cap: 2,
  nth: 1,
  offered_at: '2026-11-09T21:04:00-08:00',
  expires_at: '2026-11-12T21:04:00-08:00',
  responded_at: '2026-11-09T21:16:00-08:00',
  answer: null,
  no_reason: 'not_my_area',
  paused_until: null,
  ask_withdrawn_at: null,
  member_first: 'Priya',
});

const csrfFor = (scope: string) => csrfToken(scope) as string;

beforeEach(() => {
  vi.clearAllMocks();
  session.getUser.mockResolvedValue({ ok: true, user: { id: 'u-priya', email: 'priya@example.com' } });
});
afterEach(() => vi.unstubAllEnvs());

describe('CSRF and idempotency keys', () => {
  it('a token is bound to its scope, and the key never carries the raw link token', () => {
    const t = csrfFor(`o:t:${TOKEN}`);
    expect(t).toHaveLength(32);
    expect(csrfValid(`o:t:${TOKEN}`, t)).toBe(true);
    expect(csrfValid(`c:t:${TOKEN}`, t)).toBe(false);
    expect(csrfValid(`o:t:${TOKEN}`, 'x'.repeat(32))).toBe(false);
    expect(csrfValid(`o:t:${TOKEN}`, null)).toBe(false);
    const key = serverIdempotencyKey(`o:t:${TOKEN}`, 'ok');
    expect(key).not.toContain(TOKEN);
    expect(key).toBe(serverIdempotencyKey(`o:t:${TOKEN}`, 'ok'));
    expect(key).not.toBe(serverIdempotencyKey(`o:t:${TOKEN}`, 'no'));
  });
});

describe('offerRespond', () => {
  it('SAMPLE moves to the result and touches nothing', async () => {
    expect(await landing(offerRespond(form({ ref: 'sample', csrf: 'sample', mode: 'sample', ask: 'sa_eng', action: 'ok' })))).toBe('/o/sample?ask=sa_eng&done=ok');
    expect(await landing(offerRespond(form({ ref: 'sample', csrf: 'sample', mode: 'sample', from: 'playground', action: 'no' })))).toBe('/o/sample?from=playground&done=no');
    expect(await landing(offerRespond(form({ ref: 'sample', csrf: 'sample', mode: 'sample', action: 'answer', text: '   ' })))).toBe('/o/sample?choice=answer&error=input');
    expect(await landing(offerRespond(form({ ref: 'sample', csrf: 'x', mode: 'real', ask: '<script>', action: 'ok' })))).toBe('/o/sample?done=ok');
    expect(offers.respondToOffer).not.toHaveBeenCalled();
  });

  it('REAL: valid CSRF → BE2 once, with a server-built key, then 303 to “just did it”', async () => {
    offers.respondToOffer.mockResolvedValue({ ok: true, offer: realOffer(), repeated: false });
    const to = await landing(offerRespond(form({ ref: TOKEN, csrf: csrfFor(`o:t:${TOKEN}`), mode: 'real', action: 'answer', text: 'Ask for the annex.\n\n\nIt helps.', idempotency_key: 'evil:key' })));
    expect(to).toBe(`/o/${TOKEN}?done=answer`);
    expect(offers.respondToOffer).toHaveBeenCalledTimes(1);
    const [ref, action, payload] = offers.respondToOffer.mock.calls[0] as [unknown, string, { answer: string; idempotency_key: string }];
    expect(ref).toEqual({ token: TOKEN });
    expect(action).toBe('answer');
    expect(payload.answer).toBe('Ask for the annex.\n\n It helps.');
    expect(payload.idempotency_key).toBe(serverIdempotencyKey(`o:t:${TOKEN}`, 'answer'));
  });

  it('REAL: a forged or missing CSRF token never reaches BE2', async () => {
    expect(await landing(offerRespond(form({ ref: TOKEN, csrf: 'forged', mode: 'real', action: 'ok' })))).toBe(`/o/${TOKEN}?choice=ok&error=server`);
    expect(await landing(offerRespond(form({ ref: TOKEN, mode: 'real', action: 'no' })))).toBe(`/o/${TOKEN}?error=server`);
    expect(offers.respondToOffer).not.toHaveBeenCalled();
  });

  it('REAL: each BE2 outcome lands on its designed state', async () => {
    const post = (action: string) => landing(offerRespond(form({ ref: TOKEN, csrf: csrfFor(`o:t:${TOKEN}`), mode: 'real', action, text: 'ok' })));
    offers.respondToOffer.mockResolvedValueOnce({ ok: false, reason: 'db_down' });
    expect(await post('ok')).toBe(`/o/${TOKEN}?choice=ok&error=server`);
    offers.respondToOffer.mockRejectedValueOnce(new Error('network'));
    expect(await post('no')).toBe(`/o/${TOKEN}?error=server`);
    offers.respondToOffer.mockResolvedValueOnce({ ok: false, reason: 'bad_input' });
    expect(await post('answer')).toBe(`/o/${TOKEN}?choice=answer&error=input`);
    for (const reason of ['already_acted', 'expired', 'withdrawn', 'invalid', 'not_configured']) {
      offers.respondToOffer.mockResolvedValueOnce({ ok: false, reason });
      expect(await post('ok')).toBe(`/o/${TOKEN}`);
    }
  });

  it('an offer id is the signed-in member’s; signed out goes to /join; no Supabase renders not-set-up', async () => {
    offers.respondToOffer.mockResolvedValue({ ok: true, offer: realOffer(), repeated: false });
    const scope = 'o:i:o_3Fp9kL:u-priya';
    expect(await landing(offerRespond(form({ ref: 'o_3Fp9kL', csrf: csrfFor(scope), mode: 'real', action: 'ok' })))).toBe('/o/o_3Fp9kL?done=ok');
    expect(offers.respondToOffer.mock.calls[0]?.[0]).toEqual({ offer_id: 'o_3Fp9kL', member_id: 'u-priya' });

    session.getUser.mockResolvedValueOnce({ ok: false, reason: 'signed_out' });
    session.requireMember.mockImplementationOnce(async () => {
      const { redirect } = await import('next/navigation');
      redirect('/join?next=%2Fo%2Fo_3Fp9kL');
    });
    expect(await landing(offerRespond(form({ ref: 'o_3Fp9kL', csrf: 'x', mode: 'real', action: 'ok' })))).toBe('/join?next=%2Fo%2Fo_3Fp9kL');

    session.getUser.mockResolvedValueOnce({ ok: false, reason: 'not_configured' });
    expect(await landing(offerRespond(form({ ref: 'o_3Fp9kL', csrf: 'x', mode: 'real', action: 'ok' })))).toBe('/o/o_3Fp9kL');
    expect(offers.respondToOffer).toHaveBeenCalledTimes(1);
  });

  it('junk is refused before anything runs; the QA example only runs while QA is on', async () => {
    expect(await landing(offerRespond(form({ ref: '../../etc', action: 'ok' })))).toBe('/o/invalid');
    expect(await landing(offerRespond(form({ ref: 'sample', action: 'delete-everything' })))).toBe('/o/sample');
    expect(await landing(offerRespond(form({ ref: 'demo', mode: 'example', csrf: 'example', action: 'ok' })))).toBe('/o/demo?state=ok-sent');
    vi.stubEnv('NODE_ENV', 'production');
    expect(await landing(offerRespond(form({ ref: 'demo', mode: 'example', csrf: 'example', action: 'ok' })))).toBe('/o/demo');
    expect(offers.respondToOffer).not.toHaveBeenCalled();
  });
});

describe('offerReason and offerFollow (the private Why after a No)', () => {
  const real = (fields: Record<string, string>) => form({ ref: TOKEN, csrf: csrfFor(`o:t:${TOKEN}`), mode: 'real', ...fields });

  it('records the reason privately and shows its follow-up', async () => {
    offers.setNoReason.mockResolvedValue({ ok: true });
    expect(await landing(offerReason(real({ why: 'area' })))).toBe(`/o/${TOKEN}?done=no&why=area`);
    expect(offers.setNoReason).toHaveBeenCalledWith({ token: TOKEN }, 'not_my_area', null);
    offers.setNoReason.mockResolvedValueOnce({ ok: false, reason: 'db_down' });
    expect(await landing(offerReason(real({ why: 'busy' })))).toBe(`/o/${TOKEN}?done=no&why=busy&error=server`);
    expect(await landing(offerReason(form({ ref: 'sample', mode: 'sample', why: 'vague' })))).toBe('/o/sample?done=no&why=vague');
  });

  it('Add to my rules appends the one templated line; Undo removes exactly that line', async () => {
    offers.memberForOffer.mockResolvedValue({ member_id: 'u-priya' });
    offers.getOffer.mockResolvedValue({ found: true, offer: realOffer() });
    member.appendRuleLine.mockResolvedValue({ ok: true, version: 4 });
    expect(await landing(offerFollow(real({ step: 'add', why: 'area' })))).toBe(`/o/${TOKEN}?done=no&why=area&step=applied`);
    expect(member.appendRuleLine).toHaveBeenCalledWith('u-priya', 'No asks about enterprise sales.', 'offer_edit');

    const rules = `${PRESETS[1]!.rules}\nNo asks about enterprise sales.`;
    member.getMemberProfile.mockResolvedValue({ ok: true, member: { rules, rules_version: 4 } });
    member.saveRules.mockResolvedValue({ ok: true, version: 5 });
    expect(await landing(offerFollow(real({ step: 'undo', why: 'area' })))).toBe(`/o/${TOKEN}?done=no&why=area&step=undone`);
    expect(member.saveRules).toHaveBeenCalledWith('u-priya', PRESETS[1]!.rules, 'offer_edit');
  });

  it('No time this month: cap 1 or a pause until the next cap month; Other: a private note', async () => {
    offers.memberForOffer.mockResolvedValue({ member_id: 'u-priya' });
    member.setCap.mockResolvedValue({ ok: true });
    member.pauseMember.mockResolvedValue({ ok: true, paused_until: null });
    offers.setNoReason.mockResolvedValue({ ok: true });
    expect(await landing(offerFollow(real({ step: 'cap', why: 'busy' })))).toBe(`/o/${TOKEN}?done=no&why=busy&step=cap`);
    expect(member.setCap).toHaveBeenCalledWith('u-priya', 1);
    expect(await landing(offerFollow(real({ step: 'pause', why: 'busy' })))).toBe(`/o/${TOKEN}?done=no&why=busy&step=pause`);
    const until = member.pauseMember.mock.calls[0]?.[1] as string;
    expect(new Date(until).getTime()).toBeGreaterThan(Date.now());
    expect(member.pauseMember.mock.calls[0]?.[2]).toBeUndefined();
    expect(await landing(offerFollow(real({ step: 'note', why: 'other', note: '  busy   quarter ' })))).toBe(`/o/${TOKEN}?done=no&why=other&step=saved`);
    expect(offers.setNoReason).toHaveBeenCalledWith({ token: TOKEN }, 'other', 'busy quarter');
    // A step that doesn't match its reason changes nothing.
    expect(await landing(offerFollow(real({ step: 'cap', why: 'area' })))).toBe(`/o/${TOKEN}?done=no&why=area`);
    expect(member.setCap).toHaveBeenCalledTimes(1);
  });
});

describe('checkinSave', () => {
  it('SAMPLE saves nothing and keeps the loop', async () => {
    expect(await landing(checkinSave(form({ ref: 'sample', mode: 'sample', kind: 'd1', role: 'member', value: '4', ask: 'sa_eng' })))).toBe('/c/sample?ask=sa_eng&who=member&done=1&v=4');
    expect(await landing(checkinSave(form({ ref: 'sample', mode: 'sample', kind: 'd14', role: 'asker', value: 'hire' })))).toBe('/c/sample?kind=14d&done=1&v=hire');
    expect(await landing(checkinSave(form({ ref: 'sample', mode: 'sample', kind: 'd1', value: 'bogus' })))).toBe('/c/sample?error=input');
    expect(checkins.saveCheckin).not.toHaveBeenCalled();
  });

  it('REAL: the answer goes to BE2 once; the same answer twice has the same key, a changed one a new key', async () => {
    checkins.saveCheckin.mockResolvedValue({ ok: true, checkin: {}, repeated: false });
    const post = (value: string, reason = '') => landing(checkinSave(form({ ref: TOKEN, csrf: csrfFor(`c:t:${TOKEN}`), mode: 'real', kind: 'd1', role: 'asker', value, reason })));
    expect(await post('4')).toBe(`/c/${TOKEN}?done=1`);
    await post('4');
    await post('wont', 'timing');
    const calls = checkins.saveCheckin.mock.calls as [unknown, unknown, string][];
    expect(calls[0]?.[0]).toEqual({ token: TOKEN });
    expect(calls[0]?.[1]).toEqual({ kind: 'd1', rating: 4 });
    expect(calls[0]?.[2]).toBe(calls[1]?.[2]);
    expect(calls[2]?.[1]).toEqual({ kind: 'd1', wont_happen: true, reason: 'timing' });
    expect(calls[2]?.[2]).not.toBe(calls[0]?.[2]);
    expect(calls[0]?.[2]).not.toContain(TOKEN);
  });

  it('REAL: closed, invalid, a DB error and a forged token each land on their state', async () => {
    const post = (csrf: string) => landing(checkinSave(form({ ref: TOKEN, csrf, mode: 'real', kind: 'd1', role: 'asker', value: '5', change: '1' })));
    checkins.saveCheckin.mockResolvedValueOnce({ ok: false, reason: 'closed' });
    expect(await post(csrfFor(`c:t:${TOKEN}`))).toBe(`/c/${TOKEN}`);
    checkins.saveCheckin.mockResolvedValueOnce({ ok: false, reason: 'db_down' });
    expect(await post(csrfFor(`c:t:${TOKEN}`))).toBe(`/c/${TOKEN}?change=1&v=5&error=server`);
    const before = checkins.saveCheckin.mock.calls.length;
    expect(await post('forged')).toBe(`/c/${TOKEN}?change=1&v=5&error=server`);
    expect(checkins.saveCheckin.mock.calls.length).toBe(before);
  });
});
