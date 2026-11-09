import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * End to end without JS: the page's loader builds the model, the screen renders the real forms, a browser without
 * JS would post exactly the hidden fields of the form it submits (plus what the person typed), and the server
 * action answers with a 303 to the result. This is what catches a field that collides between the kept query and
 * the form (a +14 day check-in once posted `kind=14d` and `kind=d14` and saved nothing).
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

import { checkinSave } from '@/app/(slim)/c/[token]/actions';
import { offerFollow, offerReason, offerRespond } from '@/app/(slim)/o/[token]/actions';
import { CheckinScreen } from '@/components/checkin/checkin-screen';
import { loadCheckinPage } from '@/components/checkin/load';
import { loadOfferPage } from '@/components/offer/load';
import { OfferScreen } from '@/components/offer/offer-screen';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import type { CheckinView, OfferView } from '@/lib/types';

const actions = { respond: offerRespond, reason: offerReason, follow: offerFollow };

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

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The fields a browser without JS posts for the form `id` (its hidden inputs, in order), plus `extra`. */
function formData(html: string, id: string, extra: Record<string, string> = {}): FormData {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) throw new Error(`no form #${id}`);
  const open = html.lastIndexOf('<form', at);
  const body = html.slice(open, html.indexOf('</form>', at));
  const fd = new FormData();
  for (const m of body.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"\/>/g)) fd.append(decode(m[1] as string), decode(m[2] as string));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

/** Every value posted under `name` (a duplicate is a bug: the action reads the first). */
const all = (fd: FormData, name: string) => fd.getAll(name);

async function offerHtml(segment: string, sp: Record<string, string>): Promise<string> {
  const model = await loadOfferPage(segment, sp);
  return renderToStaticMarkup(<OfferScreen model={model} actions={actions} />);
}

async function checkinHtml(segment: string, sp: Record<string, string>): Promise<string> {
  const model = await loadCheckinPage(segment, sp);
  return renderToStaticMarkup(<CheckinScreen model={model} action={checkinSave} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  envState.env.TOKEN_HMAC_SECRET = 'test-secret-that-is-long-enough-for-hmac-0123456789';
  session.getUser.mockResolvedValue({ ok: false, reason: 'not_configured' });
});

describe('/o/sample without JS: every form lands on its result and changes nothing', () => {
  it('OK, from the email’s preselected confirm', async () => {
    const html = await offerHtml('sample', { choice: 'ok' });
    expect(await landing(offerRespond(formData(html, 'offer-f-ok')))).toBe('/o/sample?done=ok');
  });

  it('No, keeping the S2 loop’s ask', async () => {
    const html = await offerHtml('sample', { ask: 'sa_eng' });
    expect(await landing(offerRespond(formData(html, 'offer-f-no')))).toBe('/o/sample?ask=sa_eng&done=no');
  });

  it('Answer in 2 lines: text required, then sent', async () => {
    const html = await offerHtml('sample', { choice: 'answer', from: 'playground' });
    expect(await landing(offerRespond(formData(html, 'offer-f-answer', { text: '' })))).toBe('/o/sample?from=playground&choice=answer&error=input');
    expect(await landing(offerRespond(formData(html, 'offer-f-answer', { text: 'Ask for the technical annex first.' })))).toBe('/o/sample?from=playground&done=answer');
  });

  it('the private Why, then its follow-up', async () => {
    const passed = await offerHtml('sample', { done: 'no' });
    expect(await landing(offerReason(formData(passed, 'offer-why-g', { why: 'area' })))).toBe('/o/sample?done=no&why=area');
    const area = await offerHtml('sample', { done: 'no', why: 'area' });
    expect(await landing(offerFollow(formData(area, 'offer-f-add')))).toBe('/o/sample?done=no&why=area&step=applied');
    const busy = await offerHtml('sample', { done: 'no', why: 'busy' });
    expect(await landing(offerFollow(formData(busy, 'offer-f-cap')))).toBe('/o/sample?done=no&why=busy&step=cap');
    expect(await landing(offerFollow(formData(busy, 'offer-f-pause')))).toBe('/o/sample?done=no&why=busy&step=pause');
    const other = await offerHtml('sample', { done: 'no', why: 'other' });
    expect(await landing(offerFollow(formData(other, 'offer-f-note', { note: 'Not this quarter' })))).toBe('/o/sample?done=no&why=other&step=saved');
    expect(offers.respondToOffer).not.toHaveBeenCalled();
    expect(offers.setNoReason).not.toHaveBeenCalled();
    expect(member.appendRuleLine).not.toHaveBeenCalled();
  });
});

describe('/c/sample without JS', () => {
  it('+14 days posts its kind once and saves the outcome', async () => {
    const html = await checkinHtml('sample', { kind: '14d', v: 'hire' });
    const fd = formData(html, 'ck-form', { note: 'We hired their referral' });
    expect(all(fd, 'kind')).toEqual(['d14']);
    expect(await landing(checkinSave(fd))).toBe('/c/sample?kind=14d&done=1&v=hire');
  });

  it('the member’s +1 day, and the loop’s ask with a won’t-happen reason', async () => {
    const member1 = await checkinHtml('sample', { who: 'member', v: '2' });
    const fd = formData(member1, 'ck-form');
    expect(all(fd, 'role')).toEqual(['member']);
    expect(await landing(checkinSave(fd))).toBe('/c/sample?who=member&done=1&v=2');
    const loop = await checkinHtml('sample', { ask: 'sa_eng', role: 'member', v: 'wont', why: 'timing' });
    expect(await landing(checkinSave(formData(loop, 'ck-form')))).toBe('/c/sample?ask=sa_eng&who=member&done=1&v=wont&why=timing');
    expect(checkins.saveCheckin).not.toHaveBeenCalled();
  });
});

describe('REAL links without JS (BE2 mocked)', () => {
  const pending: OfferView = {
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
    offered_at: new Date(Date.now() - 3_600_000).toISOString(),
    expires_at: new Date(Date.now() + 71 * 3_600_000).toISOString(),
    responded_at: null,
    answer: null,
    no_reason: null,
    paused_until: null,
    ask_withdrawn_at: null,
    member_first: 'Ana',
  };

  it('OK posts the page’s CSRF token; BE2 gets a server-built key, never the raw token', async () => {
    offers.getOffer.mockResolvedValue({ found: true, offer: pending });
    offers.respondToOffer.mockResolvedValue({ ok: true, offer: { ...pending, state: 'ok' }, repeated: false });
    const html = await offerHtml(TOKEN, { choice: 'ok' });
    expect(await landing(offerRespond(formData(html, 'offer-f-ok')))).toBe(`/o/${TOKEN}?done=ok`);
    const [ref, action, payload] = offers.respondToOffer.mock.calls[0] as [unknown, string, { idempotency_key: string }];
    expect(ref).toEqual({ token: TOKEN });
    expect(action).toBe('ok');
    expect(payload.idempotency_key).not.toContain(TOKEN);
  });

  it('a check-in answer reaches BE2 once per value', async () => {
    const view: CheckinView = {
      checkin_id: 'c_88',
      kind: 'd14',
      role: 'asker',
      sample: false,
      other_name: 'Ana Ruiz',
      other_first: 'Ana',
      intro_subject: OFFER_SAMPLE.subject,
      intro_made_at: '2026-11-09T21:16:00-06:00',
      answer: null,
      answered_at: null,
      closes_at: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      reminder_at: null,
    };
    checkins.getCheckin.mockResolvedValue({ found: true, checkin: view });
    checkins.saveCheckin.mockResolvedValue({ ok: true, checkin: { ...view, answer: { kind: 'd14', outcome: 'customer', note: null } }, repeated: false });
    const html = await checkinHtml(TOKEN, { v: 'customer' });
    const fd = formData(html, 'ck-form');
    expect(all(fd, 'kind')).toEqual(['d14']);
    expect(await landing(checkinSave(fd))).toBe(`/c/${TOKEN}?done=1`);
    expect(checkins.saveCheckin).toHaveBeenCalledTimes(1);
    expect(checkins.saveCheckin.mock.calls[0]?.[1]).toEqual({ kind: 'd14', outcome: 'customer', note: null });
  });
});
