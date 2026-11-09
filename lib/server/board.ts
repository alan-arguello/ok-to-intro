import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseBoardSnapshot, type BoardSnapshot } from '@/components/board/model';
import evalFile from '@/data/eval/heldout-summary.json';
import { flags } from '@/lib/env';
import { fmtDay, lastCheckpoint, NETWORK_TZ } from '@/lib/oti/time';
import { getAdminClient } from '@/lib/supabase/admin';
import type { EvalSummary, RealLineResult } from '@/lib/types';

/**
 * Owner: S7. Real counts for /board (`public.board_snapshot()`) and the playground's REAL line (`public.real_line()`),
 * read with the service role. Both functions count facts in the append-only `audit` table, so a member deleting
 * their data never rewrites the board.
 *
 * Nothing here throws: every failure is a typed result. The /board page decides what a failure means (at build:
 * render the designed state; at runtime revalidation: throw, so ISR keeps serving the last good page).
 *
 * Board timing and privacy: an asker who is the only one with an open ask could watch “people interrupted” move
 * the minute a member passes, which the asker serializer hides until the next 09:00 / 21:00 checkpoint. So the board
 * asks for the counts as of the last checkpoint (`board_snapshot(p_as_of)`, docs/requests/s7-site.md item 1). Until
 * that signature is deployed, PostgREST answers PGRST202 and the board reads the current counts instead (`asOfKind:
 * 'read'`), labelled with the time they were read.
 */

const TIMEOUT_MS = 4000;

export type BoardResult =
  | { ok: true; snapshot: BoardSnapshot; asOfKind: 'checkpoint' | 'read' }
  | { ok: false; reason: 'not_configured' | 'db_down' };

/**
 * When this instance last saw a database without the `p_as_of` signature, so a read makes one call, not two. Retried
 * after 10 minutes, so a warm instance picks the new function up soon after the migration ships.
 */
let asOfMissingAt: number | null = null;
const AS_OF_RETRY_MS = 10 * 60_000;

function logFailure(what: string, error: unknown): void {
  // Codes only: never request bodies, rules, asks or keys.
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  console.error(`[board] ${what} failed${code ? ` (${code})` : ''}`);
}

/**
 * The counts behind /board. `now` picks the checkpoint (tests pass a fixed date). Never throws.
 * - `not_configured`: no service-role key on this instance (the board says the real network isn't connected).
 * - `db_down`: configured, but the database didn't answer or answered something that isn't a snapshot.
 */
export async function getBoard(now: Date = new Date()): Promise<BoardResult> {
  if (!flags.hasSupabaseAdmin) return { ok: false, reason: 'not_configured' };
  const admin = getAdminClient();
  if (!admin.ok) return { ok: false, reason: 'not_configured' };
  const db = admin.client;
  try {
    if (asOfMissingAt === null || Date.now() - asOfMissingAt > AS_OF_RETRY_MS) {
      const asOf = lastCheckpoint(now).toISOString();
      // The generated Database type still describes the zero-argument function, so this one call is untyped.
      const { data, error } = await (db as unknown as SupabaseClient)
        .rpc('board_snapshot', { p_as_of: asOf })
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
      if (!error) {
        asOfMissingAt = null;
        const snapshot = parseBoardSnapshot(data);
        if (snapshot) return { ok: true, snapshot, asOfKind: 'checkpoint' };
        logFailure('board_snapshot(p_as_of) parse', null);
        return { ok: false, reason: 'db_down' };
      }
      if (error.code !== 'PGRST202') {
        logFailure('board_snapshot(p_as_of)', error);
        return { ok: false, reason: 'db_down' };
      }
      asOfMissingAt = Date.now();
    }
    const { data, error } = await db.rpc('board_snapshot').abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) {
      logFailure('board_snapshot', error);
      return { ok: false, reason: 'db_down' };
    }
    const snapshot = parseBoardSnapshot(data);
    if (!snapshot) {
      logFailure('board_snapshot parse', null);
      return { ok: false, reason: 'db_down' };
    }
    return { ok: true, snapshot, asOfKind: 'read' };
  } catch (error) {
    logFailure('board_snapshot', error);
    return { ok: false, reason: 'db_down' };
  }
}

/** For tests: forget whether the database has the `p_as_of` signature. */
export function __resetBoardForTests(): void {
  asOfMissingAt = null;
}

function count(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * The dated REAL line under the S1 lede (public.real_line()). Never throws, also at build time (S1 is prerendered):
 * `not_configured` when the real network isn't connected on this instance (S1 shows REAL_LINE_OFF);
 * `db_down` when it is configured but can't be read (S1 renders no REAL line rather than a wrong one).
 * `since` is the first member's join date in Mexico City (“Nov 9”), or null before anyone joined.
 */
export async function getRealLine(): Promise<RealLineResult> {
  if (!flags.hasSupabaseAdmin) return { ok: false, reason: 'not_configured' };
  const admin = getAdminClient();
  if (!admin.ok) return { ok: false, reason: 'not_configured' };
  try {
    const { data, error } = await admin.client.rpc('real_line').abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      if (error) logFailure('real_line', error);
      return { ok: false, reason: 'db_down' };
    }
    const o = data as Record<string, unknown>;
    const members = count(o.members);
    const asks = count(o.asks);
    const intros = count(o.intros);
    const sinceMs = typeof o.since === 'string' ? Date.parse(o.since) : NaN;
    const asOfMs = typeof o.as_of === 'string' ? Date.parse(o.as_of) : NaN;
    if (members === null || asks === null || intros === null || Number.isNaN(asOfMs)) return { ok: false, reason: 'db_down' };
    return {
      ok: true,
      line: {
        since: Number.isNaN(sinceMs) ? null : fmtDay(sinceMs, NETWORK_TZ),
        members,
        asks,
        intros,
        as_of: new Date(asOfMs).toISOString(),
      },
    };
  } catch (error) {
    logFailure('real_line', error);
    return { ok: false, reason: 'db_down' };
  }
}

const EVAL_TYPES = new Set(['fits', 'wrong_stage', 'investor', 'injection', 'polite_spam', 'other']);
const VERDICTS = new Set(['accept', 'decline', 'ask_back']);
const NO_EVAL: EvalSummary = {
  source: 'none',
  ran_at: null,
  model: null,
  rubric_hash: null,
  header: null,
  rows: [],
  totals: null,
  wrongly_let_through: null,
  wrongly_blocked: null,
  misses: [],
};

const isCounts = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0);

/**
 * data/eval/heldout-summary.json, checked. Anything but a well-formed `source: "eval"` file reads as “No eval run
 * yet”: the board never shows eval numbers that `npm run eval` didn't write.
 */
export function parseEvalSummary(raw: unknown): EvalSummary {
  if (!raw || typeof raw !== 'object') return NO_EVAL;
  const s = raw as EvalSummary;
  if (s.source !== 'eval' || !Array.isArray(s.rows) || !s.rows.length || !Array.isArray(s.misses)) return NO_EVAL;
  const runs = s.rows[0]?.runs.length ?? 0;
  if (!runs) return NO_EVAL;
  const rowsOk = s.rows.every(
    (r) => EVAL_TYPES.has(r.case_type) && typeof r.label === 'string' && Number.isInteger(r.n) && isCounts(r.runs) && r.runs.length === runs && Number.isInteger(r.baseline),
  );
  const pair = (p: EvalSummary['wrongly_let_through']) => p === null || (isCounts(p.runs) && p.runs.length === runs && Number.isInteger(p.baseline));
  const totalsOk = s.totals === null || (Number.isInteger(s.totals.n) && isCounts(s.totals.runs) && s.totals.runs.length === runs && Number.isInteger(s.totals.baseline));
  const missesOk = s.misses.every(
    (m) =>
      EVAL_TYPES.has(m.case_type) &&
      typeof m.ask === 'string' &&
      typeof m.rules_excerpt === 'string' &&
      VERDICTS.has(m.expected) &&
      Array.isArray(m.actual) &&
      m.actual.every((a) => VERDICTS.has(a) || a === 'not_checked') &&
      Array.isArray(m.cited) &&
      m.cited.every((c) => typeof c === 'string'),
  );
  if (!rowsOk || !totalsOk || !pair(s.wrongly_let_through) || !pair(s.wrongly_blocked) || !missesOk) return NO_EVAL;
  return s;
}

/** The held-out eval the board shows (bundled at build: a new `npm run eval` ships with the next deploy). */
export function getEvalSummary(): EvalSummary {
  return parseEvalSummary(evalFile as unknown);
}
