import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The page loaders for /o and /c with BE2, S3 and the session mocked: how a URL segment resolves (sample, link
 * token, the signed-in member's id, junk), and which designed state each BE2 answer renders. GET never changes
 * anything: the loaders only read.
 */

const TOKEN = '3Fp9Kx7QmW2cAbCdEfGhIj';

const envState = vi.hoisted(() => ({ env: { TOKEN_HMAC_SECRET: 'test-secret-that-is-long-enough-for-hmac-0123456789' as string | undefined } }));
vi.mock('@/lib/env', () => envState);

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

import { loadCheckinPage } from '@/components/checkin/load';
import { loadOfferPage } from '@/components/offer/load';
import { csrfToken } from '@/components/offer/server-guard';
import { SUGGESTED_EDIT_UNTESTED } from '@/lib/oti/copy';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { PRESETS } from '@/lib/sample/presets';
import type { CheckinView, OfferView } from '@/lib/types';

const HOUR = 3_600_000;

function offer(over: Partial<OfferView> = {}): OfferView {
  return {
    offer_id: 'o_3Fp9kL',
    state: 'pending',
    sample: false,
    title: OFFER_SAMPLE.title,
    subject: OFFER_SAMPLE.subject,
    asker: { name: 'Lucía Ferrer', first: 'Lucía', company: 'Orvella Health', stage: 'Seed', city: 'Guadalajara' },
    matched: { text: OFFER_SAMPLE.matched, start: 22, end: 98, line: 'Happy to talk to B2B founders selling to public hospitals or insurers in Mexico or Colombia.' },
    rules_version: 3,
    topic: 'Hospital procurement, Mexico',
    scheduling_url: 'https://cal.com/ana-ruiz/20min',
    facts: [...OFFER_SAMPLE.facts],
    cap: 2,
    nth: 1,
    offered_at: new Date(Date.now() - HOUR).toISOString(),
    expires_at: new Date(Date.now() + 71 * HOUR + 30 * 60_000).toISOString(),
    responded_at: null,
    answer: null,
    no_reason: null,
    paused_until: null,
    ask_withdrawn_at: null,
    member_first: 'Ana',
    ...over,
  };
}

function checkin(over: Partial<CheckinView> = {}): CheckinView {
  return {
    checkin_id: 'c_88',
    ask_id: null,
    kind: 'd1',
    role: 'asker',
    sample: false,
    other_name: 'Ana Ruiz',
    other_first: 'Ana',
    intro_subject: OFFER_SAMPLE.subject,
    intro_made_at: '2026-11-09T21:16:00-06:00',
    answer: null,
    answered_at: null,
    closes_at: new Date(Date.now() + 20 * 24 * HOUR).toISOString(),
    reminder_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  envState.env.TOKEN_HMAC_SECRET = 'test-secret-that-is-long-enough-for-hmac-0123456789';
  session.getUser.mockResolvedValue({ ok: true, user: { id: 'u-ana', email: 'ana@example.com' } });
});

describe('/o: resolving the link', () => {
  it('a link token reads the offer by token; the page carries a CSRF token bound to that link', async () => {
    offers.getOffer.mockResolvedValue({ found: true, offer: offer() });
    const m = await loadOfferPage(TOKEN, {});
    expect(offers.getOffer).toHaveBeenCalledWith({ token: TOKEN }, expect.any(Date));
    expect(m.mode).toBe('real');
    expect(m.ui.view).toBe('open');
    expect(m.card).toMatchObject({ title: 'Hospital procurement in Mexico', from: 'Lucía Ferrer · Orvella Health · Seed · Guadalajara', matched: OFFER_SAMPLE.matched, who: 'Lucía', cap: 2, nth: 1 });
    expect(m.card?.facts[0]?.[0]).toBe('Problem');
    expect(m.hours).toBe(71);
    expect(m.forms?.csrf).toBe(csrfToken(`o:t:${TOKEN}`));
    expect(JSON.stringify(m)).not.toContain('u-ana');
  });

  it('an offer id is the signed-in member’s (the /me link); signed out goes to sign in first', async () => {
    offers.getOffer.mockResolvedValue({ found: true, offer: offer() });
    await loadOfferPage('o_3Fp9kL', { choice: 'ok' });
    expect(offers.getOffer).toHaveBeenCalledWith({ offer_id: 'o_3Fp9kL', member_id: 'u-ana' }, expect.any(Date));
    session.getUser.mockResolvedValue({ ok: false, reason: 'signed_out' });
    session.requireMember.mockImplementation(() => {
      throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/join?next=%2Fo%2Fo_3Fp9kM;307;' });
    });
    await expect(loadOfferPage('o_3Fp9kM', {})).rejects.toMatchObject({ digest: expect.stringContaining('/join?next=') });
    expect(session.requireMember).toHaveBeenCalledWith({ next: '/o/o_3Fp9kM' });
  });

  it('junk never reaches the database and renders invalid (never a 404)', async () => {
    const m = await loadOfferPage('not-a-link', {});
    expect(m.ui.view).toBe('invalid');
    expect(m.card).toBeNull();
    expect(offers.getOffer).not.toHaveBeenCalled();
  });

  it('not set up, database down, a thrown error and an unknown link each render their own state', async () => {
    offers.getOffer.mockResolvedValueOnce({ found: false, reason: 'not_configured' });
    expect((await loadOfferPage(TOKEN, { choice: 'ok' })).ui.view).toBe('unconfigured');
    offers.getOffer.mockResolvedValueOnce({ found: false, reason: 'db_down' });
    expect((await loadOfferPage(TOKEN, { choice: 'answer' })).ui.view).toBe('broken');
    offers.getOffer.mockRejectedValueOnce(new Error('socket hang up'));
    expect((await loadOfferPage(TOKEN, { choice: 'no' })).ui.view).toBe('broken');
    offers.getOffer.mockResolvedValueOnce({ found: false, reason: 'invalid' });
    expect((await loadOfferPage(TOKEN, { done: 'ok' })).ui.view).toBe('invalid');
    // Without the token secret a link can't be verified: not set up, even if a row came back.
    envState.env.TOKEN_HMAC_SECRET = undefined;
    offers.getOffer.mockResolvedValueOnce({ found: true, offer: offer() });
    expect((await loadOfferPage(TOKEN, { v: 'x' })).ui.view).toBe('unconfigured');
    session.getUser.mockResolvedValue({ ok: false, reason: 'not_configured' });
    expect((await loadOfferPage('o_3Fp9kL', { v: 'y' })).ui.view).toBe('unconfigured');
    session.getUser.mockResolvedValue({ ok: false, reason: 'error' });
    expect((await loadOfferPage('o_3Fp9kL', { v: 'z' })).ui.view).toBe('broken');
  });
});

describe('/o: the offer’s state decides', () => {
  it('the email’s choice preselects; expired, withdrawn and paused read from the record', async () => {
    offers.getOffer.mockResolvedValue({ found: true, offer: offer() });
    expect((await loadOfferPage(TOKEN, { choice: 'ok' })).ui.view).toBe('confirm');
    offers.getOffer.mockResolvedValue({ found: true, offer: offer({ expires_at: new Date(Date.now() - HOUR).toISOString() }) });
    const expired = await loadOfferPage(TOKEN, { choice: 'answer' });
    expect(expired.ui.view).toBe('expired');
    expect(expired.hours).toBeNull();
    offers.getOffer.mockResolvedValue({ found: true, offer: offer({ state: 'withdrawn', ask_withdrawn_at: '2026-11-10T10:12:00-06:00' }) });
    const withdrawn = await loadOfferPage(TOKEN, {});
    expect(withdrawn.ui.view).toBe('withdrawn');
    expect(withdrawn.withdrawnOn?.text).toBe('Tue Nov 10');
    offers.getOffer.mockResolvedValue({ found: true, offer: offer({ paused_until: '2026-12-01T06:00:00Z' }) });
    const paused = await loadOfferPage(TOKEN, { choice: 'no' });
    expect(paused.ui).toMatchObject({ view: 'open', paused: true, nohint: true });
    expect(paused.pausedUntil).toBe('Dec 1');
  });

  it('after OK: “just did it” right after the POST, “you said OK on …” on any later visit', async () => {
    offers.getOffer.mockResolvedValue({ found: true, offer: offer({ state: 'ok', responded_at: '2026-11-09T21:16:00-06:00' }) });
    const now = await loadOfferPage(TOKEN, { done: 'ok' });
    expect(now.ui.view).toBe('ok-sent');
    expect(now.okAt?.text).toBe('21:16');
    expect(now.scheduling).toBe(true);
    expect(now.justActed).toBe(true);
    const later = await loadOfferPage(TOKEN, {});
    expect(later.ui).toMatchObject({ view: 'already-acted', did: 'ok' });
    expect(later.acted?.text).toBe('Mon Nov 9 at 21:16');
  });

  it('a No with “Not my area”: the templated line for the member’s own rules, labelled as not run', async () => {
    const rules = PRESETS.find((p) => p.id === 'health')?.rules as string;
    offers.getOffer.mockResolvedValue({ found: true, offer: offer({ state: 'passed', responded_at: '2026-11-09T21:16:00-06:00', no_reason: 'not_my_area' }) });
    offers.memberForOffer.mockResolvedValue({ member_id: 'u-ana' });
    member.getMemberProfile.mockResolvedValue({ ok: true, member: { rules, rules_version: 3 } });
    const m = await loadOfferPage(TOKEN, { done: 'no' });
    expect(m.ui).toMatchObject({ view: 'no', why: 'area' });
    expect(m.edit).toEqual({ context: 'Happy to talk to B2B founders selling to public hospitals or insurers in Mexico or Colombia.', add: 'No asks about hospital procurement.', caption: SUGGESTED_EDIT_UNTESTED });
    expect(m.rulesVersion).toBe(3);
    expect(m.edit?.add).not.toContain('Orvella');
    // Already in the rules: nothing to suggest.
    member.getMemberProfile.mockResolvedValue({ ok: true, member: { rules: `${rules}\nNo asks about hospital procurement.`, rules_version: 4 } });
    expect((await loadOfferPage(TOKEN, { done: 'no', why: 'area' })).edit).toBeNull();
  });
});

describe('/c: resolving the link and the check-in’s state', () => {
  it('not set up, database down, invalid', async () => {
    checkins.getCheckin.mockResolvedValueOnce({ found: false, reason: 'not_configured' });
    expect((await loadCheckinPage(TOKEN, { v: '4' })).ui.view).toBe('unconfigured');
    checkins.getCheckin.mockResolvedValueOnce({ found: false, reason: 'db_down' });
    expect((await loadCheckinPage(TOKEN, { v: '5' })).ui.view).toBe('broken');
    checkins.getCheckin.mockResolvedValueOnce({ found: false, reason: 'invalid' });
    expect((await loadCheckinPage(TOKEN, { v: '3' })).ui.view).toBe('invalid');
    expect((await loadCheckinPage('nope!', {})).ui.view).toBe('invalid');
  });

  it('the email’s value preselects; an answer reads “You answered on …”; a closed window reads closed', async () => {
    checkins.getCheckin.mockResolvedValue({ found: true, checkin: checkin() });
    const form = await loadCheckinPage(TOKEN, { v: '4' });
    expect(form.ui).toMatchObject({ view: 'form', kind: 'd1', role: 'asker', value: '4' });
    expect(form.other).toEqual({ name: 'Ana Ruiz', first: 'Ana' });
    expect(form.subject).toBe('Hospital procurement in Mexico');
    expect(form.introMade?.text).toBe('Nov 9');
    expect(form.forms?.csrf).toBe(csrfToken(`c:t:${TOKEN}`));
    checkins.getCheckin.mockResolvedValue({ found: true, checkin: checkin({ answer: { kind: 'd1', rating: 4 }, answered_at: '2026-11-10T10:00:00-06:00' }) });
    const answered = await loadCheckinPage(TOKEN, { v: '2' });
    expect(answered.ui).toMatchObject({ view: 'already', value: '4' });
    expect(answered.answeredOn?.text).toBe('Nov 10');
    const change = await loadCheckinPage(TOKEN, { change: '1', v: '2' });
    expect(change.ui).toMatchObject({ view: 'form', value: '2' });
    expect(change.forms?.keep).toEqual({ change: '1' });
    checkins.getCheckin.mockResolvedValue({ found: true, checkin: checkin({ closes_at: new Date(Date.now() - HOUR).toISOString() }) });
    expect((await loadCheckinPage(TOKEN, { v: '1' })).ui.view).toBe('closed');
  });
});
