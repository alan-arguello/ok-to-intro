import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  process.env.TOKEN_HMAC_SECRET = 'test-token-hmac-secret-0123456789abcdef';
  return {
    gate: null as null | ((input: { rules: string; answers?: unknown[] }) => Promise<unknown>),
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
vi.mock('@/lib/server/member', () => ({ createPauseLink: async () => null }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void h.deferred.push(Promise.resolve().then(fn)) }));

import { __setNetworkDbForTests } from '@/lib/server/audit';
import { createAsk, getAskerView, parseDeadline, resolveAsk, withdrawAsk } from '@/lib/server/asks';
import { ceilCheckpoint } from '@/lib/server/checkpoints';
import { runDaily } from '@/lib/server/cron';
import { startSend } from '@/lib/server/dispatch';
import { __setEmailTransportForTests, type EmailTransport } from '@/lib/server/email-send';
import { getOffer, respondToOffer } from '@/lib/server/offers';
import type { CompiledAsk, FanoutEvent, MemberRef } from '@/lib/types';
import { accepts, captureEmails, collect, compiledAsk, createNetworkDb, declines, fails, type NetworkDb } from './support';

const HOUR = 3_600_000;
let net: NetworkDb;
let mail: ReturnType<typeof captureEmails>;
let asker: MemberRef;
const m: Record<string, string> = {};
let seq = 0;

const RULES = [
  'Happy to talk about tender templates for hospitals.',
  'Hospital procurement questions are welcome here.',
  'Happy to talk about hospital buyers in the US.',
  'Happy to talk about public hospital pilots.',
  'Happy to talk about health founders in Illinois.',
];

async function settle() {
  while (h.deferred.length) await h.deferred.shift();
}

function allAccept() {
  h.gate = async (input) => {
    const quote = input.rules.split('.')[0] as string;
    return accepts(input.rules, quote);
  };
}

/** A new asker per test: repeat pairs (an asker offered to the same member within 90 days) stay out of the way. */
let askers = 0;
async function freshAsker(): Promise<MemberRef> {
  const email = `asker${++askers}@example.com`;
  const id = await net.member(email, { name: `Founder ${askers}`, company: 'Oakline Health', stage: 'Seed', city: 'Chicago' });
  asker = { id, email };
  return asker;
}

async function newAsk(overrides: Partial<CompiledAsk> = {}, who: MemberRef = asker): Promise<string> {
  const c = compiledAsk(overrides);
  const res = await createAsk(who, { text: c.text, compiled: c, idempotency_key: `k${++seq}` });
  if (!res.ok) throw new Error(`createAsk: ${res.reason}`);
  return res.id;
}

async function sendAll(id: string, who: MemberRef = asker): Promise<FanoutEvent[]> {
  const start = await startSend(id, who, { clientKey: null });
  if (!start.ok) throw new Error(`startSend: ${start.status} ${start.body.error}`);
  const events = await collect(start.events);
  await settle();
  return events;
}

const tokenFor = (key: string) => mail.sent.find((x) => x.key === key)?.text.match(/\/o\/([A-Za-z0-9_-]{22})/)?.[1] as string;

/** Resend, as the tests capture it, with a switch that makes intro emails fail (a 5xx-style application error). */
let failIntro = false;
function flaky(inner: EmailTransport): EmailTransport {
  return {
    async send(payload, options) {
      if (failIntro && options.idempotencyKey.startsWith('intro:')) return { id: null, error: { name: 'application_error', message: 'unavailable' } };
      return inner.send(payload, options);
    },
    cancel: (id) => inner.cancel(id),
  };
}

beforeAll(async () => {
  net = await createNetworkDb();
  __setNetworkDbForTests(net.transport);
  mail = captureEmails();
  __setEmailTransportForTests(flaky(mail.transport));
  const id = await net.member('asker@example.com', { name: 'Maya Bennett', company: 'Oakline Health', stage: 'Seed', city: 'Chicago' });
  asker = { id, email: 'asker@example.com' };
  for (const [i, rules] of RULES.entries()) m[`g${i}`] = await net.member(`g${i}@example.com`, { name: `Gate ${i}`, rules, cap: 5 });
});

afterAll(async () => {
  __setNetworkDbForTests(null);
  __setEmailTransportForTests(undefined);
  await net?.close();
});

beforeEach(async () => {
  allAccept();
  await freshAsker();
});

describe('parseDeadline', () => {
  const now = new Date('2026-11-09T21:04:00-08:00');
  it('reads the dates founders write, as the next such date in Pacific time', () => {
    expect(parseDeadline('Nov 20', now)).toBe('2026-11-20');
    expect(parseDeadline('before November 21, 2026', now)).toBe('2026-11-21');
    expect(parseDeadline('21 Nov', now)).toBe('2026-11-21');
    expect(parseDeadline('2027-01-15', now)).toBe('2027-01-15');
    expect(parseDeadline('Jan 15', now)).toBe('2027-01-15');
    expect(parseDeadline('Feb 30', now)).toBeNull();
    expect(parseDeadline('end of the month', now)).toBeNull();
    expect(parseDeadline('in 60 days', now)).toBeNull();
  });
});

describe('withdraw', () => {
  it('tells only the person holding the ask, asks nobody else, keeps their slot used, and is idempotent', async () => {
    const id = await newAsk();
    await sendAll(id);
    const holder = await net.one<{ id: string; member_id: string }>(`select id, member_id from public.offers where ask_id = $1 and state = 'pending'`, [id]);
    expect(holder).toBeTruthy();
    const res = await withdrawAsk(id, asker);
    expect(res).toMatchObject({ ok: true, repeated: false });
    expect(await withdrawAsk(id, asker)).toMatchObject({ ok: true, repeated: true });
    await settle(); // the note to the holder goes out after the response
    const offers = await net.all<{ state: string }>(`select state from public.offers where ask_id = $1`, [id]);
    expect(offers.map((o) => o.state)).toEqual(['withdrawn']);
    expect(mail.sent.filter((x) => x.key === `withdrawn:${holder!.id}`)).toHaveLength(1);
    const view = await getAskerView(id, asker);
    expect(view.ok && view.view.outcome).toBe('withdrawn');
    expect(view.ok && view.view.cells.every((c) => c === 'nothistime')).toBe(true);
    // The member's link still opens, and shows the withdrawal.
    const token = tokenFor(`offer:${holder!.id}`);
    const offer = await getOffer({ token });
    expect(offer.found && offer.offer.state).toBe('withdrawn');
    expect(await respondToOffer({ token }, 'ok', { idempotency_key: 'x' })).toMatchObject({ ok: false, reason: 'withdrawn' });
    expect(await withdrawAsk(id, { id: m.g0 as string, email: 'g0@example.com' })).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('fail closed', () => {
  it('offers nothing when more than 1 in 5 gates fail, says so, and a retry sends it again', async () => {
    const id = await newAsk();
    h.gate = async (input) => (input.rules === RULES[2] ? accepts(input.rules, 'Happy to talk about hospital buyers in the US') : fails('timeout'));
    const events = await sendAll(id);
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    if (done?.event === 'done') expect(done.data).toMatchObject({ failed_closed: true, people_interrupted: 0, gates_failed: 4, gates_ran: null });
    expect(events.some((e) => e.event === 'offer')).toBe(false);
    // the accept streamed as next, then every cell ended nothistime
    const lastStates = new Map<number, string>();
    for (const e of events) if (e.event === 'cell') lastStates.set(e.data.cell, e.data.state);
    expect([...lastStates.values()].every((s) => s === 'nothistime')).toBe(true);
    const view = await getAskerView(id, asker);
    expect(view.ok && view.view.outcome).toBe('failed');
    expect(view.ok && view.view.trace).toEqual([expect.stringContaining(`ask ${id} · compiled 5/5`), expect.stringContaining('gates done'), expect.stringContaining('nothing offered'), expect.stringContaining('people interrupted 0')]);

    allAccept();
    const retry = await sendAll(id);
    expect(retry.some((e) => e.event === 'offer')).toBe(true);
    const decisions = await net.one<{ n: number }>(`select count(*)::int as n from public.gate_decisions where ask_id = $1`, [id]);
    expect(decisions?.n).toBe(5);
  });
});

describe('answered in 2 lines', () => {
  it('reaches the asker at the next checkpoint without a name; Yes closes it, and a resolve before it shows is refused', async () => {
    const id = await newAsk();
    await sendAll(id);
    const offer = await net.one<{ id: string }>(`select id from public.offers where ask_id = $1 and state = 'pending'`, [id]);
    const token = tokenFor(`offer:${offer!.id}`);
    const at = new Date();
    const bad = await respondToOffer({ token }, 'answer', { answer: 'one\ntwo\nthree\nfour', idempotency_key: 'a' }, at);
    expect(bad).toMatchObject({ ok: false, reason: 'bad_input' });
    const res = await respondToOffer({ token }, 'answer', { answer: 'Ask for the technical annex first.\nThat is where pilots stall.', idempotency_key: 'a' }, at);
    expect(res).toMatchObject({ ok: true, offer: { state: 'answered', answer: 'Ask for the technical annex first.\nThat is where pilots stall.' } });

    const cp = ceilCheckpoint(at);
    if (cp.getTime() > at.getTime()) {
      const before = await getAskerView(id, asker, at);
      expect(before.ok && before.view.outcome).toBe('offered');
      expect(before.ok && before.view.answer).toBeNull();
      expect(await resolveAsk(id, asker, true, at)).toEqual({ ok: false, reason: 'not_answered' });
    }
    const after = await getAskerView(id, asker, new Date(cp.getTime() + 1));
    if (!after.ok) throw new Error('no view');
    expect(after.view.outcome).toBe('answered');
    expect(after.view.answer).toEqual({ text: 'Ask for the technical annex first.\nThat is where pilots stall.', at: cp.toISOString() });
    expect(JSON.stringify(after.view)).not.toMatch(/Gate \d|g\d@example/);
    const solved = await resolveAsk(id, asker, true, new Date(cp.getTime() + 2));
    expect(solved).toMatchObject({ ok: true, outcome: 'closed', repeated: false });
    expect(await resolveAsk(id, asker, true, new Date(cp.getTime() + 3))).toMatchObject({ ok: true, repeated: true });
  });

  it('No, keep it open moves it to the next person in line at once', async () => {
    const id = await newAsk();
    await sendAll(id);
    const offer = await net.one<{ id: string }>(`select id from public.offers where ask_id = $1 and state = 'pending'`, [id]);
    const at = new Date();
    await respondToOffer({ token: tokenFor(`offer:${offer!.id}`) }, 'answer', { answer: 'Short answer.', idempotency_key: 'b' }, at);
    const cp = new Date(ceilCheckpoint(at).getTime() + 1);
    const res = await resolveAsk(id, asker, false, cp);
    expect(res).toMatchObject({ ok: true, outcome: 'offered' });
    const view = await getAskerView(id, asker, cp);
    expect(view.ok && view.view.offered).toMatchObject({ position: 2 });
    expect(await net.one<{ n: number }>(`select count(*)::int as n from public.offers where ask_id = $1 and state = 'pending'`, [id])).toEqual({ n: 1 });
  });
});

describe('deadlines and settling', () => {
  it('past its deadline the ask closes instead of moving on', async () => {
    const id = await newAsk();
    await sendAll(id);
    // The deadline (a Pacific-time date) passes while the first person holds it.
    await net.db.pg.query(`update public.asks set deadline = (now() at time zone 'America/Los_Angeles')::date - 1 where id = $1`, [id]);
    const offer = await net.one<{ id: string }>(`select id from public.offers where ask_id = $1 and state = 'pending'`, [id]);
    const at = new Date();
    await respondToOffer({ token: tokenFor(`offer:${offer!.id}`) }, 'no', { idempotency_key: 'n' }, at);
    const row = await net.one<{ status: string; close_reason: string }>(`select status, close_reason from public.asks where id = $1`, [id]);
    expect(row).toEqual({ status: 'closed', close_reason: 'deadline' });
    const view = await getAskerView(id, asker, new Date(ceilCheckpoint(at).getTime() + 1));
    expect(view.ok && view.view.closed).toMatchObject({ reason: 'deadline', offered_count: 1 });
  });

  it('with no accept at all it is a no match, with coarse reasons over the whole network', async () => {
    h.gate = async (input) => declines(input.rules, 'topic');
    const id = await newAsk();
    const events = await sendAll(id);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { people_interrupted: 0, counts: { offered: 0, next: 0, question: 0, nothistime: 5 } } });
    const view = await getAskerView(id, asker);
    if (!view.ok) throw new Error('no view');
    expect(view.view.outcome).toBe('no_match');
    expect(view.view.no_match).toEqual({ why: { topic: 5, other: 0 }, suggestion: null });
    expect(view.view.people_interrupted).toBe(0);
  });
});

describe('3 open asks, the queue and one edited resend a week', () => {
  it('queues the 4th ask, refuses beyond 3 waiting, and sends the oldest queued one when an open ask closes', async () => {
    const id = await net.member('busy@example.com', { name: 'Busy Founder', company: 'Busy Co' });
    const busy = { id, email: 'busy@example.com' };
    const open = [await newAsk({}, busy), await newAsk({}, busy), await newAsk({}, busy)];
    const queued = [await newAsk({}, busy), await newAsk({}, busy), await newAsk({}, busy)];
    // By id, not by created_at: asks created in the same millisecond have no stable order.
    const statusOf = async (askId: string | undefined) => (await net.one<{ status: string }>(`select status from public.asks where id = $1`, [askId]))?.status;
    expect(await Promise.all(open.map(statusOf))).toEqual(['ready', 'ready', 'ready']);
    expect(await Promise.all(queued.map(statusOf))).toEqual(['queued', 'queued', 'queued']);
    const c = compiledAsk();
    expect(await createAsk(busy, { text: c.text, compiled: c, idempotency_key: 'one-too-many' })).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(await startSend(queued[0] as string, busy, { clientKey: null })).toMatchObject({ ok: false, status: 409, body: { error: 'queued' } });

    await withdrawAsk(open[0] as string, busy);
    await settle();
    const firstQueued = await net.one<{ status: string }>(`select status from public.asks where id = $1`, [queued[0]]);
    // promoted to ready, then sent in the background (the fan-out ran without anyone watching)
    expect(firstQueued?.status).toBe('open');
    const second = await net.one<{ status: string }>(`select status from public.asks where id = $1`, [queued[1]]);
    expect(second?.status).toBe('queued');
  });

  it('allows one edited resend of the same original a week, counting a chain of resends together', async () => {
    const original = await newAsk();
    const c = compiledAsk({ text: `${compiledAsk().text} We charge $18k a year per hospital.` });
    const first = await createAsk(asker, { text: c.text, compiled: c, idempotency_key: `r${++seq}`, resend_of: original });
    expect(first).toMatchObject({ ok: true });
    const second = await createAsk(asker, { text: c.text, compiled: c, idempotency_key: `r${++seq}`, resend_of: first.ok ? first.id : '' });
    expect(second).toMatchObject({ ok: false, reason: 'too_soon' });
    if (!second.ok) expect(Date.parse(second.retry_at as string)).toBeGreaterThan(Date.now() + 6 * 24 * HOUR);
    const notMine = await createAsk(asker, { text: c.text, compiled: c, idempotency_key: `r${++seq}`, resend_of: 'a_zzzzzz' });
    expect(notMine).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('the intro email', () => {
  it('an OK whose intro email fails stands, but nobody is told it went: the member taps again, the asker sees the intro once it is out', async () => {
    const id = await newAsk();
    await sendAll(id);
    const offer = await net.one<{ id: string }>(`select id from public.offers where ask_id = $1 and state = 'pending'`, [id]);
    const token = tokenFor(`offer:${offer!.id}`);
    failIntro = true;
    try {
      const first = await respondToOffer({ token }, 'ok', { idempotency_key: `${token}:ok` });
      expect(first).toMatchObject({ ok: false, reason: 'db_down', offer: { state: 'pending', responded_at: null } });
      await settle();
      // The OK stands (it can't be taken back); the intro exists, its email didn't go out, no check-in was scheduled.
      expect(await net.one(`select state from public.offers where id = $1`, [offer!.id])).toEqual({ state: 'ok' });
      const intro = await net.one<{ id: string; sent_at: Date | null }>(`select id, sent_at from public.intros where ask_id = $1`, [id]);
      expect(intro?.sent_at).toBeNull();
      const checkins = await net.all<{ id: string }>(`select id from public.checkins where intro_id = $1`, [intro!.id]);
      expect(checkins).toHaveLength(3);
      for (const c of checkins) expect(mail.sent.some((x) => x.key.endsWith(c.id))).toBe(false);
      // The asker sees the offer still waiting: no intro, no name. The member's page still waits on OK.
      const waiting = await getAskerView(id, asker);
      if (!waiting.ok) throw new Error('no view');
      expect(waiting.view.outcome).toBe('offered');
      expect(waiting.view.intro).toBeNull();
      expect(JSON.stringify(waiting.view)).not.toMatch(/Gate \d/);
      const look = await getOffer({ token });
      expect(look.found && look.offer.state).toBe('pending');
      // Whatever the member taps next retries the email; while it still fails, nothing claims it went.
      expect(await respondToOffer({ token }, 'no', { idempotency_key: `${token}:no` })).toMatchObject({ ok: false, reason: 'db_down' });
    } finally {
      failIntro = false;
    }
    const again = await respondToOffer({ token }, 'ok', { idempotency_key: `${token}:ok` });
    expect(again).toMatchObject({ ok: true, repeated: true, offer: { state: 'ok' } });
    await settle();
    const intro = await net.one<{ id: string; sent_at: Date }>(`select id, sent_at from public.intros where ask_id = $1`, [id]);
    expect(intro?.sent_at).toBeTruthy();
    expect(mail.sent.filter((x) => x.key === `intro:${intro!.id}`)).toHaveLength(1);
    const checkins = await net.all<{ id: string }>(`select id from public.checkins where intro_id = $1`, [intro!.id]);
    for (const c of checkins) expect(mail.sent.some((x) => x.key.endsWith(c.id))).toBe(true);
    if (again.ok) expect(again.offer.responded_at).toBe(new Date(intro!.sent_at).toISOString());
    const view = await getAskerView(id, asker);
    expect(view.ok && view.view.outcome).toBe('intro');
    expect(view.ok && view.view.intro?.sent_at).toBe(new Date(intro!.sent_at).toISOString());
    // The OK is done now: a No reads as already acted, with the intro sent.
    expect(await respondToOffer({ token }, 'no', { idempotency_key: `${token}:no` })).toMatchObject({ ok: false, reason: 'already_acted', offer: { state: 'ok' } });
  });

  it('the daily cron sends an intro email that never went out, then schedules its check-ins', async () => {
    const id = await newAsk();
    await sendAll(id);
    const offer = await net.one<{ id: string }>(`select id from public.offers where ask_id = $1 and state = 'pending'`, [id]);
    const token = tokenFor(`offer:${offer!.id}`);
    failIntro = true;
    try {
      expect(await respondToOffer({ token }, 'ok', { idempotency_key: `${token}:ok` })).toMatchObject({ ok: false, reason: 'db_down' });
    } finally {
      failIntro = false;
    }
    const report = await runDaily(new Date(Date.now() + 20 * 60_000));
    expect(report.intros).toBe(1);
    const intro = await net.one<{ id: string; sent_at: Date | null }>(`select id, sent_at from public.intros where ask_id = $1`, [id]);
    expect(intro?.sent_at).toBeTruthy();
    const checkins = await net.all<{ id: string }>(`select id from public.checkins where intro_id = $1`, [intro!.id]);
    for (const c of checkins) expect(mail.sent.some((x) => x.key.endsWith(c.id) && !!x.scheduledAt)).toBe(true);
    expect((await runDaily(new Date(Date.now() + 21 * 60_000))).intros).toBe(0);
  });
});

describe('a failed ask is still open to its asker', () => {
  it('counts toward the 3 open asks, so a retry can never make a 4th; withdrawing it sends the queued one', async () => {
    const uid = await net.member('retry@example.com', { name: 'Retry Founder', company: 'Retry Co' });
    const who = { id: uid, email: 'retry@example.com' };
    const failed = await newAsk({}, who);
    h.gate = async () => fails('timeout');
    await sendAll(failed, who);
    allAccept();
    const second = await newAsk({}, who);
    const third = await newAsk({}, who);
    const fourth = await newAsk({}, who);
    const statuses = new Map((await net.all<{ id: string; status: string }>(`select id, status from public.asks where asker_id = $1`, [uid])).map((r) => [r.id, r.status]));
    expect([failed, second, third, fourth].map((x) => statuses.get(x))).toEqual(['failed', 'ready', 'ready', 'queued']);
    await withdrawAsk(failed, who);
    await settle();
    expect(await net.one(`select status from public.asks where id = $1`, [fourth])).toEqual({ status: 'open' });
  });
});

describe('the daily cron', () => {
  it('ticks what nobody looked at and is idempotent', async () => {
    const id = await newAsk();
    await sendAll(id);
    const later = new Date(Date.now() + 80 * HOUR);
    const first = await runDaily(later);
    expect(first.network).toBe('configured');
    expect(first.ticked).toBeGreaterThan(0);
    const offers = await net.all<{ state: string }>(`select state from public.offers where ask_id = $1 order by position`, [id]);
    expect(offers[0]?.state).toBe('expired');
    expect(offers[1]?.state).toBe('pending');
    const again = await runDaily(later);
    const offers2 = await net.all<{ state: string }>(`select state from public.offers where ask_id = $1 order by position`, [id]);
    expect(offers2).toEqual(offers);
    expect(again.cleanup).toEqual({ drafts: 0, rate_limits: 0 });
  });
});
