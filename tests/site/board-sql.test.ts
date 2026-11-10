/**
 * The SQL S7 asks for in docs/requests/s7-site.md: board_snapshot(p_as_of), the board's counts as of a checkpoint.
 * Applied on top of every migration in PGlite (tests/db/harness.ts), then checked against what lib/server/board.ts
 * and components/board/model.ts expect.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseBoardSnapshot } from '@/components/board/model';
import { createTestDb, type TestDb } from '../db/harness';

const FIXTURE = fileURLToPath(new URL('../../supabase/migrations/0003_board_as_of.sql', import.meta.url));
const RULES = 'Happy to talk to founders about Postgres, queues or LLM evals in production.';

let db: TestDb;
let a: string;
let b: string;
let c: string;

// Pacific time is UTC−8 in January: the 09:00 checkpoint on Jan 10 is 17:00Z. All in the past, so “as of now” sees them too.
const BEFORE = '2026-01-10T16:00:00Z';
const CHECKPOINT = '2026-01-10T17:00:00Z';
const AFTER = '2026-01-10T18:30:00Z';

beforeAll(async () => {
  db = await createTestDb();
  await db.pg.exec(readFileSync(FIXTURE, 'utf8'));
  a = await db.createMember('as-of-a@example.com', { rules: RULES });
  b = await db.createMember('as-of-b@example.com', { rules: RULES });
  c = await db.createMember('as-of-c@example.com', { rules: RULES });
  // They joined the day before (members created after the checkpoint don't count in it).
  await db.pg.query(`update public.members set created_at = '2026-01-09T14:00:00Z'`);
  await db.pg.query(
    `insert into public.audit (at, action, member_id, asker_id, ask_id, offer_id, detail) values
      ($4, 'member_joined', $1, null, null, null, '{}'),
      ($4, 'ask_sent', null, $2, 'a_asof1', null, '{"topic":"Hospital procurement, US"}'),
      ($4, 'ask_sent', null, $3, 'a_asof2', null, '{"topic":"Hospital procurement, US"}'),
      ($4, 'ask_sent', null, $1, 'a_asof3', null, '{"topic":"Hospital procurement, US"}'),
      ($4, 'gate_checked', $1, $2, 'a_asof1', null, '{"verdict":"accept","decided_by":"gate","attempt":1}'),
      ($4, 'gate_checked', $3, $2, 'a_asof1', null, '{"verdict":"decline","decided_by":"clause_check","attempt":1}'),
      ($4, 'offer_delivered', $1, $2, 'a_asof1', 'o_asof1', '{}'),
      ($5, 'offer_passed', $1, $2, 'a_asof1', 'o_asof1', '{}'),
      ($5, 'offer_delivered', $3, $2, 'a_asof1', 'o_asof2', '{}'),
      ($5, 'playground_run', null, null, null, null, '{"gates":12}')`,
    [a, b, c, BEFORE, AFTER],
  );
});

afterAll(async () => {
  await db.close();
});

const snapshot = async (asOf?: string) => {
  const sql = asOf ? `select public.board_snapshot($1::timestamptz) as s` : `select public.board_snapshot() as s`;
  const r = await db.asService((tx) => tx.query<{ s: Record<string, unknown> }>(sql, asOf ? [asOf] : []));
  return r.rows[0]?.s as Record<string, unknown>;
};

describe('board_snapshot(p_as_of)', () => {
  it('counts only the facts up to the checkpoint: a pass after it stays invisible until the next one', async () => {
    const atCheckpoint = await snapshot(CHECKPOINT);
    expect(atCheckpoint.interrupted).toBe(1);
    expect(atCheckpoint.offers_passed).toBe(0);
    expect(atCheckpoint.playground_runs).toBe(0);
    expect(new Date(String(atCheckpoint.as_of)).toISOString()).toBe(new Date(CHECKPOINT).toISOString());

    const now = await snapshot();
    expect(now.interrupted).toBe(2);
    expect(now.offers_passed).toBe(1);
    expect(now.playground_gate_calls).toBe(12);
  });

  it('keeps every number the board reads, in the shape parseBoardSnapshot accepts', async () => {
    const s = await snapshot(CHECKPOINT);
    const parsed = parseBoardSnapshot(s);
    expect(parsed).not.toBeNull();
    expect(parsed?.asks_sent).toBe(3);
    expect(parsed?.gate_checks).toBe(2);
    expect(parsed?.quotes_not_found).toBe(1);
    expect(parsed?.members_with_rules).toBe(3);
    // Three different founders asked about the topic, so it is listed.
    expect(parsed?.demand).toEqual([{ topic: 'Hospital procurement, US', asks: 3, reached: 1, askers: 3 }]);
  });

  it('replaces the zero-argument function (no ambiguous overload) and stays server-only', async () => {
    const fns = await db.pg.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'board_snapshot'`,
    );
    expect(fns.rows.map((r) => r.args)).toEqual(['p_as_of timestamp with time zone']);
    await expect(db.asUser(a, (tx) => tx.query(`select public.board_snapshot(now())`))).rejects.toThrow(/permission denied/);
    await expect(db.asAnon((tx) => tx.query(`select public.board_snapshot()`))).rejects.toThrow(/permission denied/);
  });

  it('counts survive a member deleting their data', async () => {
    const before = await snapshot(CHECKPOINT);
    await db.pg.query(`delete from auth.users where id = $1`, [c]);
    const after = await snapshot(CHECKPOINT);
    expect(after.interrupted).toBe(before.interrupted);
    expect(after.gate_checks).toBe(before.gate_checks);
  });
});
