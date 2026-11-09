/**
 * lib/server/board.ts: getBoard, getRealLine and the eval file, with the admin client replaced by a stand-in.
 * The last block runs the whole path (SQL → getBoard → boardView) on PGlite with every migration plus the
 * board_snapshot(p_as_of) S7 requests (tests/site/fixtures/board-as-of.sql).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/harness';

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

const h = vi.hoisted(() => ({
  flags: { hasSupabaseAdmin: true },
  calls: [] as { name: string; args: unknown }[],
  respond: (_name: string, _args: unknown): Promise<RpcResult> | RpcResult => ({ data: null, error: null }),
}));

vi.mock('@/lib/env', () => ({ flags: h.flags }));
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () =>
    h.flags.hasSupabaseAdmin
      ? {
          ok: true,
          client: {
            rpc: (name: string, args?: unknown) => {
              h.calls.push({ name, args });
              const result = Promise.resolve().then(() => h.respond(name, args));
              return { abortSignal: () => result };
            },
          },
        }
      : { ok: false, reason: 'not_configured', missing: ['SUPABASE_SERVICE_ROLE_KEY'] },
}));

import { boardView } from '@/components/board/model';
import { EXAMPLE_SNAPSHOT } from '@/components/board/qa-examples';
import { __resetBoardForTests, getBoard, getEvalSummary, getRealLine, parseEvalSummary } from '@/lib/server/board';
import heldout from '@/data/eval/heldout-summary.json';

const NOW = new Date('2026-11-10T20:02:00Z'); // 14:02 in Mexico City: the last checkpoint is 09:00 (15:00Z)
const CHECKPOINT = '2026-11-10T15:00:00.000Z';
const NOT_FOUND = { code: 'PGRST202', message: 'Could not find the function public.board_snapshot(p_as_of) in the schema cache' };

beforeEach(() => {
  __resetBoardForTests();
  h.flags.hasSupabaseAdmin = true;
  h.calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('getBoard', () => {
  it('is not configured without the service role, and makes no call', async () => {
    h.flags.hasSupabaseAdmin = false;
    expect(await getBoard(NOW)).toEqual({ ok: false, reason: 'not_configured' });
    expect(h.calls).toEqual([]);
  });

  it('asks for the counts as of the last checkpoint', async () => {
    h.respond = () => ({ data: { ...EXAMPLE_SNAPSHOT, as_of: CHECKPOINT }, error: null });
    const r = await getBoard(NOW);
    expect(h.calls).toEqual([{ name: 'board_snapshot', args: { p_as_of: CHECKPOINT } }]);
    expect(r).toMatchObject({ ok: true, asOfKind: 'checkpoint' });
    if (r.ok) expect(boardView({ snapshot: r.snapshot, asOfKind: r.asOfKind, evalSummary: getEvalSummary() }).lede).toContain('Last update Nov 10, 09:00 CST.');
  });

  it('falls back to the current counts while the database has no p_as_of yet, and remembers it', async () => {
    h.respond = (_name, args) => (args ? { data: null, error: NOT_FOUND } : { data: EXAMPLE_SNAPSHOT, error: null });
    expect(await getBoard(NOW)).toMatchObject({ ok: true, asOfKind: 'read' });
    expect(h.calls.map((c) => c.args ?? null)).toEqual([{ p_as_of: CHECKPOINT }, null]);
    h.calls = [];
    expect(await getBoard(NOW)).toMatchObject({ ok: true, asOfKind: 'read' });
    expect(h.calls.length).toBe(1);
  });

  it('tries p_as_of again after 10 minutes, so a warm instance picks up the migration', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-10T20:00:00Z'));
      h.respond = (_name, args) => (args ? { data: null, error: NOT_FOUND } : { data: EXAMPLE_SNAPSHOT, error: null });
      await getBoard(NOW);
      h.calls = [];
      vi.setSystemTime(new Date('2026-11-10T20:11:00Z'));
      h.respond = () => ({ data: { ...EXAMPLE_SNAPSHOT, as_of: CHECKPOINT }, error: null });
      expect(await getBoard(NOW)).toMatchObject({ ok: true, asOfKind: 'checkpoint' });
      expect(h.calls).toEqual([{ name: 'board_snapshot', args: { p_as_of: CHECKPOINT } }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports db_down for an error, a timeout, a throw or a snapshot that does not parse', async () => {
    h.respond = () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    expect(await getBoard(NOW)).toEqual({ ok: false, reason: 'db_down' });
    h.respond = () => ({ data: { as_of: CHECKPOINT }, error: null });
    expect(await getBoard(NOW)).toEqual({ ok: false, reason: 'db_down' });
    h.respond = () => {
      throw new Error('fetch failed');
    };
    expect(await getBoard(NOW)).toEqual({ ok: false, reason: 'db_down' });
  });

  it('never logs anything but a code', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.respond = () => ({ data: null, error: { code: 'XX000', message: 'secret details with rules text' } });
    await getBoard(NOW);
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret');
  });
});

describe('getRealLine', () => {
  it('is not configured without the service role', async () => {
    h.flags.hasSupabaseAdmin = false;
    expect(await getRealLine()).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('dates the line by the first join in Mexico City, or says nobody joined yet', async () => {
    h.respond = () => ({ data: { since: '2026-11-09T22:15:00+00:00', members: 23, asks: '12', intros: 7, as_of: '2026-11-10T20:02:00+00:00' }, error: null });
    expect(await getRealLine()).toEqual({ ok: true, line: { since: 'Nov 9', members: 23, asks: 12, intros: 7, as_of: '2026-11-10T20:02:00.000Z' } });
    h.respond = () => ({ data: { since: null, members: 0, asks: 0, intros: 0, as_of: '2026-11-09T15:00:00Z' }, error: null });
    expect(await getRealLine()).toMatchObject({ ok: true, line: { since: null, members: 0 } });
  });

  it('is db_down when the database errors or answers nonsense, so the playground shows no line', async () => {
    h.respond = () => ({ data: null, error: { message: 'fetch failed' } });
    expect(await getRealLine()).toEqual({ ok: false, reason: 'db_down' });
    h.respond = () => ({ data: { members: 'lots' }, error: null });
    expect(await getRealLine()).toEqual({ ok: false, reason: 'db_down' });
  });
});

describe('the eval file', () => {
  it('reads the committed placeholder as “no eval run yet”', () => {
    expect(heldout.source).toBe('none');
    expect(getEvalSummary().source).toBe('none');
  });

  it('accepts a well-formed eval and refuses anything else', () => {
    const good = {
      source: 'eval',
      ran_at: '2026-11-09T22:00:00Z',
      model: 'claude-haiku-5-5',
      rubric_hash: 'abc',
      header: '20 cases',
      rows: [{ case_type: 'injection', label: 'Prompt injection', n: 3, runs: [3, 3, 3], baseline: 2 }],
      totals: { n: 3, runs: [3, 3, 3], baseline: 2 },
      wrongly_let_through: { runs: [0, 0, 0], baseline: 1 },
      wrongly_blocked: { runs: [0, 0, 0], baseline: 0 },
      misses: [],
    };
    expect(parseEvalSummary(good).source).toBe('eval');
    expect(parseEvalSummary({ ...good, rows: [{ ...good.rows[0], runs: [3, 3] }] }).source).toBe('none');
    expect(parseEvalSummary({ ...good, misses: [{ case_type: 'injection', ask: 'x', rules_excerpt: 'y', expected: 'maybe', actual: [], cited: [] }] }).source).toBe('none');
    expect(parseEvalSummary({ ...good, source: 'authored' }).source).toBe('none');
    expect(parseEvalSummary(null).source).toBe('none');
  });
});

describe('end to end on PGlite: SQL → getBoard → boardView', () => {
  let db: TestDb | null = null;
  afterAll(async () => {
    await db?.close();
  });

  it('renders the counts board_snapshot(p_as_of) returns, as of the checkpoint', async () => {
    db = await createTestDb();
    await db.pg.exec(readFileSync(fileURLToPath(new URL('../../supabase/migrations/0003_board_as_of.sql', import.meta.url)), 'utf8'));
    const m = await db.createMember('e2e@example.com', { rules: 'No fundraising asks.' });
    await db.pg.query(`update public.members set created_at = '2026-11-09T12:00:00Z'`);
    await db.pg.query(
      `insert into public.audit (at, action, member_id, asker_id, ask_id, offer_id, detail) values
        ('2026-11-09T16:00:00Z', 'member_joined', $1, null, null, null, '{}'),
        ('2026-11-10T14:00:00Z', 'ask_sent', null, $1, 'a_e2e1', null, '{}'),
        ('2026-11-10T14:00:01Z', 'gate_checked', $1, $1, 'a_e2e1', null, '{"verdict":"decline","decided_by":"gate","attempt":1}'),
        ('2026-11-10T16:00:00Z', 'ask_sent', null, $1, 'a_e2e2', null, '{}')`,
      [m],
    );
    const pg = db.pg;
    h.respond = async (name, args) => {
      const a = args as { p_as_of?: string } | undefined;
      const r = await pg.query<{ s: unknown }>(a?.p_as_of ? `select public.${name}($1::timestamptz) as s` : `select public.${name}() as s`, a?.p_as_of ? [a.p_as_of] : []);
      return { data: r.rows[0]?.s ?? null, error: null };
    };
    const r = await getBoard(NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.asOfKind).toBe('checkpoint');
    // The second ask was sent after the 09:00 checkpoint: it shows at 21:00, not now.
    expect(r.snapshot.asks_sent).toBe(1);
    const v = boardView({ snapshot: r.snapshot, asOfKind: r.asOfKind, evalSummary: getEvalSummary() });
    expect(v.lede).toBe('Real counts since Nov 9, 2026. Every number has its denominator. Last update Nov 10, 09:00 CST.');
    expect(v.funnel.find((x) => x.label === 'Gate checks')).toMatchObject({ value: '1', note: 'at most 1 ask × 1 member, plus 0 reruns' });
  });
});
