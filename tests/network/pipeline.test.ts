import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The token secret must exist before lib/env.ts parses the environment (hoisted above the imports).
const h = vi.hoisted(() => {
  process.env.TOKEN_HMAC_SECRET = 'test-token-hmac-secret-0123456789abcdef';
  return {
    gate: null as null | ((input: { rules: string; answers?: { type: string; text: string }[] }) => Promise<unknown>),
    deferred: [] as Promise<unknown>[],
  };
});

vi.mock('@/lib/server/gate', () => ({
  runGate: (input: { rules: string }) => (h.gate ? h.gate(input) : Promise.resolve({ ok: false, kind: 'unavailable', ms: 0 })),
  warmGate: async () => ({ ok: false, ms: 0, kind: 'unavailable' }),
}));
vi.mock('@/lib/server/live', () => ({
  getLiveState: async () => ({ state: 'ok', paused_until: null }),
  canRunLive: (s: { state: string }) => s.state === 'ok' || s.state === 'slow',
}));
vi.mock('@/lib/server/ratelimit', () => ({ clientKey: () => null, checkRateLimit: async () => ({ ok: true, remaining: 20 }) }));
vi.mock('@/lib/server/member', () => ({ createPauseLink: async (id: string) => `http://localhost:3200/pause/pause${id.replace(/-/g, '').slice(0, 17)}` }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void h.deferred.push(Promise.resolve().then(fn)) }));

import { hashToken } from '@/lib/oti/tokens';
import { ceilCheckpoint } from '@/lib/server/checkpoints';
import { __setNetworkDbForTests } from '@/lib/server/audit';
import { canAskReal, createAsk, getAskerView, listMyAsks } from '@/lib/server/asks';
import { getCheckin, saveCheckin } from '@/lib/server/checkins';
import { startSend } from '@/lib/server/dispatch';
import { __setEmailTransportForTests } from '@/lib/server/email-send';
import { getOffer, listPendingForMember, respondToOffer, setNoReason, memberForOffer } from '@/lib/server/offers';
import { answerQuestion } from '@/lib/server/questions';
import type { FanoutEvent, MemberRef } from '@/lib/types';
import { accepts, asksBack, captureEmails, compiledAsk, createNetworkDb, declines, type NetworkDb } from './support';

const HOUR = 3_600_000;

const RULES = {
  priya: 'Happy to talk to B2B founders selling to hospital groups in the US.',
  ingrid: 'Long sales cycles with hospital groups and health systems. Happy to help hospital founders.',
  larsen: 'Enterprise procurement and security reviews. Only with a price.',
  marcus: 'Happy to talk about churn and retention in B2B software.',
  paused: 'Enterprise sales in Canada.',
  full: 'Selling to hospital systems in Texas.',
};

let net: NetworkDb;
let mail: ReturnType<typeof captureEmails>;
let maya: MemberRef;
const ids: Record<string, string> = {};

/** The gates, by whose rules they read: accept, decline, a price question, or a decline after the rerun. */
function gates() {
  h.gate = async (input) => {
    const rules = input.rules;
    if (rules === RULES.priya) return accepts(rules, 'B2B founders selling to hospital groups in the US', 900);
    if (rules === RULES.ingrid) return accepts(rules, 'Long sales cycles with hospital groups and health systems', 1200);
    if (rules === RULES.larsen) {
      return input.answers?.length ? accepts(rules, 'Enterprise procurement and security reviews', 700) : asksBack(rules, { type: 'price', text: 'What do you charge per customer, per year?' });
    }
    return declines(rules, rules === RULES.marcus ? 'topic' : 'region');
  };
}

beforeAll(async () => {
  net = await createNetworkDb();
  __setNetworkDbForTests(net.transport);
  mail = captureEmails();
  __setEmailTransportForTests(mail.transport);
  const mayaId = await net.member('maya@oakline.example', { name: 'Maya Bennett', company: 'Oakline Health', stage: 'Seed', city: 'Chicago', rules: 'Happy to talk about procurement checklists.' });
  maya = { id: mayaId, email: 'maya@oakline.example' };
  ids.priya = await net.member('priya@example.com', { name: 'Priya Shah', rules: RULES.priya, one_line: 'Ran procurement at a hospital system before selling software to them.', scheduling_url: 'https://cal.com/priya-shah/20min', show_matched: true });
  ids.ingrid = await net.member('ingrid@example.com', { name: 'Ingrid Larsen', rules: RULES.ingrid });
  ids.larsen = await net.member('q@example.com', { name: 'Quinn Rogers', rules: RULES.larsen, cap: 3 });
  ids.marcus = await net.member('marcus@example.com', { name: 'Marcus Reed', rules: RULES.marcus });
  ids.paused = await net.member('paused@example.com', { rules: RULES.paused, status: 'paused' });
  ids.full = await net.member('full@example.com', { rules: RULES.full, cap: 1 });
  // Ingrid already used 1 of her 2 this month; the full member used their only slot.
  for (const [m, used] of [[ids.ingrid, 1], [ids.full, 1]] as const) {
    await net.db.pg.query(`insert into public.cap_usage (member_id, month, used) values ($1, public.cap_month(now()), $2)`, [m, used]);
  }
  gates();
});

afterAll(async () => {
  __setNetworkDbForTests(null);
  __setEmailTransportForTests(undefined);
  await net?.close();
});

const settle = async () => {
  while (h.deferred.length) await h.deferred.shift();
};

describe('creating a REAL ask', () => {
  it('needs a name and company on the asker profile', async () => {
    const bare = await net.member('bare@example.com', {});
    expect(await canAskReal({ id: bare, email: 'bare@example.com' })).toEqual({ allowed: false, reason: 'profile_incomplete' });
    expect(await canAskReal(maya)).toEqual({ allowed: true });
  });

  it('checks the ask itself on the server and refuses YC-application asks', async () => {
    const bad = await createAsk(maya, { text: 'x', compiled: { ...compiledAsk(), parts: { ...compiledAsk().parts, by: '' } }, idempotency_key: 'k-bad' });
    expect(bad).toMatchObject({ ok: false, reason: 'invalid' });
    const yc = await createAsk(maya, { text: 'Can someone review my YC application before the batch deadline?', compiled: compiledAsk({ text: 'Can someone review my YC application before the batch deadline?' }), idempotency_key: 'k-yc' });
    expect(yc).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('is idempotent per key, drops a client-sent price and parses the deadline', async () => {
    const first = await createAsk(maya, { text: compiledAsk().text, compiled: compiledAsk({ price: '$1 (made up by the client)' }), idempotency_key: 'k-main' });
    expect(first).toMatchObject({ ok: true, status: 'ready', repeated: false });
    const again = await createAsk(maya, { text: compiledAsk().text, compiled: compiledAsk(), idempotency_key: 'k-main' });
    expect(again).toMatchObject({ ok: true, repeated: true, id: first.ok ? first.id : '' });
    const row = await net.one<{ compiled: { price: unknown }; deadline: string; status: string }>(`select compiled, deadline::text, status from public.asks where id = $1`, [first.ok ? first.id : '']);
    expect(row?.compiled.price).toBeNull();
    expect(row?.deadline).toMatch(/^\d{4}-11-20$/);
    ids.ask = first.ok ? first.id : '';
  });
});

describe('the REAL send', () => {
  const events: FanoutEvent[] = [];
  const persistedAtEmit: boolean[] = [];

  it('refuses someone else’s ask without touching it', async () => {
    const other = await startSend(ids.ask, { id: ids.marcus, email: 'marcus@example.com' }, { clientKey: null });
    expect(other).toMatchObject({ ok: false, status: 404 });
  });

  it('streams only the 4 asker states, persists each decision before streaming it, and emits every nothistime after the last gate', async () => {
    const start = await startSend(ids.ask, maya, { clientKey: null });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    for await (const e of start.events) {
      events.push(e);
      if (e.event === 'cell' && (e.data.state === 'next' || e.data.state === 'question')) {
        const row = await net.one<{ n: number }>(
          `select count(*)::int as n from public.gate_decisions d join public.ask_members am on am.ask_id = d.ask_id and am.member_id = d.member_id where d.ask_id = $1 and am.position = $2`,
          [ids.ask, e.data.cell],
        );
        persistedAtEmit.push(row?.n === 1);
      }
    }
    await settle();
    expect(persistedAtEmit.length).toBe(3);
    expect(persistedAtEmit.every(Boolean)).toBe(true);

    const plan = events[0];
    expect(plan).toEqual({ event: 'plan', data: { ask_id: ids.ask, network: 'real', total: 7 } });
    const cells = events.filter((e): e is Extract<FanoutEvent, { event: 'cell' }> => e.event === 'cell');
    for (const c of cells) {
      expect(Object.keys(c.data).sort()).toEqual(['cell', 'state']);
      expect(['offered', 'next', 'question', 'nothistime']).toContain(c.data.state);
    }
    const firstNothing = events.findIndex((e) => e.event === 'cell' && e.data.state === 'nothistime');
    const lastGate = events.map((e) => e.event === 'cell' && (e.data.state === 'next' || e.data.state === 'question')).lastIndexOf(true);
    expect(firstNothing).toBeGreaterThan(lastGate);
    // nothistime cells go out in position order
    const nothing = cells.filter((c) => c.data.state === 'nothistime').map((c) => c.data.cell);
    expect(nothing).toEqual([...nothing].sort((a, b) => a - b));
    const done = events[events.length - 1];
    expect(done.event).toBe('done');
    if (done.event === 'done') {
      expect(done.data.gates_ran).toBeNull();
      expect(done.data.people_interrupted).toBe(1);
      expect(done.data.counts).toEqual({ offered: 1, next: 1, question: 1, nothistime: 4 });
      expect(done.data.failed_closed).toBe(false);
    }
    const offer = events.find((e) => e.event === 'offer');
    expect(offer && Object.keys(offer.data)).toEqual(['expires_at']);
    const question = events.find((e) => e.event === 'question');
    expect(question?.data).toMatchObject({ type: 'price', text: 'What do you charge per customer, per year?', gates: 1 });
  });

  it('never streams a member id, email, name, cap or reason', () => {
    const json = JSON.stringify(events);
    for (const secret of [...Object.values(ids).filter((v) => v !== ids.ask), 'example.com', 'Priya', 'Ingrid', 'cap', 'used', 'topic', 'region', 'Postgres']) {
      expect(json).not.toContain(secret);
    }
  });

  it('offers the ask to the accept with the most unused cap, and the cap counts at delivery', async () => {
    const offers = await net.all<{ member_id: string; position: number; state: string }>(`select member_id, position, state from public.offers where ask_id = $1`, [ids.ask]);
    expect(offers).toEqual([{ member_id: ids.priya, position: 1, state: 'pending' }]);
    const used = await net.one<{ used: number }>(`select used from public.cap_usage where member_id = $1 and month = public.cap_month(now())`, [ids.priya]);
    expect(used?.used).toBe(1);
    const skipped = await net.all<{ skip: string }>(`select skip from public.ask_members where ask_id = $1 and skip is not null order by skip`, [ids.ask]);
    expect(skipped.map((s) => s.skip)).toEqual(['at_cap', 'paused', 'self']);
  });

  it('emails the offer once, with a link whose token hash is the stored one', async () => {
    const offerMail = mail.sent.filter((m) => m.key.startsWith('offer:'));
    expect(offerMail).toHaveLength(1);
    const m = offerMail[0]!;
    expect(m.to).toEqual(['priya@example.com']);
    const token = m.text.match(/\/o\/([A-Za-z0-9_-]{22})/)?.[1];
    expect(token).toBeTruthy();
    const row = await net.one<{ id: string; token_hash: string }>(`select id, token_hash from public.offers where ask_id = $1`, [ids.ask]);
    expect(m.key).toBe(`offer:${row?.id}`);
    expect(hashToken('offer', token!)).toBe(row?.token_hash);
    ids.priyaToken = token!;
    ids.priyaOffer = row!.id;
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('a second send of the same ask is already_sent', async () => {
    const again = await startSend(ids.ask, maya, { clientKey: null });
    expect(again).toMatchObject({ ok: false, status: 409, body: { error: 'already_sent', ask_id: ids.ask } });
  });
});

describe('the offer page and its actions', () => {
  it('shows the member their own matched words, the card facts and the cap', async () => {
    const res = await getOffer({ token: ids.priyaToken });
    expect(res.found).toBe(true);
    if (!res.found) return;
    expect(res.offer.matched).toEqual({ text: 'B2B founders selling to hospital groups in the US', start: 17, end: 66, line: RULES.priya });
    expect(res.offer.facts.map(([k]) => k)).toEqual(['Problem', 'Needs', 'Tried', 'By', 'Offers']);
    expect(res.offer).toMatchObject({ state: 'pending', nth: 1, cap: 2, title: 'Intro to a hospital procurement lead', member_first: 'Priya', asker: { first: 'Maya', company: 'Oakline Health' } });
    expect(JSON.stringify(res.offer)).not.toContain(ids.priya);
    expect(await memberForOffer({ token: ids.priyaToken })).toEqual({ member_id: ids.priya });
    expect(await getOffer({ token: 'A'.repeat(22) })).toEqual({ found: false, reason: 'invalid' });
    expect(await getOffer({ offer_id: ids.priyaOffer, member_id: ids.ingrid })).toEqual({ found: false, reason: 'invalid' });
  });

  it('No is private, idempotent, keeps the slot used, and moves the ask to the next person in line', async () => {
    const passedAt = new Date();
    const no = await respondToOffer({ token: ids.priyaToken }, 'no', { idempotency_key: `${ids.priyaToken}:no` }, passedAt);
    expect(no).toMatchObject({ ok: true, repeated: false, offer: { state: 'passed' } });
    const again = await respondToOffer({ token: ids.priyaToken }, 'no', { idempotency_key: `${ids.priyaToken}:no` });
    expect(again).toMatchObject({ ok: true, repeated: true });
    const ok = await respondToOffer({ token: ids.priyaToken }, 'ok', { idempotency_key: `${ids.priyaToken}:ok` });
    expect(ok).toMatchObject({ ok: false, reason: 'already_acted' });
    expect(await setNoReason({ token: ids.priyaToken }, 'not_my_area', null)).toEqual({ ok: true });
    // The next member's offer email goes out after the response (the member who said No doesn't wait for it).
    await settle();

    const offers = await net.all<{ member_id: string; position: number; state: string }>(`select member_id, position, state from public.offers where ask_id = $1 order by position`, [ids.ask]);
    expect(offers).toEqual([
      { member_id: ids.priya, position: 1, state: 'passed' },
      { member_id: ids.ingrid, position: 2, state: 'pending' },
    ]);
    const priyaUsed = await net.one<{ used: number }>(`select used from public.cap_usage where member_id = $1 and month = public.cap_month(now())`, [ids.priya]);
    expect(priyaUsed?.used).toBe(1);
    expect(mail.sent.filter((m) => m.key.startsWith('offer:')).map((m) => m.to[0])).toEqual(['priya@example.com', 'ingrid@example.com']);
    ids.passedAt = passedAt.toISOString();
  });

  it('the asker sees the move only at the next checkpoint, with a rounded reply-by and no hint of a pass', async () => {
    const at = new Date(ids.passedAt!);
    const before = await getAskerView(ids.ask, maya, at);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    // Unless the pass landed exactly on a checkpoint, nothing changed yet for the asker.
    if (ceilCheckpoint(at).getTime() !== at.getTime()) {
      expect(before.view.outcome).toBe('offered');
      expect(before.view.offered?.position).toBe(1);
      expect(before.view.people_interrupted).toBe(1);
    }
    const cp = ceilCheckpoint(at);
    const after = await getAskerView(ids.ask, maya, new Date(cp.getTime() + 1000));
    if (!after.ok) throw new Error('no view');
    expect(after.view.outcome).toBe('offered');
    expect(after.view.offered).toMatchObject({ position: 2, in_line: 2 });
    expect(after.view.offered?.reply_by).toBe(ceilCheckpoint(new Date(Date.parse(after.view.offered!.reply_by) - 1)).toISOString());
    expect(after.view.people_interrupted).toBe(2);
    expect(after.view.cells.filter((c) => c === 'offered')).toHaveLength(1);
    expect(after.view.matched_line).toBeNull(); // Ingrid didn't turn “show the line that matched” on
    expect(JSON.stringify(after.view)).not.toMatch(/pass|expire|declin|Ingrid|Priya|example\.com/i);
  });

  it('listMyAsks and the hook data use the same serializer', async () => {
    const list = await listMyAsks(maya);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.items.find((i) => i.id === ids.ask)).toMatchObject({ network: 'real', subject: 'Intro to a hospital procurement lead' });
    const pending = await listPendingForMember(ids.ingrid);
    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.pending.offers).toHaveLength(1);
      expect(pending.pending.offers[0]).toMatchObject({ title: 'Intro to a hospital procurement lead', matched: 'Long sales cycles with hospital groups and health systems' });
      expect(pending.pending.cap).toMatchObject({ cap: 2, used: 2 });
    }
    const asker = await listPendingForMember(maya.id);
    if (asker.ok) expect(asker.pending.questions).toEqual([expect.objectContaining({ ask_id: ids.ask, type: 'price', gates: 1 })]);
  });

  it('72 silent hours expire the offer lazily on read; with nobody left in line the ask waits on the question', async () => {
    const later = new Date(Date.now() + 73 * HOUR);
    const first = await getAskerView(ids.ask, maya, later);
    if (!first.ok) throw new Error('no view');
    const offers = await net.all<{ position: number; state: string; responded_at: Date }>(`select position, state, responded_at from public.offers where ask_id = $1 order by position`, [ids.ask]);
    expect(offers.map((o) => o.state)).toEqual(['passed', 'expired']);
    const audit = await net.all<{ action: string }>(`select action from public.audit where ask_id = $1 and action = 'offer_expired'`, [ids.ask]);
    expect(audit).toHaveLength(1);
    // The expiry is a member-side event: before its checkpoint the asker still sees the offer waiting.
    const expiredAt = new Date(offers[1]!.responded_at);
    const cp = ceilCheckpoint(expiredAt);
    if (cp.getTime() > later.getTime()) expect(first.view.outcome).toBe('offered');
    const view = await getAskerView(ids.ask, maya, new Date(Math.max(cp.getTime(), later.getTime()) + 1000));
    if (!view.ok) throw new Error('no view');
    expect(view.view.outcome).toBe('question');
    expect(view.view.questions).toEqual([expect.objectContaining({ type: 'price', gates: 1, answer: null })]);
    // A pass and an expiry read the same: both cells are nothistime.
    expect(view.view.cells.filter((c) => c === 'offered')).toHaveLength(0);
  });

  it('the answer reruns only the gate that asked, once, and the rerun accept gets the offer', async () => {
    const q = await net.one<{ id: string }>(`select id from public.questions where ask_id = $1`, [ids.ask]);
    const res = await answerQuestion({ ask_id: ids.ask, question_id: q!.id, answer: '$18k a year per customer', user: maya, idempotency_key: 'a1' });
    expect(res).toMatchObject({ ok: true, reran: 1, accepted: 1, repeated: false });
    const again = await answerQuestion({ ask_id: ids.ask, question_id: q!.id, answer: '$18k a year per customer', user: maya, idempotency_key: 'a1' });
    expect(again).toMatchObject({ ok: true, reran: 1, accepted: 1, repeated: true });
    const other = await answerQuestion({ ask_id: ids.ask, question_id: q!.id, answer: 'something else', user: maya, idempotency_key: 'a2' });
    expect(other).toEqual({ ok: false, reason: 'already_answered' });
    const stranger = await answerQuestion({ ask_id: ids.ask, question_id: q!.id, answer: 'x', user: { id: ids.marcus, email: 't@example.com' }, idempotency_key: 'a3' });
    expect(stranger).toEqual({ ok: false, reason: 'not_found' });
    const offers = await net.all<{ member_id: string; position: number; state: string }>(`select member_id, position, state from public.offers where ask_id = $1 order by position`, [ids.ask]);
    expect(offers[2]).toEqual({ member_id: ids.larsen, position: 3, state: 'pending' });
    const price = await net.one<{ price: string }>(`select compiled->>'price' as price from public.asks where id = $1`, [ids.ask]);
    expect(price?.price).toBe('$18k a year per customer');
  });

  it('the member whose gate asked sees the price on their card; OK makes the intro, its check-ins and one email to both', async () => {
    const qMail = mail.sent.filter((m) => m.key.startsWith('offer:')).pop()!;
    expect(qMail.to).toEqual(['q@example.com']);
    const token = qMail.text.match(/\/o\/([A-Za-z0-9_-]{22})/)![1]!;
    const view = await getOffer({ token });
    if (!view.found) throw new Error('no offer');
    expect(view.offer.facts.find(([k]) => k === 'Price')?.[1]).toBe('$18k a year per customer (Maya told your gate)');
    const ok = await respondToOffer({ token }, 'ok', { idempotency_key: `${token}:ok` });
    expect(ok).toMatchObject({ ok: true, repeated: false, offer: { state: 'ok' } });
    const again = await respondToOffer({ token }, 'ok', { idempotency_key: `${token}:ok` });
    expect(again).toMatchObject({ ok: true, repeated: true });
    await settle(); // the check-in emails are scheduled after the response

    const intro = await net.one<{ id: string; sent_at: string | null }>(`select id, sent_at from public.intros where ask_id = $1`, [ids.ask]);
    expect(intro?.sent_at).toBeTruthy();
    const introMail = mail.sent.filter((m) => m.key === `intro:${intro!.id}`);
    expect(introMail).toHaveLength(1);
    expect(introMail[0]!.to.sort()).toEqual(['maya@oakline.example', 'q@example.com']);
    expect(introMail[0]!.replyTo?.sort()).toEqual(['maya@oakline.example', 'q@example.com']);
    const checkins = await net.all<{ id: string; role: string; kind: string }>(`select id, role, kind from public.checkins where intro_id = $1 order by kind, role`, [intro!.id]);
    expect(checkins.map((c) => `${c.kind}:${c.role}`)).toEqual(['d1:asker', 'd1:member', 'd14:asker']);
    const keys = mail.sent.map((m) => m.key);
    for (const c of checkins) expect(keys).toContain(`${c.kind === 'd1' ? 'checkin1' : 'checkin14'}:${c.id}`);
    for (const m of mail.sent.filter((x) => x.key.startsWith('checkin'))) expect(m.scheduledAt).toBeTruthy();
    ids.intro = intro!.id;

    const asker = await getAskerView(ids.ask, maya);
    if (!asker.ok) throw new Error('no view');
    expect(asker.view.outcome).toBe('intro');
    expect(asker.view.intro).toMatchObject({ member_name: 'Quinn Rogers' });
  });

  it('check-ins: the token page reads the other person; answers save, repeat, change, schedule one reminder, and a useful outcome thanks the member', async () => {
    const d1 = mail.sent.find((m) => m.key.startsWith('checkin1:') && m.to[0] === 'maya@oakline.example')!;
    const token = d1.text.match(/\/c\/([A-Za-z0-9_-]{22})/)![1]!;
    const view = await getCheckin({ token });
    if (!view.found) throw new Error('no check-in');
    expect(view.checkin).toMatchObject({ kind: 'd1', role: 'asker', other_name: 'Quinn Rogers', other_first: 'Quinn', answer: null, intro_subject: 'Intro to a hospital procurement lead' });
    expect(await saveCheckin({ token }, { kind: 'd1', rating: 4 }, 'k1')).toMatchObject({ ok: true, repeated: false, checkin: { answer: { kind: 'd1', rating: 4 } } });
    expect(await saveCheckin({ token }, { kind: 'd1', rating: 4 }, 'k1')).toMatchObject({ ok: true, repeated: true });
    expect(await saveCheckin({ token }, { kind: 'd14', outcome: 'customer', note: null }, 'k2')).toMatchObject({ ok: false, reason: 'bad_input' });
    const notYet = await saveCheckin({ token }, { kind: 'd1', not_yet: true }, 'k3');
    expect(notYet).toMatchObject({ ok: true, checkin: { answer: { kind: 'd1', not_yet: true } } });
    await settle();
    const reminder = mail.sent.find((m) => m.key.endsWith(':reminder'));
    expect(reminder?.scheduledAt).toBeTruthy();
    await saveCheckin({ token }, { kind: 'd1', rating: 5 }, 'k4');
    await settle();
    expect(mail.cancelled.length).toBe(1);
    const late = await saveCheckin({ token }, { kind: 'd1', rating: 3 }, 'k5', new Date(Date.now() + 31 * 24 * HOUR));
    expect(late).toMatchObject({ ok: false, reason: 'closed' });

    const d14 = await net.one<{ id: string }>(`select id from public.checkins where intro_id = $1 and kind = 'd14'`, [ids.intro]);
    const saved = await saveCheckin({ checkin_id: d14!.id, member_id: maya.id }, { kind: 'd14', outcome: 'customer', note: 'Signed a pilot.' }, 'k6');
    expect(saved).toMatchObject({ ok: true });
    await settle();
    expect(mail.sent.filter((m) => m.key === `outcome:${ids.intro}`)).toHaveLength(1);
    expect(await getCheckin({ checkin_id: d14!.id, member_id: ids.marcus })).toEqual({ found: false, reason: 'invalid' });
  });
});
