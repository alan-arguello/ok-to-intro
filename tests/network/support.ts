/**
 * Test support for the network (BE2): the same SQL functions the server calls through supabase-js `rpc`, run on
 * PGlite with every migration applied (tests/db/harness.ts), as the service role.
 *
 * PGlite is one connection: these tests prove the logic, the constraints and the transactions' outcomes, not
 * concurrency. Real concurrency is `npm run race` against a Supabase project (scripts/race-test.ts).
 */

import { checkQuotes } from '@/lib/oti/clause';
import type { CompiledAsk, GateDecision, GateQuestion, ReasonCode } from '@/lib/types';
import type { GateResult } from '@/lib/server/gate';
import type { RpcTransport } from '@/lib/server/audit';
import type { EmailTransport } from '@/lib/server/email-send';
import { createTestDb, type TestDb } from '../db/harness';

export const TEST_SECRET = 'test-token-hmac-secret-0123456789abcdef';

/** supabase-js `rpc(fn, args)` on PGlite: `select public.fn(p_a => $1, …)` as service_role. */
export function pgliteTransport(db: TestDb, calls?: string[]): RpcTransport {
  return async (fn, args) => {
    if (!/^[a-z_]+$/.test(fn)) return { data: null, error: { code: '42883', message: 'bad function name' } };
    calls?.push(fn);
    const names = Object.keys(args).filter((k) => args[k] !== undefined);
    for (const n of names) if (!/^p_[a-z_]+$/.test(n)) return { data: null, error: { code: '42703', message: 'bad argument name' } };
    const params = names.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const sql = `select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    try {
      const res = await db.asService((tx) => tx.query<{ r: unknown }>(sql, params));
      return { data: res.rows[0]?.r ?? null, error: null };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { data: null, error: { code: e.code, message: e.message ?? 'error' } };
    }
  };
}

export interface NetworkDb {
  db: TestDb;
  transport: RpcTransport;
  calls: string[];
  member(email: string, opts?: { name?: string; company?: string; stage?: string; city?: string; rules?: string; cap?: number; status?: 'pending' | 'on' | 'paused'; show_matched?: boolean; one_line?: string; scheduling_url?: string | null; paused_until?: string | null }): Promise<string>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function createNetworkDb(): Promise<NetworkDb> {
  const db = await createTestDb();
  const calls: string[] = [];
  return {
    db,
    calls,
    transport: pgliteTransport(db, calls),
    async member(email, opts = {}) {
      const id = await db.createMember(email, { rules: opts.rules, cap: opts.cap ?? 2, status: opts.status ?? 'on' });
      await db.pg.query(
        `update public.members set name = $2, company = $3, stage = $4, city = $5, show_matched = $6, one_line = $7, scheduling_url = $8, paused_until = $9 where id = $1`,
        [
          id,
          opts.name ?? '',
          opts.company ?? '',
          opts.stage ?? '',
          opts.city ?? '',
          opts.show_matched ?? false,
          opts.one_line ?? '',
          opts.scheduling_url ?? null,
          opts.status === 'paused' ? (opts.paused_until ?? null) : null,
        ],
      );
      return id;
    },
    async one(sql, params = []) {
      return (await db.pg.query(sql, params)).rows[0] as never;
    },
    async all(sql, params = []) {
      return (await db.pg.query(sql, params)).rows as never;
    },
    close: () => db.close(),
  };
}

/* ---------- gate results (what BE1's runGate returns) ---------- */

function decision(verdict: GateDecision['verdict'], rules: string, quotes: string[], extra: Partial<GateDecision> = {}): GateDecision {
  return {
    verdict,
    model_verdict: verdict,
    cited: checkQuotes(rules, quotes),
    decided_by: 'gate',
    reason_code: (verdict === 'accept' ? 'match' : 'topic') as ReasonCode,
    reason: verdict === 'accept' ? 'The ask fits a line in the rules.' : 'No line in your rules covers this ask.',
    question: null,
    flags: [],
    confidence: 0.8,
    ...extra,
  };
}

export function accepts(rules: string, quote: string, ms = 900): GateResult {
  return { ok: true, decision: decision('accept', rules, [quote]), ms, model: 'claude-haiku-5-5', request_id: 'req_test', cost_usd: 0.0002, usage: null };
}

export function declines(rules: string, reason_code: ReasonCode = 'topic', ms = 700): GateResult {
  return { ok: true, decision: decision('decline', rules, [], { reason_code }), ms, model: 'claude-haiku-5-5', request_id: 'req_test', cost_usd: 0.0002, usage: null };
}

export function asksBack(rules: string, question: GateQuestion, ms = 800): GateResult {
  return { ok: true, decision: decision('ask_back', rules, [], { question, reason_code: 'proof' }), ms, model: 'claude-haiku-5-5', request_id: 'req_test', cost_usd: 0.0002, usage: null };
}

export function fails(kind: 'timeout' | 'rate_limited' | 'overloaded' | 'budget' | 'unavailable' = 'timeout'): GateResult {
  return { ok: false, kind, ms: 6000 };
}

/* ---------- email capture ---------- */

export interface SentEmail {
  key: string;
  to: string[];
  replyTo?: string[];
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  scheduledAt?: string;
}

export function captureEmails(): { transport: EmailTransport; sent: SentEmail[]; cancelled: string[] } {
  const sent: SentEmail[] = [];
  const cancelled: string[] = [];
  const seen = new Map<string, string>();
  let n = 0;
  return {
    sent,
    cancelled,
    transport: {
      async send(payload, options) {
        // Resend's idempotency: the same key returns the first result and sends nothing.
        const prior = seen.get(options.idempotencyKey);
        if (prior) return { id: prior, error: null };
        const id = `em_${++n}`;
        seen.set(options.idempotencyKey, id);
        sent.push({ key: options.idempotencyKey, ...payload });
        return { id, error: null };
      },
      async cancel(id) {
        cancelled.push(id);
        return { ok: true };
      },
    },
  };
}

/* ---------- asks ---------- */

export const HEALTH_RULES = 'Happy to talk to B2B founders selling to public hospitals or insurers in Mexico or Colombia.\nNo asks to review a deck.';
export const PG_RULES = 'Happy to talk about Postgres or Kafka at scale.';

export function compiledAsk(overrides: Partial<CompiledAsk> = {}): CompiledAsk {
  return {
    parts: {
      challenge: 'Public hospital committees stall at technical review',
      tried: '14 buyer calls; 2 committees reached review',
      needs: 'someone who has sat on a public hospital procurement committee in Mexico',
      by: 'Nov 20',
      offers: 'our tender templates',
    },
    subject: 'Hospital procurement in Mexico, 20 min?',
    text: 'Selling inventory software to public hospitals in Jalisco. 14 buyer calls; 2 committees stalled at technical review. Need 20 minutes with someone who has sat on a public hospital procurement committee in Mexico, before Nov 20. Offer: our tender templates.',
    price: null,
    topic: 'Hospital procurement, Mexico',
    ...overrides,
  };
}

/** Collects every event of an async iterable. */
export async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of events) out.push(e);
  return out;
}
