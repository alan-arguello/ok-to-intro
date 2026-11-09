import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TOKEN_HMAC_SECRET = 'test-token-hmac-secret-0123456789abcdef';
});

vi.mock('@/lib/server/member', () => ({ createPauseLink: async () => null }));
vi.mock('next/server', () => ({ after: () => undefined }));

import { __setNetworkDbForTests, rpc } from '@/lib/server/audit';
import { __setEmailTransportForTests } from '@/lib/server/email-send';
import { mintSlots } from '@/lib/server/offers';
import { captureEmails, createNetworkDb, type NetworkDb } from './support';

/**
 * The cap under interleaving, logically (PGlite is one connection, so these calls run one after another in
 * arbitrary interleavings; `npm run race` proves the same against a real Postgres with 20 concurrent requests).
 */

let net: NetworkDb;
let target: string;
const asks: string[] = [];
const RULES = 'Happy to talk about Postgres or Kafka at scale.';

async function gatingAsk(id: string, asker: string, members: string[]) {
  await net.db.pg.query(
    `insert into public.asks (id, asker_id, raw, compiled, subject, status, sent_at) values ($1, $2, 'raw', '{"parts":{},"subject":"s","text":"t","price":null,"topic":null}'::jsonb, 'Postgres p95 at 40M rows, 20 min?', 'gating', now())`,
    [id, asker],
  );
  for (const [i, m] of members.entries()) await net.db.pg.query(`insert into public.ask_members (ask_id, member_id, position) values ($1, $2, $3)`, [id, m, i]);
}

async function accept(askId: string, member: string, at = new Date()) {
  const r = await rpc('net_record_decision', {
    p_ask: askId,
    p_member: member,
    p_attempt: 1,
    p_rules_version: 1,
    p_result: { verdict: 'accept', model_verdict: 'accept', cited: [{ text: 'Postgres', found: true, start: 20, end: 28 }], decided_by: 'gate', clause_verified: true, reason_code: 'match', reason: 'fits', question: null, flags: [], confidence: null, error_kind: null, latency_ms: 900 },
    p_now: at.toISOString(),
  });
  expect(r.ok).toBe(true);
}

beforeAll(async () => {
  net = await createNetworkDb();
  __setNetworkDbForTests(net.transport);
  __setEmailTransportForTests(captureEmails().transport);
  target = await net.member('target@example.com', { name: 'Sofía Peralta', rules: RULES, cap: 2 });
  // One free slot left this month.
  await net.db.pg.query(`insert into public.cap_usage (member_id, month, used) values ($1, public.cap_month(now()), 1)`, [target]);
  for (let i = 0; i < 20; i++) {
    const asker = await net.member(`racer${i}@example.com`, { name: `Racer ${i}`, company: 'Race Co' });
    const id = `a_race${String(i).padStart(2, '0')}`;
    await gatingAsk(id, asker, [target]);
    await accept(id, target);
    asks.push(id);
  }
});

afterAll(async () => {
  __setNetworkDbForTests(null);
  __setEmailTransportForTests(undefined);
  await net?.close();
});

describe('20 asks against 1 free slot', () => {
  it('finishing all 20 sends at once makes exactly 1 offer; the other 19 settle without interrupting anyone', async () => {
    const now = new Date().toISOString();
    const results = await Promise.all(asks.map((id) => rpc<{ outcome: string }>('net_finish_send', { p_ask: id, p_now: now, p_slots: mintSlots(2) })));
    const outcomes = results.map((r) => (r.ok ? r.data.outcome : `error:${r.reason}`));
    expect(outcomes.filter((o) => o === 'offered')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'no_match')).toHaveLength(19);
    const offers = await net.one<{ n: number }>(`select count(*)::int as n from public.offers where member_id = $1`, [target]);
    expect(offers?.n).toBe(1);
    const used = await net.one<{ used: number }>(`select used from public.cap_usage where member_id = $1 and month = public.cap_month(now())`, [target]);
    expect(used?.used).toBe(2);
    const overruns = await net.one<{ n: number }>(`select (public.board_snapshot()->>'cap_overruns')::int as n`);
    expect(overruns?.n).toBe(0);
  });

  it('create_offer on its own, interleaved across asks: one row, then no row for every later one (the cap is full)', async () => {
    const extra = await net.member('second@example.com', { rules: RULES, cap: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const asker = await net.member(`inter${i}@example.com`, { name: `Inter ${i}`, company: 'Co' });
      const id = `a_inter${String(i).padStart(2, '0')}`;
      await gatingAsk(id, asker, [extra]);
      ids.push(id);
    }
    // Interleave: odd asks first, then even ones, then all again.
    const order = [...ids.filter((_, i) => i % 2), ...ids.filter((_, i) => i % 2 === 0)];
    let made = 0;
    for (const id of [...order, ...order]) {
      const slot = mintSlots(1)[0]!;
      // Each call is its own transaction; OTI01 (that ask is already held) aborts only that one.
      const r = await net.db
        .asService((tx) => tx.query(`select * from public.create_offer($1, $2, $3, $4, 1::smallint, now())`, [slot.offer_id, id, extra, slot.token_hash]))
        .then(
          (x) => x.rows.length,
          (e: { code?: string }) => (e.code === 'OTI01' ? -1 : Promise.reject(e)),
        );
      if (r === 1) made += 1;
    }
    expect(made).toBe(1);
  });

  it('a second offer for an ask someone holds stops with OTI01; an ask that isn’t open stops with OTI02', async () => {
    const holder = await net.one<{ ask_id: string }>(`select ask_id from public.offers where member_id = $1 and state = 'pending'`, [target]);
    expect(holder).toBeTruthy();
    const someone = await net.member('someone@example.com', { rules: RULES, cap: 5 });
    await net.db.pg.query(`insert into public.ask_members (ask_id, member_id, position) values ($1, $2, 1)`, [holder!.ask_id, someone]);
    const slot = mintSlots(1)[0]!;
    await expect(net.db.asService((tx) => tx.query(`select * from public.create_offer($1, $2, $3, $4, 2::smallint, now())`, [slot.offer_id, holder!.ask_id, someone, slot.token_hash]))).rejects.toMatchObject({ code: 'OTI01' });
    const closed = asks.find((id) => id !== holder!.ask_id)!;
    await expect(net.db.asService((tx) => tx.query(`select * from public.create_offer($1, $2, $3, $4, 1::smallint, now())`, [slot.offer_id, closed, someone, slot.token_hash]))).rejects.toMatchObject({ code: 'OTI02' });
  });

  it('the line skips an accept at its cap and offers the next one (best accept = most unused cap, then the earliest answer)', async () => {
    const asker = await net.member('liner@example.com', { name: 'Liner', company: 'Line Co' });
    const full = await net.member('full@example.com', { rules: RULES, cap: 1 });
    const roomy = await net.member('roomy@example.com', { rules: RULES, cap: 3 });
    const early = await net.member('early@example.com', { rules: RULES, cap: 3 });
    await gatingAsk('a_line01', asker, [full, roomy, early]);
    const t0 = Date.now();
    await accept('a_line01', full, new Date(t0));
    await accept('a_line01', early, new Date(t0 + 100));
    await accept('a_line01', roomy, new Date(t0 + 200));
    // full has 1 unused, roomy and early 3 each: early answered first.
    const r = await rpc<{ outcome: string; offer_id: string }>('net_finish_send', { p_ask: 'a_line01', p_now: new Date().toISOString(), p_slots: mintSlots(3) });
    expect(r.ok && r.data.outcome).toBe('offered');
    const o = await net.one<{ member_id: string }>(`select member_id from public.offers where ask_id = 'a_line01'`);
    expect(o?.member_id).toBe(early);
    // Now fill `full`'s cap elsewhere; after early passes, roomy (not full) gets it.
    await net.db.pg.query(`insert into public.cap_usage (member_id, month, used) values ($1, public.cap_month(now()), 1) on conflict (member_id, month) do update set used = 1`, [full]);
    await net.db.pg.query(`update public.offers set state = 'passed', responded_at = now() where ask_id = 'a_line01'`);
    const next = await rpc<{ outcome: string }>('net_advance', { p_ask: 'a_line01', p_now: new Date().toISOString(), p_slots: mintSlots(3) });
    expect(next.ok && next.data.outcome).toBe('offered');
    const o2 = await net.all<{ member_id: string; position: number }>(`select member_id, position from public.offers where ask_id = 'a_line01' order by position`);
    expect(o2.map((x) => x.member_id)).toEqual([early, roomy]);
    // full is still accepted and in line, but can't take it: when roomy passes too, the ask closes.
    await net.db.pg.query(`update public.offers set state = 'passed', responded_at = now() where ask_id = 'a_line01' and state = 'pending'`);
    const last = await rpc<{ outcome: string; reason: string }>('net_advance', { p_ask: 'a_line01', p_now: new Date().toISOString(), p_slots: mintSlots(3) });
    expect(last.ok && last.data).toMatchObject({ outcome: 'closed', reason: 'all_passed' });
  });
});
