import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';
import { flags } from '@/lib/env';
import { getAdminClient, isDbDown } from '@/lib/supabase/admin';
import type { AuditAction } from '@/lib/supabase/database.types';

/**
 * Owner: BE2. Three things every network module needs, kept in this one leaf module so nothing imports in a circle:
 *
 * 1. `recordAudit`: append-only facts for the public board (public.audit). Every owner records its own events here:
 *    BE1 `playground_run` ({gates}); BE2 asks, gates, offers, intros, check-ins (most of them inside the SQL
 *    functions of supabase/migrations/0002_network.sql, in the same transaction as the change they describe);
 *    S3 member_joined / member_gate_on / member_paused / member_resumed / member_deleted / rules_saved /
 *    token_created / token_revoked. `detail` holds facts only (verdicts, counts, latencies, ratings, a coarse topic):
 *    never rules text, ask text, names or emails.
 *
 * 2. `rpc`: the network's one door to the database. Every read and write of the REAL network is a SQL function in
 *    0002_network.sql called through the service role, so each state change is one transaction and the tests can run
 *    the same functions on PGlite (`__setNetworkDbForTests`). Never logs arguments (they carry rules, asks, answers).
 *
 * 3. `background`: work a request causes but must not wait for (the next member's offer email after a No, a queued
 *    ask's fan-out after another closes, scheduling check-in emails). Inside a request it runs after the response
 *    (next/server `after`, which keeps the function alive); in the daily cron (`runInline`) and outside a request
 *    (scripts, tests) it runs before returning. Each of these is also a backstop job of the daily cron, so work cut
 *    short by the platform is picked up within a day.
 */

/* ========================================================================== *
 * Work after the response
 * ========================================================================== */

const inlineScope = new AsyncLocalStorage<true>();

/** Runs `fn` with every `background` job awaited in place (the daily cron reports what it actually did). */
export function runInline<T>(fn: () => Promise<T>): Promise<T> {
  return inlineScope.run(true, fn);
}

/**
 * Runs `work` after the response when called inside a request, or right away (awaited) otherwise. Never throws;
 * a failure is logged by its label only.
 */
export async function background(label: string, work: () => Promise<unknown>): Promise<void> {
  const run = async () => {
    try {
      await work();
    } catch (err) {
      console.error(`[network] ${label} failed:`, err instanceof Error ? err.name : 'error');
    }
  };
  if (!inlineScope.getStore()) {
    try {
      after(run);
      return;
    } catch {
      // Outside a request scope (scripts, tests, the build): run it now.
    }
  }
  await run();
}

export type AuditDetail = Record<string, string | number | boolean | null>;

export interface AuditInput {
  actor_id?: string | null;
  member_id?: string | null;
  asker_id?: string | null;
  ask_id?: string | null;
  offer_id?: string | null;
  detail?: AuditDetail;
}

/* ========================================================================== *
 * The database door
 * ========================================================================== */

/** What a transport returns: supabase-js `rpc` or the PGlite adapter in tests. */
export interface RpcTransportResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}
export type RpcTransport = (fn: string, args: Record<string, unknown>) => Promise<RpcTransportResult>;

export type RpcResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** not_configured: no service-role client on this instance · db_down: unreachable · error: the query failed. */
      reason: 'not_configured' | 'db_down' | 'error';
      code?: string;
      message: string;
    };

let testTransport: RpcTransport | null = null;

/** Tests run the same SQL functions on PGlite. Pass null to restore the real client. */
export function __setNetworkDbForTests(transport: RpcTransport | null): void {
  testTransport = transport;
}

function transport(): RpcTransport | null {
  if (testTransport) return testTransport;
  const admin = getAdminClient();
  if (!admin.ok) return null;
  // The 0002 functions are not in the hand-written Database type yet (docs/requests/be2-network.md), so the call is
  // untyped here and each caller checks the shape it gets back.
  const call = admin.client.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<RpcTransportResult>;
  return (fn, args) => Promise.resolve(call.call(admin.client, fn, args));
}

/**
 * True when this instance can run the REAL network: Supabase (sign-in and the service role), the token secret that
 * offer and check-in links need (`flags.realNetwork`), and email (Resend and a From address). Members hear about an
 * offer by email and the intro is an email to both people, so a network that can't email isn't set up: every REAL
 * surface then shows its “not set up on this instance” state instead of telling someone an email went out.
 * (Tests that install a PGlite transport count as configured; they install their own email transport.)
 */
export function networkConfigured(): boolean {
  if (testTransport) return true;
  return flags.realNetwork && flags.hasResend;
}

/** Calls one SQL function. Never throws; never logs the arguments. */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const t = transport();
  if (!t) return { ok: false, reason: 'not_configured', message: 'The real network isn’t set up on this instance.' };
  try {
    const { data, error } = await t(fn, args);
    if (error) {
      const down = isDbDown(error);
      console.error(`[network] ${fn} failed:`, error.code ?? (down ? 'unreachable' : 'error'), (error.message ?? '').slice(0, 200));
      return { ok: false, reason: down ? 'db_down' : 'error', code: error.code, message: error.message ?? 'database error' };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    console.error(`[network] ${fn} threw:`, err instanceof Error ? err.name : 'unknown error');
    return { ok: false, reason: 'db_down', message: err instanceof Error ? err.message : 'database unreachable' };
  }
}

/* ========================================================================== *
 * Audit
 * ========================================================================== */

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined): string | null => (v && ID_PATTERN.test(v) ? v : null);

/** Keeps detail to flat facts: drops nested values and long strings (a board fact is a word or a number). */
function cleanDetail(detail: AuditDetail | undefined): AuditDetail {
  const out: AuditDetail = {};
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= 80) out[k] = v;
  }
  return out;
}

/** Records one fact. Never throws; a failure is logged without the detail. Without a database it records nothing. */
export async function recordAudit(action: AuditAction, input: AuditInput = {}): Promise<void> {
  const res = await rpc<null>('net__audit', {
    p_action: action,
    p_at: new Date().toISOString(),
    p_member: uuidOrNull(input.member_id),
    p_asker: uuidOrNull(input.asker_id),
    p_ask: input.ask_id ?? null,
    p_offer: input.offer_id ?? null,
    p_detail: cleanDetail(input.detail),
    p_actor: uuidOrNull(input.actor_id),
  });
  if (!res.ok && res.reason !== 'not_configured') console.error(`[audit] ${action} not recorded (${res.reason})`);
}
