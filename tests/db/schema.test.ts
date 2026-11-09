import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

const HEALTH_RULES = 'Happy to talk to B2B founders selling to public hospitals or insurers in Mexico or Colombia.\nNo asks to review a deck.';
let tokenSeq = 0;
const tokenHash = () => (++tokenSeq).toString(16).padStart(64, '0');

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => db?.close());

async function newAsk(id: string, asker: string) {
  await db.asService((tx) =>
    tx.query(`insert into public.asks (id, asker_id, raw, compiled, subject, status) values ($1, $2, 'raw ask text', '{}'::jsonb, 'Hospital procurement in Mexico, 20 min?', 'gating')`, [id, asker]),
  );
}
async function addToNetwork(askId: string, members: string[]) {
  for (const [i, m] of members.entries()) {
    await db.pg.query(`insert into public.ask_members (ask_id, member_id, position) values ($1, $2, $3)`, [askId, m, i]);
  }
}
async function offer(id: string, askId: string, member: string, at: string, position = 1) {
  const r = await db.asService((tx) =>
    tx.query<{ id: string }>(`select * from public.create_offer($1, $2, $3, $4, $5::smallint, $6::timestamptz)`, [id, askId, member, tokenHash(), position, at]),
  );
  return r.rows;
}
async function used(member: string, month: string) {
  const r = await db.pg.query<{ used: number }>(`select used from public.cap_usage where member_id = $1 and month = $2`, [member, month]);
  return r.rows[0]?.used ?? 0;
}

describe('cap_month', () => {
  it('uses the calendar month in Mexico City', async () => {
    const r = await db.pg.query<{ a: string; b: string }>(
      `select public.cap_month('2026-12-01T05:59:00Z')::text as a, public.cap_month('2026-12-01T06:00:00Z')::text as b`,
    );
    // 05:59 UTC on Dec 1 is 23:59 on Nov 30 in Mexico City (UTC−6).
    expect(r.rows[0]).toEqual({ a: '2026-11-01', b: '2026-12-01' });
  });
});

describe('reserve_slot', () => {
  let m: string;
  beforeAll(async () => {
    m = await db.createMember('slots@example.com', { rules: HEALTH_RULES, cap: 2 });
  });

  it('takes slots up to the cap, then refuses', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await db.asService((tx) => tx.query<{ ok: boolean }>(`select public.reserve_slot($1, '2026-11-01') as ok`, [m]));
      results.push(r.rows[0]?.ok === true);
    }
    expect(results).toEqual([true, true, false]);
    expect(await used(m, '2026-11-01')).toBe(2);
  });

  it('creates the counter row on first use and starts each month fresh', async () => {
    expect(await used(m, '2026-12-01')).toBe(0);
    const r = await db.asService((tx) => tx.query<{ ok: boolean }>(`select public.reserve_slot($1, '2026-12-01') as ok`, [m]));
    expect(r.rows[0]?.ok).toBe(true);
    const rows = await db.pg.query<{ month: string; used: number }>(`select month::text, used from public.cap_usage where member_id = $1 order by month`, [m]);
    expect(rows.rows).toEqual([
      { month: '2026-11-01', used: 2 },
      { month: '2026-12-01', used: 1 },
    ]);
  });

  it('respects a cap lowered mid-month', async () => {
    await db.pg.query(`update public.members set cap = 1 where id = $1`, [m]);
    const r = await db.asService((tx) => tx.query<{ ok: boolean }>(`select public.reserve_slot($1, '2026-12-01') as ok`, [m]));
    expect(r.rows[0]?.ok).toBe(false);
    expect(await used(m, '2026-12-01')).toBe(1);
  });

  it('rejects a month that is not the first day', async () => {
    await expect(db.asService((tx) => tx.query(`select public.reserve_slot($1, '2026-11-15')`, [m]))).rejects.toThrow(/first day/);
  });
});

describe('create_offer and the offer state machine', () => {
  let asker: string;
  let first: string; // cap 1
  let second: string; // cap 2
  beforeAll(async () => {
    asker = await db.createMember('asker@example.com', { rules: 'Happy to talk about tender templates.' });
    first = await db.createMember('first@example.com', { rules: HEALTH_RULES, cap: 1 });
    second = await db.createMember('second@example.com', { rules: HEALTH_RULES, cap: 2 });
    await newAsk('a_chain1', asker);
    await addToNetwork('a_chain1', [first, second]);
  });

  it('offers an ask to one member, with a 72-hour window, and counts the slot at delivery', async () => {
    const rows = await offer('o_chain1', 'a_chain1', first, '2027-01-04T21:04:00-06:00');
    expect(rows).toHaveLength(1);
    const o = (await db.pg.query<{ offered_at: Date; expires_at: Date; month: string }>(`select offered_at, expires_at, month::text from public.offers where id = 'o_chain1'`)).rows[0];
    expect(new Date(o!.expires_at).getTime() - new Date(o!.offered_at).getTime()).toBe(72 * 3600 * 1000);
    expect(o!.month).toBe('2027-01-01');
    expect(await used(first, '2027-01-01')).toBe(1);
  });

  it('never lets two people hold the same ask', async () => {
    expect(await offer('o_chain2', 'a_chain1', second, '2027-01-04T21:05:00-06:00', 2)).toHaveLength(0);
    expect(await used(second, '2027-01-01')).toBe(0);
  });

  it('refuses a member at cap and leaves their usage alone', async () => {
    await newAsk('a_chain2', asker);
    await addToNetwork('a_chain2', [first]);
    expect(await offer('o_chain3', 'a_chain2', first, '2027-01-05T10:00:00-06:00')).toHaveLength(0);
    expect(await used(first, '2027-01-01')).toBe(1);
  });

  it('moves out of pending once, stamps responded_at, then stays final', async () => {
    await db.pg.query(`update public.offers set state = 'passed' where id = 'o_chain1'`);
    const r = await db.pg.query<{ state: string; responded_at: Date | null }>(`select state, responded_at from public.offers where id = 'o_chain1'`);
    expect(r.rows[0]?.state).toBe('passed');
    expect(r.rows[0]?.responded_at).not.toBeNull();
    await expect(db.pg.query(`update public.offers set state = 'ok' where id = 'o_chain1'`)).rejects.toThrow(/already passed/);
    // The optional “Why?” after a pass is the one later change allowed.
    await db.pg.query(`update public.offers set no_reason = 'not_my_area' where id = 'o_chain1'`);
  });

  it('lets the next person in line hold the ask after a pass', async () => {
    expect(await offer('o_chain4', 'a_chain1', second, '2027-01-05T09:00:00-06:00', 2)).toHaveLength(1);
  });

  it('expires pending offers after 72 hours', async () => {
    const none = await db.asService((tx) => tx.query(`select id from public.expire_due_offers('2027-01-08T08:59:00-06:00')`));
    expect(none.rows).toHaveLength(0);
    const due = await db.asService((tx) => tx.query<{ id: string; state: string }>(`select id, state from public.expire_due_offers('2027-01-08T09:00:00-06:00')`));
    expect(due.rows).toEqual([{ id: 'o_chain4', state: 'expired' }]);
  });

  it('caps a 2-line answer at 280 characters and 2 line breaks', async () => {
    await newAsk('a_chain3', asker);
    await addToNetwork('a_chain3', [second]);
    expect(await offer('o_chain5', 'a_chain3', second, '2027-01-09T10:00:00-06:00')).toHaveLength(1);
    await expect(db.pg.query(`update public.offers set state = 'answered', answer = E'a\\nb\\nc\\nd' where id = 'o_chain5'`)).rejects.toThrow();
    await db.pg.query(`update public.offers set state = 'answered', answer = E'Ask for the annex.\\nThat is where pilots stall.' where id = 'o_chain5'`);
  });
});

describe('save_rules', () => {
  let m: string;
  let other: string;
  beforeAll(async () => {
    m = await db.createMember('rules@example.com', { rules: HEALTH_RULES });
    other = await db.createMember('rules-other@example.com', { rules: HEALTH_RULES });
  });

  it('creates a new version on each save and keeps the current one in rules', async () => {
    const v2 = await db.asUser(m, (tx) => tx.query<{ v: number }>(`select public.save_rules($1, $2, 'web') as v`, [m, `${HEALTH_RULES}\nNo asks about public procurement.`]));
    expect(v2.rows[0]?.v).toBe(2);
    const cur = await db.pg.query<{ version: number; text: string }>(`select version, text from public.rules where member_id = $1`, [m]);
    expect(cur.rows[0]?.version).toBe(2);
    expect(cur.rows[0]?.text).toMatch(/public procurement/);
    const versions = await db.asUser(m, (tx) => tx.query(`select version from public.rule_versions where member_id = $1`, [m]));
    expect(versions.rows).toHaveLength(2);
  });

  it('refuses to save someone else’s rules', async () => {
    await expect(db.asUser(m, (tx) => tx.query(`select public.save_rules($1, 'No asks.', 'web')`, [other]))).rejects.toThrow(/not your rules/);
  });

  it('refuses empty and over-long rules', async () => {
    await expect(db.asService((tx) => tx.query(`select public.save_rules($1, '   ', 'web')`, [m]))).rejects.toThrow(/1 to 1000/);
    await expect(db.asService((tx) => tx.query(`select public.save_rules($1, repeat('x', 1001), 'web')`, [m]))).rejects.toThrow(/1 to 1000/);
  });
});

describe('row level security', () => {
  let ana: string;
  let lucia: string;
  let tomas: string;
  beforeAll(async () => {
    ana = await db.createMember('ana@example.com', { rules: HEALTH_RULES });
    lucia = await db.createMember('lucia@orvella.example', { rules: 'Happy to talk about tender templates.' });
    tomas = await db.createMember('tomas@example.com', { rules: 'Happy to talk about Postgres.' });
    await newAsk('a_rls1', lucia);
    await addToNetwork('a_rls1', [ana, tomas]);
    await db.pg.query(
      `insert into public.gate_decisions (ask_id, member_id, rules_version, verdict, model_verdict, decided_by, reason_code, reason)
       values ('a_rls1', $1, 1, 'accept', 'accept', 'gate', 'match', 'Public hospitals.'), ('a_rls1', $2, 1, 'decline', 'decline', 'gate', 'topic', 'Postgres only.')`,
      [ana, tomas],
    );
    await offer('o_rls1', 'a_rls1', ana, '2027-02-01T10:00:00-06:00');
  });

  it('anon reads nothing', async () => {
    for (const table of ['members', 'rules', 'rule_versions', 'cap_usage', 'asks', 'offers', 'gate_decisions', 'audit', 'api_tokens', 'checkins', 'real_askers']) {
      await expect(db.asAnon((tx) => tx.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it('anon and members cannot call server-side functions', async () => {
    for (const sql of [`select public.reserve_slot($1)`, `select * from public.prefilter_members($1)`]) {
      await expect(db.asAnon((tx) => tx.query(sql, [ana]))).rejects.toThrow(/permission denied/);
      await expect(db.asUser(ana, (tx) => tx.query(sql, [ana]))).rejects.toThrow(/permission denied/);
    }
    await expect(db.asUser(ana, (tx) => tx.query(`select public.board_snapshot()`))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(ana, (tx) => tx.query(`select * from public.expire_due_offers()`))).rejects.toThrow(/permission denied/);
  });

  it('a member reads only their own rows', async () => {
    const members = await db.asUser(ana, (tx) => tx.query<{ id: string }>(`select id from public.members`));
    expect(members.rows.map((r) => r.id)).toEqual([ana]);
    const rules = await db.asUser(ana, (tx) => tx.query<{ member_id: string }>(`select member_id from public.rules`));
    expect(rules.rows.map((r) => r.member_id)).toEqual([ana]);
    const offers = await db.asUser(ana, (tx) => tx.query<{ id: string }>(`select id from public.offers`));
    expect(offers.rows.map((r) => r.id)).toEqual(['o_rls1']);
    // Ana was offered Lucía's ask but did not write it: the ask row stays the asker's.
    expect((await db.asUser(ana, (tx) => tx.query(`select id from public.asks`))).rows).toHaveLength(0);
    // Tomás was checked and declined: he sees nothing about it.
    expect((await db.asUser(tomas, (tx) => tx.query(`select id from public.offers`))).rows).toHaveLength(0);
  });

  it('an asker sees their own asks but never gate decisions or who was checked', async () => {
    const asks = await db.asUser(lucia, (tx) => tx.query<{ id: string }>(`select id from public.asks`));
    expect(asks.rows.map((r) => r.id)).toEqual(['a_rls1']);
    await expect(db.asUser(lucia, (tx) => tx.query(`select * from public.gate_decisions`))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(lucia, (tx) => tx.query(`select * from public.ask_members`))).rejects.toThrow(/permission denied/);
    // RLS hides the member's offer row from the asker.
    expect((await db.asUser(lucia, (tx) => tx.query(`select id from public.offers`))).rows).toHaveLength(0);
  });

  it('a member edits only their own settings columns', async () => {
    await db.asUser(ana, (tx) => tx.query(`update public.members set cap = 3 where id = $1`, [ana]));
    const other = await db.asUser(ana, (tx) => tx.query(`update public.members set cap = 5 where id = $1`, [tomas]));
    expect(other.affectedRows ?? 0).toBe(0);
    await expect(db.asUser(ana, (tx) => tx.query(`update public.members set email = 'x@example.com' where id = $1`, [ana]))).rejects.toThrow(/permission denied/);
    const caps = await db.pg.query<{ id: string; cap: number }>(`select id, cap from public.members where id in ($1, $2)`, [ana, tomas]);
    expect(Object.fromEntries(caps.rows.map((r) => [r.id, r.cap]))).toEqual({ [ana]: 3, [tomas]: 2 });
  });
});

describe('prefilter_members', () => {
  it('drops the asker, paused members, members at cap and repeat pairs', async () => {
    const asker = await db.createMember('pf-asker@example.com', { rules: 'Happy to talk about queues.' });
    const free = await db.createMember('pf-free@example.com', { rules: 'Happy to talk about queues.' });
    const paused = await db.createMember('pf-paused@example.com', { rules: 'Happy to talk about queues.', status: 'paused' });
    const full = await db.createMember('pf-full@example.com', { rules: 'Happy to talk about queues.', cap: 1 });
    const repeat = await db.createMember('pf-repeat@example.com', { rules: 'Happy to talk about queues.', cap: 5 });
    const pending = await db.createMember('pf-pending@example.com', { rules: 'Happy to talk about queues.', status: 'pending' });
    await db.asService((tx) => tx.query(`select public.reserve_slot($1, '2027-03-01')`, [full]));
    await newAsk('a_pfx1', asker);
    await addToNetwork('a_pfx1', [repeat]);
    expect(await offer('o_pfx1', 'a_pfx1', repeat, '2027-03-02T10:00:00-06:00')).toHaveLength(1);

    const r = await db.asService((tx) =>
      tx.query<{ member_id: string; skip: string | null; rules_text: string }>(`select member_id, skip, rules_text from public.prefilter_members($1, '2027-03-10T12:00:00-06:00')`, [asker]),
    );
    const skip = new Map(r.rows.map((x) => [x.member_id, x.skip]));
    expect(skip.get(asker)).toBe('self');
    expect(skip.get(paused)).toBe('paused');
    expect(skip.get(full)).toBe('at_cap');
    expect(skip.get(repeat)).toBe('repeat_pair');
    expect(skip.get(free)).toBeNull();
    expect(skip.has(pending)).toBe(false); // gate not on yet: not in the network
  });

  it('lets a timed pause end by itself', async () => {
    const asker = await db.createMember('pf2-asker@example.com', { rules: 'Happy to talk about queues.' });
    const m = await db.createMember('pf2-paused@example.com', { rules: 'Happy to talk about queues.' });
    await db.pg.query(`update public.members set status = 'paused', paused_until = '2027-04-01T00:00:00-06:00' where id = $1`, [m]);
    const before = await db.asService((tx) => tx.query<{ skip: string | null }>(`select skip from public.prefilter_members($1, '2027-03-31T12:00:00-06:00') where member_id = $2`, [asker, m]));
    const after = await db.asService((tx) => tx.query<{ skip: string | null }>(`select skip from public.prefilter_members($1, '2027-04-01T12:00:00-06:00') where member_id = $2`, [asker, m]));
    expect(before.rows[0]?.skip).toBe('paused');
    expect(after.rows[0]?.skip).toBeNull();
  });
});

describe('hit_rate_limit', () => {
  it('allows up to the limit per window', async () => {
    const hits: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await db.asService((tx) => tx.query<{ allowed: boolean }>(`select allowed from public.hit_rate_limit('k1', 'try', 600, 3)`));
      hits.push(r.rows[0]?.allowed === true);
    }
    expect(hits).toEqual([true, true, true, false]);
  });
});

describe('board_snapshot and real_line', () => {
  it('count facts from audit, and the counts survive a member deleting their data', async () => {
    const a = await db.createMember('board-a@example.com', { rules: HEALTH_RULES });
    const b = await db.createMember('board-b@example.com', { rules: HEALTH_RULES });
    await db.asService((tx) =>
      tx.query(
        `insert into public.audit (action, member_id, asker_id, ask_id, offer_id, detail) values
          ('member_joined', $1, null, null, null, '{}'),
          ('ask_sent', null, $2, 'a_brd1', null, '{"topic":"Hospital procurement, Mexico"}'),
          ('gate_checked', $1, $2, 'a_brd1', null, '{"verdict":"accept","decided_by":"gate","attempt":1}'),
          ('gate_checked', $2, $1, 'a_brd1', null, '{"verdict":"decline","decided_by":"clause_check","attempt":1}'),
          ('offer_delivered', $1, $2, 'a_brd1', 'o_brd1', '{}')`,
        [a, b],
      ),
    );
    const snap = async () => (await db.asService((tx) => tx.query<{ s: Record<string, number> }>(`select public.board_snapshot() as s`))).rows[0]?.s as Record<string, number>;
    const s = await snap();
    expect(s.gate_checks).toBeGreaterThanOrEqual(2);
    expect(s.quotes_not_found).toBeGreaterThanOrEqual(1);
    const interrupted = s.interrupted;
    // Deleting a member removes their rows but not the facts the board counts.
    await db.pg.query(`delete from auth.users where id = $1`, [a]);
    const after = await snap();
    expect(after.interrupted).toBe(interrupted);
    const leftover = await db.pg.query(`select member_id from public.audit where action = 'offer_delivered' and ask_id = 'a_brd1'`);
    expect(leftover.rows[0]).toEqual({ member_id: null });
    const line = await db.asService((tx) => tx.query<{ l: Record<string, unknown> }>(`select public.real_line() as l`));
    expect(line.rows[0]?.l).toMatchObject({ intros: 0 });
  });
});
