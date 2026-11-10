/**
 * npm run race — “20 concurrent asks, 1 free slot, exactly 1 offer.” (ux-spec S8 /how: “Caps live in Postgres.”)
 *
 * Two races, each against a member with exactly 1 free slot this month (cap 2, 1 used):
 *   1. 20 `create_offer` calls at once, one per ask: the primitive. reserve_slot's row lock lets exactly one take
 *      the slot; the other 19 get no row.
 *   2. 20 `net_finish_send` calls at once: the app's own path. Each of 20 sends ends with that member as its only
 *      accept; the advance offers each ask to the best accept through create_offer. Exactly one ask is offered, and
 *      the other 19 settle without interrupting anyone (no match: their one accept had no room left).
 * Pass = exactly 1 offer and `used` = the cap, in both.
 *
 * With a Supabase project (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY): real concurrency. Every call is its
 * own HTTP request through supabase-js, so its own transaction on its own pooled connection. It creates throwaway
 * members with `auth.admin.createUser({ email: 'race-…@example.invalid', email_confirm: true })` (no email is sent)
 * and deletes them afterwards (their rows cascade), plus the audit facts the second race wrote. Use a dev project,
 * never production: it touches only the rows it created, but the board would count them while they exist.
 *
 * Without them: the logical version on PGlite (the same migrations; one connection, so the transactions interleave
 * but can't overlap). It proves the rule, not the concurrency, says so, and exits 2 with SKIPPED: a skipped run never
 * prints “passed”.
 *
 * Exit codes: 0 passed (concurrent) · 1 failed · 2 skipped (no Supabase project configured).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/supabase/database.types';
import { capMonth } from '../lib/oti/time';

const N = 20;
const RULES = 'Happy to talk about churn and retention in B2B software.';
const QUOTE = 'churn and retention in B2B software';

const hex64 = () => randomBytes(32).toString('hex');
const offerId = () => `o_race${randomBytes(6).toString('hex').slice(0, 10)}`;
const askId = (phase: number, i: number, run: string) => `a_r${phase}${run}${String(i).padStart(2, '0')}`;
const compiled = { parts: { challenge: 'race', tried: 'race', needs: 'race', by: 'race', offers: 'race' }, subject: 'Race test', text: 'Race test ask (throwaway).', price: null, topic: null };
const cited = [{ text: QUOTE, found: true, start: RULES.indexOf(QUOTE), end: RULES.indexOf(QUOTE) + QUOTE.length }];

function line(label: string, value: string) {
  console.log(`${label.padEnd(22)}${value}`);
}

interface PhaseResult {
  made: number;
  used: number;
  errors: string[];
  ms: number;
  outcomes?: Record<string, number>;
}

function report(name: string, r: PhaseResult): boolean {
  line(name, `${N} calls in ${r.ms} ms · ${r.made} offer · cap ${r.used} of 2${r.outcomes ? ` · ${Object.entries(r.outcomes).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`);
  if (r.errors.length) line('errors', r.errors.join(', '));
  const outcomesOk = !r.outcomes || (r.outcomes.offered === 1 && (r.outcomes.no_match ?? 0) === N - 1);
  return r.made === 1 && r.used === 2 && r.errors.length === 0 && outcomesOk;
}

/* ========================================================================== *
 * Concurrent: a Supabase dev project
 * ========================================================================== */

async function concurrent(url: string, key: string): Promise<number> {
  const db: SupabaseClient<Database> = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // The 0002 functions aren't in the hand-written Database type (docs/requests/be2-network.md): call them untyped.
  const rpc = db.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
  const run = randomBytes(3).toString('hex');
  const month = capMonth();
  const users: string[] = [];
  const allAsks: string[] = [];
  const createUser = async (tag: string) => {
    const email = `race-${run}-${tag}@example.invalid`;
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message ?? 'no user'}`);
    users.push(data.user.id);
    return { id: data.user.id, email };
  };
  const must = <T extends { error: { message: string } | null }>(label: string, res: T): T => {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
    return res;
  };

  /** A member with exactly 1 free slot this month, and 20 asks (from 20 askers) that all want them. */
  async function setup(phase: 1 | 2) {
    const target = await createUser(`p${phase}-member`);
    must('member', await db.from('members').insert({ id: target.id, email: target.email, name: 'Race member', cap: 2, status: 'on' }));
    must('save_rules', await db.rpc('save_rules', { p_member: target.id, p_text: RULES, p_source: 'web' }));
    must('cap_usage', await db.from('cap_usage').insert({ member_id: target.id, month, used: 1 }));
    const asks: string[] = [];
    for (let i = 0; i < N; i++) {
      const asker = await createUser(`p${phase}-asker${i}`);
      must('asker', await db.from('members').insert({ id: asker.id, email: asker.email, name: `Race asker ${i}`, company: 'Race Co', status: 'pending' }));
      const id = askId(phase, i, run);
      must('ask', await db.from('asks').insert({ id, asker_id: asker.id, raw: compiled.text, compiled, subject: 'Race test, 20 min?', status: 'gating', network_size: 1, idempotency_key: randomUUID() }));
      must('ask_members', await db.from('ask_members').insert({ ask_id: id, member_id: target.id, position: 0 }));
      if (phase === 2) {
        must('gate_decisions', await db.from('gate_decisions').insert({
          ask_id: id, member_id: target.id, attempt: 1, rules_version: 1, verdict: 'accept', model_verdict: 'accept', cited,
          decided_by: 'gate', clause_verified: true, reason_code: 'match', reason: 'Race test accept.', source: 'live',
        }));
      }
      asks.push(id);
      allAsks.push(id);
    }
    return { target, asks };
  }

  async function usedOf(member: string): Promise<number> {
    const usage = await db.from('cap_usage').select('used').eq('member_id', member).eq('month', month).single();
    return usage.data?.used ?? -1;
  }

  try {
    console.log(`ok-to-intro · race test · ${N} concurrent asks · 1 free slot · Supabase (${new URL(url).host})`);

    // 1. create_offer, 20 at once.
    const one = await setup(1);
    let started = Date.now();
    const created = await Promise.all(one.asks.map((id) => db.rpc('create_offer', { p_offer_id: offerId(), p_ask_id: id, p_member: one.target.id, p_token_hash: hex64(), p_position: 1 })));
    const first: PhaseResult = {
      ms: Date.now() - started,
      made: created.filter((r) => !r.error && Array.isArray(r.data) && r.data.length === 1).length,
      errors: created.filter((r) => r.error).map((r) => r.error?.code ?? 'error'),
      used: await usedOf(one.target.id),
    };

    // 2. The app's path: 20 sends finish at once.
    const two = await setup(2);
    started = Date.now();
    const now = new Date().toISOString();
    const finished = await Promise.all(two.asks.map((id) => rpc('net_finish_send', { p_ask: id, p_now: now, p_slots: [{ offer_id: offerId(), token_hash: hex64() }] })));
    const outcomes: Record<string, number> = {};
    for (const r of finished) {
      const o = r.error ? 'error' : String((r.data as { outcome?: string } | null)?.outcome ?? 'none');
      outcomes[o] = (outcomes[o] ?? 0) + 1;
    }
    const offers = await db.from('offers').select('id').eq('member_id', two.target.id);
    const second: PhaseResult = {
      ms: Date.now() - started,
      made: offers.data?.length ?? -1,
      errors: finished.filter((r) => r.error).map((r) => r.error?.code ?? 'error'),
      used: await usedOf(two.target.id),
      outcomes,
    };

    const pass = report('create_offer', first) && report('net_finish_send', second);
    console.log(pass ? `PASSED · ${N} concurrent asks · 1 free slot · 1 offer (both races)` : 'FAILED · expected exactly 1 offer and 2 of 2 used in each race');
    return pass ? 0 : 1;
  } finally {
    if (allAsks.length) await db.from('audit').delete().in('ask_id', allAsks);
    for (const id of users) await db.auth.admin.deleteUser(id).catch(() => undefined);
    line('cleanup', `${users.length} throwaway users deleted (their rows cascade), audit facts of ${allAsks.length} race asks removed`);
  }
}

/* ========================================================================== *
 * Logical: PGlite (one connection)
 * ========================================================================== */

async function logical(): Promise<boolean> {
  const { createTestDb } = await import('../tests/db/harness');
  const db = await createTestDb();
  try {
    const setup = async (phase: 1 | 2) => {
      const target = await db.createMember(`race-p${phase}-member@example.invalid`, { rules: RULES, cap: 2 });
      await db.pg.query(`insert into public.cap_usage (member_id, month, used) values ($1, public.cap_month(now()), 1)`, [target]);
      const asks: string[] = [];
      for (let i = 0; i < N; i++) {
        const asker = await db.createMember(`race-p${phase}-asker${i}@example.invalid`, { status: 'pending' });
        const id = askId(phase, i, 'pg');
        await db.pg.query(`insert into public.asks (id, asker_id, raw, compiled, subject, status, network_size) values ($1, $2, 'r', $3::jsonb, 'Race test, 20 min?', 'gating', 1)`, [id, asker, JSON.stringify(compiled)]);
        await db.pg.query(`insert into public.ask_members (ask_id, member_id, position) values ($1, $2, 0)`, [id, target]);
        if (phase === 2) {
          await db.pg.query(
            `insert into public.gate_decisions (ask_id, member_id, attempt, rules_version, verdict, model_verdict, cited, decided_by, clause_verified, reason_code, reason, source)
             values ($1, $2, 1, 1, 'accept', 'accept', $3::jsonb, 'gate', true, 'match', 'Race test accept.', 'live')`,
            [id, target, JSON.stringify(cited)],
          );
        }
        asks.push(id);
      }
      // Interleave: alternate asks so the order isn't the creation order.
      return { target, order: [...asks.filter((_, i) => i % 2), ...asks.filter((_, i) => i % 2 === 0)] };
    };
    const usedOf = async (member: string) => (await db.pg.query<{ used: number }>(`select used from public.cap_usage where member_id = $1 and month = public.cap_month(now())`, [member])).rows[0]?.used ?? -1;

    const one = await setup(1);
    let started = Date.now();
    const rows = await Promise.all(
      one.order.map((id) => db.asService((tx) => tx.query(`select * from public.create_offer($1, $2, $3, $4, 1::smallint, now())`, [offerId(), id, one.target, hex64()])).then((r) => r.rows.length)),
    );
    const first: PhaseResult = { ms: Date.now() - started, made: rows.reduce((a, b) => a + b, 0), used: await usedOf(one.target), errors: [] };

    const two = await setup(2);
    started = Date.now();
    const results = await Promise.all(
      two.order.map((id) =>
        db
          .asService((tx) => tx.query<{ r: { outcome?: string } }>(`select public.net_finish_send($1, now(), $2::jsonb) as r`, [id, JSON.stringify([{ offer_id: offerId(), token_hash: hex64() }])]))
          .then((r) => String(r.rows[0]?.r?.outcome ?? 'none')),
      ),
    );
    const outcomes: Record<string, number> = {};
    for (const o of results) outcomes[o] = (outcomes[o] ?? 0) + 1;
    const made = (await db.pg.query<{ n: number }>(`select count(*)::int as n from public.offers where member_id = $1`, [two.target])).rows[0]?.n ?? -1;
    const second: PhaseResult = { ms: Date.now() - started, made, used: await usedOf(two.target), errors: [], outcomes };

    console.log('logical check (PGlite, 1 connection: the transactions interleave, they never overlap)');
    return report('create_offer', first) && report('net_finish_send', second);
  } finally {
    await db.close();
  }
}

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return concurrent(url, key);
  console.log(`ok-to-intro · race test · ${N} asks · 1 free slot`);
  const ok = await logical();
  console.log(ok ? 'logical rule holds (this proves the rule, not concurrency)' : 'FAILED · the logical check made more than 1 offer');
  if (!ok) return 1;
  console.log('SKIPPED (no Supabase project configured): set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for a dev project to race 20 real requests.');
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error('race test error:', err instanceof Error ? err.message : 'unknown');
    process.exit(1);
  },
);
