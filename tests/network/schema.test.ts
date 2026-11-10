import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rng } from '@/lib/oti/text';
import { ceilCheckpoint } from '@/lib/server/checkpoints';
import { createTestDb, type TestDb } from '../db/harness';

/** 0002_network.sql: server-only functions, and SQL that agrees with the TypeScript it mirrors. */

let db: TestDb;
let priya: string;

beforeAll(async () => {
  db = await createTestDb();
  priya = await db.createMember('priya@example.com', { rules: 'Happy to talk about hospitals.' });
});
afterAll(async () => db?.close());

describe('0002 privileges', () => {
  it('no network function is callable by anon or a signed-in member: askers and members go through server code', async () => {
    const fns = await db.pg.query<{ sig: string }>(
      `select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'net\\_%'`,
    );
    expect(fns.rows.length).toBeGreaterThan(30);
    for (const { sig } of fns.rows) {
      for (const role of ['anon', 'authenticated']) {
        const r = await db.pg.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, sig]);
        expect({ sig, role, ok: r.rows[0]?.ok }).toEqual({ sig, role, ok: false });
      }
      const s = await db.pg.query<{ ok: boolean }>(`select has_function_privilege('service_role', $1, 'execute') as ok`, [sig]);
      expect({ sig, ok: s.rows[0]?.ok }).toEqual({ sig, ok: true });
    }
    await expect(db.asUser(priya, (tx) => tx.query(`select public.net_ask_snapshot('a_xxxxxx', $1)`, [priya]))).rejects.toThrow(/permission denied/);
    await expect(db.asAnon((tx) => tx.query(`select public.net_pending_for_member($1, now())`, [priya]))).rejects.toThrow(/permission denied/);
  });
});

describe('net__ceil_checkpoint', () => {
  it('matches lib/server/checkpoints ceilCheckpoint on 500 instants, exact checkpoints included', async () => {
    const r = rng(42);
    const instants: number[] = [Date.parse('2026-11-10T09:00:00-08:00'), Date.parse('2026-11-10T21:00:00-08:00'), Date.parse('2026-12-31T23:59:59-08:00')];
    for (let i = 0; i < 497; i++) instants.push(Date.parse('2026-01-01T02:00:00Z') + Math.floor(r() * 400 * 24 * 3_600_000));
    for (const ms of instants) {
      const res = await db.pg.query<{ c: Date }>(`select public.net__ceil_checkpoint($1::timestamptz) as c`, [new Date(ms).toISOString()]);
      expect(new Date(res.rows[0]!.c).toISOString()).toBe(ceilCheckpoint(ms).toISOString());
    }
  });
});
