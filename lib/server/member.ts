import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { effectiveStatus, normalizeRules, OTP_TIMING, tallyText, type LedgerCounts } from '@/components/member/copy';
import { CAP_CHOICES } from '@/lib/oti/cap';
import { findClause, norm, ruleLines } from '@/lib/oti/clause';
import { looksLikeToken, newToken } from '@/lib/oti/ids';
import { RULES_MAX } from '@/lib/oti/text';
import { capMonth, DAY_MS, nextMonthStart, NETWORK_TZ, zonedTimeToUtc } from '@/lib/oti/time';
import { hashToken, rateKey } from '@/lib/oti/tokens';
import { recordAudit } from '@/lib/server/audit';
import { cancelMemberEmails } from '@/lib/server/email-send';
import { absoluteUrl, ROUTES } from '@/lib/site';
import { getAdminClient, isDbDown } from '@/lib/supabase/admin';
import type { MemberRow } from '@/lib/supabase/database.types';
import type { MemberProfile, MemberRef, MemberStatus } from '@/lib/types';

/**
 * Owner: S3. Members: profile and settings, rules versions (public.save_rules), cap, pause, pause links,
 * delete and export, plus the email-code sign-in flow behind /join. Rules never reach the database before the
 * email code is verified.
 *
 * Every write runs with the service role (lib/supabase/admin.ts) after the caller established who the member is
 * (a verified session, an API token or a pause token): `authenticated` can't write any table (0001_init.sql).
 * Nothing here throws: failures come back as `{ ok: false, reason }`, and `db_down` covers anything on our side
 * (unreachable, timeout, an unexpected error), which pages render as “Something broke on our side. Nothing was sent
 * to anyone.” Never logs rules, emails or tokens.
 */

export type MemberResult = { ok: true; member: MemberProfile | null } | { ok: false; reason: 'not_configured' | 'db_down' };

export type SaveResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: 'not_configured' | 'db_down' | 'bad_input' | 'not_found' | 'invalid'; message?: string };

export type RulesSource = 'web' | 'playground' | 'offer_edit' | 'mcp';

type Failure = Extract<SaveResult, { ok: false }>;
type DbError = { message?: string; code?: string } | null | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_TIMEOUT_MS = 8_000;
/** Undo on /pause/[token] works for 24 hours after that token paused (pause_tokens.paused_at). */
export const PAUSE_UNDO_MS = 24 * 60 * 60 * 1000;
const RULES_SOURCES: readonly RulesSource[] = ['web', 'playground', 'offer_edit', 'mcp'];

const timeout = () => AbortSignal.timeout(DB_TIMEOUT_MS);

function admin() {
  const res = getAdminClient();
  return res.ok ? res.client : null;
}

const NOT_CONFIGURED: Failure = { ok: false, reason: 'not_configured' };
const DB_DOWN: Failure = { ok: false, reason: 'db_down' };

/** Maps a PostgREST / Postgres error onto SaveResult reasons. */
function dbFail(error: DbError): Failure {
  if (!error || isDbDown(error)) return DB_DOWN;
  switch (error.code) {
    case '22023': // save_rules: rules must be 1 to 1000 characters
    case '23514': // check constraint (lengths, cap range, https link)
    case '22P02': // invalid text representation
    case '22001': // value too long
    case '23502': // not null
      return { ok: false, reason: 'bad_input' };
    case '23503':
      return { ok: false, reason: 'not_found' };
    case '23505':
      return { ok: false, reason: 'invalid' };
    default:
      return DB_DOWN;
  }
}

export function isMemberId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/* ========================================================================== *
 * Validation (shared by the server actions, the MCP set_rules path and tests)
 * ========================================================================== */

export { normalizeRules };

export function rulesProblem(text: string): 'empty' | 'too_long' | null {
  const t = normalizeRules(text);
  if (!t.trim()) return 'empty';
  if (t.length > RULES_MAX) return 'too_long';
  return null;
}

/** Same check as the /me field: https, a dot, no spaces, at most 200 characters (members.scheduling_url). */
export const SCHEDULING_URL_RE = /^https:\/\/[^\s/]+\.[^\s]+$/i;

const text = (max: number) => z.string().trim().max(max);

export const settingsSchema = z.object({
  name: text(80),
  one_line: text(140),
  company: text(80),
  stage: text(40),
  city: text(60),
  scheduling_url: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || SCHEDULING_URL_RE.test(v), 'scheduling_url')
    .transform((v) => (v === '' ? null : v)),
  cap: z.number().int().refine((n) => (CAP_CHOICES as readonly number[]).includes(n), 'cap'),
  show_matched: z.boolean(),
  rules: z.string().max(4000),
});

export type SettingsInput = z.input<typeof settingsSchema>;
export type SettingsField = 'name' | 'one_line' | 'company' | 'stage' | 'city' | 'scheduling_url' | 'cap' | 'show_matched' | 'rules';

export type SettingsResult =
  | { ok: true; version: number; saved_at: string; rules_changed: boolean; status: MemberStatus }
  | { ok: false; reason: Failure['reason']; field?: SettingsField; message?: string };

/* ========================================================================== *
 * Reads
 * ========================================================================== */

function toProfile(row: MemberRow, rules: { version: number; text: string; updated_at: string } | null, nowMs: number): MemberProfile {
  const eff = effectiveStatus(row.status, row.paused_until, nowMs);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    one_line: row.one_line,
    company: row.company,
    stage: row.stage,
    city: row.city,
    scheduling_url: row.scheduling_url,
    cap: row.cap,
    show_matched: row.show_matched,
    accept_guests: row.accept_guests,
    status: eff.status,
    paused_until: eff.paused_until,
    rules: rules?.text ?? '',
    rules_version: rules?.version ?? 0,
    rules_saved_at: rules?.updated_at ?? null,
    created_at: row.created_at,
  };
}

/**
 * The member's profile (incl. the asker profile: company, stage, city), settings and current rules;
 * `member: null` when signed in but no members row exists yet. S3 creates the members row with the email of the
 * VERIFIED session (never an email the browser sends) when the code verifies.
 *
 * `status` is the effective one: a timed pause that has ended reads as `on` (the SQL rule member_is_active), and
 * `rules: ''` / `rules_version: 0` mean no rules saved yet.
 */
export async function getMemberProfile(memberId: string): Promise<MemberResult> {
  const db = admin();
  if (!db) return { ok: false, reason: 'not_configured' };
  if (!isMemberId(memberId)) return { ok: true, member: null };
  try {
    const [m, r] = await Promise.all([
      db.from('members').select('*').eq('id', memberId).abortSignal(timeout()).maybeSingle(),
      db.from('rules').select('version, text, updated_at').eq('member_id', memberId).abortSignal(timeout()).maybeSingle(),
    ]);
    if (m.error || r.error) return { ok: false, reason: 'db_down' };
    if (!m.data) return { ok: true, member: null };
    return { ok: true, member: toProfile(m.data, r.data, Date.now()) };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

async function currentRules(memberId: string): Promise<{ ok: true; rules: { version: number; text: string } | null } | Failure> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  const { data, error } = await db.from('rules').select('version, text').eq('member_id', memberId).abortSignal(timeout()).maybeSingle();
  if (error) return dbFail(error);
  return { ok: true, rules: data };
}

/* ========================================================================== *
 * Rules
 * ========================================================================== */

/**
 * Saves a new rules version (1..1000 characters) and makes it current. Used by /me, MCP set_rules.
 * Saving the text that is already current is a no-op that returns the current version (no duplicate versions).
 */
export async function saveRules(memberId: string, text: string, source: RulesSource): Promise<SaveResult<{ version: number }>> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  if (!RULES_SOURCES.includes(source)) return { ok: false, reason: 'bad_input' };
  const rules = normalizeRules(text);
  const problem = rulesProblem(rules);
  if (problem) return { ok: false, reason: 'bad_input', message: problem === 'empty' ? 'Write at least one rule.' : 'Rules are at most 1,000 characters.' };
  try {
    const cur = await currentRules(memberId);
    if (!cur.ok) return cur;
    if (cur.rules && cur.rules.text === rules) return { ok: true, version: cur.rules.version };
    const { data, error } = await db.rpc('save_rules', { p_member: memberId, p_text: rules, p_source: source }).abortSignal(timeout());
    if (error || typeof data !== 'number') return dbFail(error);
    await recordAudit('rules_saved', { actor_id: memberId, member_id: memberId, detail: { version: data, source } });
    return { ok: true, version: data };
  } catch {
    return DB_DOWN;
  }
}

/** True when `rules` already has a line that reads the same as `line` (quotes, spaces and case normalized). */
export function hasRuleLine(rules: string, line: string): boolean {
  const target = norm(line).replace(/[.\s]+$/, '');
  return ruleLines(rules).some((l) => norm(l.text).replace(/[.\s]+$/, '') === target);
}

/**
 * Appends one templated line to the member's rules as a new version (S4 “Add to my rules”). The line is written
 * by code, additive only; duplicates are a no-op that returns the current version.
 */
export async function appendRuleLine(memberId: string, line: string, source: RulesSource = 'offer_edit'): Promise<SaveResult<{ version: number }>> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  const add = String(line ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!add || add.length > 200) return { ok: false, reason: 'bad_input' };
  try {
    // Optimistic: if another save lands between our read and our write (save_rules serialises per member), rebuild
    // the text on top of that version once, so neither change is lost.
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await currentRules(memberId);
      if (!cur.ok) return cur;
      const base = cur.rules?.text ?? '';
      if (base && hasRuleLine(base, add)) return { ok: true, version: cur.rules?.version ?? 0 };
      const next = base ? `${normalizeRules(base)}\n${add}` : add;
      if (next.length > RULES_MAX) {
        return { ok: false, reason: 'bad_input', message: 'That line would take your rules over 1,000 characters. Edit them under Your gate.' };
      }
      const { data, error } = await db.rpc('save_rules', { p_member: memberId, p_text: next, p_source: source }).abortSignal(timeout());
      if (error || typeof data !== 'number') return dbFail(error);
      const expected = (cur.rules?.version ?? 0) + 1;
      if (data === expected || attempt === 1) {
        await recordAudit('rules_saved', { actor_id: memberId, member_id: memberId, detail: { version: data, source } });
        return { ok: true, version: data };
      }
      // Someone saved version `data - 1` in between: our text was built on an older version. Loop once more.
      const between = await db.from('rule_versions').select('text').eq('member_id', memberId).eq('version', data - 1).abortSignal(timeout()).maybeSingle();
      if (between.error) return dbFail(between.error);
      if (!between.data || between.data.text === base) {
        await recordAudit('rules_saved', { actor_id: memberId, member_id: memberId, detail: { version: data, source } });
        return { ok: true, version: data };
      }
    }
    return DB_DOWN;
  } catch {
    return DB_DOWN;
  }
}

/* ========================================================================== *
 * Cap
 * ========================================================================== */

/** Sets the monthly cap (1..5). Takes effect at the next offer; slots already used this month stay used. */
export async function setCap(memberId: string, cap: number): Promise<SaveResult> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  if (!Number.isInteger(cap) || !(CAP_CHOICES as readonly number[]).includes(cap)) return { ok: false, reason: 'bad_input' };
  try {
    const { data, error } = await db.from('members').update({ cap }).eq('id', memberId).select('id').abortSignal(timeout());
    if (error) return dbFail(error);
    if (!data?.length) return { ok: false, reason: 'not_found' };
    return { ok: true };
  } catch {
    return DB_DOWN;
  }
}

/** This cap month's used slots (offers delivered, whatever the answer). */
export async function getCapUsed(memberId: string, now: Date = new Date()): Promise<{ ok: true; used: number; month: string } | Failure> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  const month = capMonth(now);
  if (!isMemberId(memberId)) return { ok: true, used: 0, month };
  try {
    const { data, error } = await db.from('cap_usage').select('used').eq('member_id', memberId).eq('month', month).abortSignal(timeout()).maybeSingle();
    if (error) return dbFail(error);
    return { ok: true, used: data?.used ?? 0, month };
  } catch {
    return DB_DOWN;
  }
}

/* ========================================================================== *
 * Pause and resume
 * ========================================================================== */

function validUntil(until: string | null, nowMs: number): boolean {
  if (until === null) return true;
  const ms = Date.parse(until);
  return Number.isFinite(ms) && ms > nowMs && ms < nowMs + 400 * DAY_MS;
}

async function memberRow(memberId: string): Promise<{ ok: true; row: MemberRow | null } | Failure> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  const { data, error } = await db.from('members').select('*').eq('id', memberId).abortSignal(timeout()).maybeSingle();
  if (error) return dbFail(error);
  return { ok: true, row: data };
}

/** Pause links can only undo their own pause when nothing changed since: any pause or resume elsewhere clears them. */
async function clearPauseUndo(memberId: string, exceptHash: string | null = null): Promise<void> {
  const db = admin();
  if (!db) return;
  let q = db.from('pause_tokens').update({ paused_at: null, undo_status: null, undo_paused_until: null }).eq('member_id', memberId).not('paused_at', 'is', null);
  if (exceptHash) q = q.neq('token_hash', exceptHash);
  await q.abortSignal(timeout());
}

/**
 * Pauses new offers until `until` (ISO), or until the member turns asks back on (`until: null`).
 * Offers already delivered can still be answered. `stopEmails` (one-click unsubscribe) also cancels this
 * member's scheduled check-in emails through BE2's cancelMemberEmails(memberId, 'checkins') (tech.md: cancel
 * scheduled sends on pause or delete). Deleting a member calls cancelMemberEmails(memberId, 'all') first.
 * A member whose gate isn't on yet (`pending`) has nothing to pause: `invalid`.
 */
export async function pauseMember(memberId: string, until: string | null, options: { stopEmails?: boolean } = {}): Promise<SaveResult<{ paused_until: string | null }>> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  if (!validUntil(until, Date.now())) return { ok: false, reason: 'bad_input' };
  try {
    const cur = await memberRow(memberId);
    if (!cur.ok) return cur;
    if (!cur.row) return { ok: false, reason: 'not_found' };
    if (cur.row.status === 'pending') return { ok: false, reason: 'invalid', message: 'Your gate isn’t on yet.' };
    const { error } = await db.from('members').update({ status: 'paused', paused_until: until }).eq('id', memberId).abortSignal(timeout());
    if (error) return dbFail(error);
    await clearPauseUndo(memberId);
    if (options.stopEmails) await cancelMemberEmails(memberId, 'checkins');
    await recordAudit('member_paused', { actor_id: memberId, member_id: memberId, detail: { via: 'web', indefinite: until === null } });
    return { ok: true, paused_until: until };
  } catch {
    return DB_DOWN;
  }
}

/** Turns asks back on. */
export async function resumeMember(memberId: string): Promise<SaveResult> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  try {
    const cur = await memberRow(memberId);
    if (!cur.ok) return cur;
    if (!cur.row) return { ok: false, reason: 'not_found' };
    if (cur.row.status === 'pending') return { ok: false, reason: 'invalid', message: 'Your gate isn’t on yet.' };
    if (cur.row.status === 'on') return { ok: true };
    const { error } = await db.from('members').update({ status: 'on', paused_until: null }).eq('id', memberId).abortSignal(timeout());
    if (error) return dbFail(error);
    await clearPauseUndo(memberId);
    await recordAudit('member_resumed', { actor_id: memberId, member_id: memberId, detail: { via: 'web' } });
    return { ok: true };
  } catch {
    return DB_DOWN;
  }
}

type PauseTokenLookup = { ok: true; hash: string; token: { member_id: string; paused_at: string | null; undo_status: MemberStatus | null; undo_paused_until: string | null } } | Failure;

async function lookupPauseToken(token: string): Promise<PauseTokenLookup> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!looksLikeToken(token)) return { ok: false, reason: 'invalid' };
  const hash = hashToken('pause', token);
  if (!hash) return NOT_CONFIGURED;
  const { data, error } = await db
    .from('pause_tokens')
    .select('member_id, paused_at, undo_status, undo_paused_until')
    .eq('token_hash', hash)
    .abortSignal(timeout())
    .maybeSingle();
  if (error) return dbFail(error);
  if (!data) return { ok: false, reason: 'invalid' };
  return { ok: true, hash, token: data };
}

/**
 * Pauses the member behind an email pause link (/pause/[token], List-Unsubscribe-Post via /api/pause).
 * `reason: 'invalid'` for an unknown token. No sign-in. Records on the token row when it paused and the member's
 * status / paused_until just before (pause_tokens.paused_at, undo_status, undo_paused_until), for Undo.
 * With `stopEmails` it also calls BE2's cancelMemberEmails(memberId, 'checkins').
 * Idempotent: a repeated POST within the undo window keeps the state from before the FIRST pause, so Undo still
 * restores it (“nothing happens twice”).
 */
export async function pauseByToken(token: string, until: string | null, options: { stopEmails?: boolean } = {}): Promise<SaveResult<{ paused_until: string | null }>> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  const nowMs = Date.now();
  if (!validUntil(until, nowMs)) return { ok: false, reason: 'bad_input' };
  try {
    const found = await lookupPauseToken(token);
    if (!found.ok) return found;
    const memberId = found.token.member_id;
    const cur = await memberRow(memberId);
    if (!cur.ok) return cur;
    if (!cur.row) return { ok: false, reason: 'invalid' };
    if (cur.row.status === 'pending') return { ok: false, reason: 'invalid', message: 'This gate isn’t on yet.' };
    const nowIso = new Date(nowMs).toISOString();
    const eff = effectiveStatus(cur.row.status, cur.row.paused_until, nowMs);
    const recentOwnPause =
      found.token.paused_at !== null && found.token.undo_status !== null && nowMs - Date.parse(found.token.paused_at) < PAUSE_UNDO_MS && eff.status === 'paused';
    const tokenPatch = recentOwnPause
      ? { last_used_at: nowIso }
      : { last_used_at: nowIso, paused_at: nowIso, undo_status: eff.status, undo_paused_until: eff.paused_until };
    const t = await db.from('pause_tokens').update(tokenPatch).eq('token_hash', found.hash).abortSignal(timeout());
    if (t.error) return dbFail(t.error);
    const m = await db.from('members').update({ status: 'paused', paused_until: until }).eq('id', memberId).abortSignal(timeout());
    if (m.error) return dbFail(m.error);
    await clearPauseUndo(memberId, found.hash);
    if (options.stopEmails) await cancelMemberEmails(memberId, 'checkins');
    if (!recentOwnPause) await recordAudit('member_paused', { member_id: memberId, detail: { via: options.stopEmails ? 'unsubscribe' : 'email', indefinite: until === null } });
    return { ok: true, paused_until: until };
  } catch {
    return DB_DOWN;
  }
}

/**
 * Undo on /pause/[token] (“Paused until Dec 1. (Undo)”): restores the status and paused_until saved by this same
 * token's last pause, only within 24 hours of it, and clears them. Anything else is `invalid` (a pause token can't
 * un-pause a member who paused elsewhere). No sign-in. Emails cancelled by that pause stay cancelled.
 */
export async function undoPauseByToken(token: string): Promise<SaveResult<{ status: 'pending' | 'on' | 'paused'; paused_until: string | null }>> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  try {
    const found = await lookupPauseToken(token);
    if (!found.ok) return found;
    const { paused_at, undo_status, undo_paused_until, member_id } = found.token;
    const nowMs = Date.now();
    if (!paused_at || !undo_status || nowMs - Date.parse(paused_at) >= PAUSE_UNDO_MS) return { ok: false, reason: 'invalid' };
    const cur = await memberRow(member_id);
    if (!cur.ok) return cur;
    if (!cur.row || cur.row.status !== 'paused') return { ok: false, reason: 'invalid' };
    const paused_until = undo_status === 'paused' ? undo_paused_until : null;
    const m = await db.from('members').update({ status: undo_status, paused_until }).eq('id', member_id).abortSignal(timeout());
    if (m.error) return dbFail(m.error);
    const t = await db
      .from('pause_tokens')
      .update({ paused_at: null, undo_status: null, undo_paused_until: null, last_used_at: new Date(nowMs).toISOString() })
      .eq('token_hash', found.hash)
      .abortSignal(timeout());
    if (t.error) return dbFail(t.error);
    if (undo_status !== 'paused') await recordAudit('member_resumed', { member_id, detail: { via: 'email_undo' } });
    return { ok: true, status: undo_status, paused_until };
  } catch {
    return DB_DOWN;
  }
}

/**
 * An absolute “Pause all asks” URL for this member's emails (`/pause/<token>`). Each call mints a new 128-bit token
 * (only its HMAC is stored, so a link can't be looked up again; one per email is the intended use) and records it
 * for this member. Null when tokens or the database aren't configured, or the member doesn't exist.
 */
export async function createPauseLink(memberId: string): Promise<string | null> {
  const db = admin();
  if (!db || !isMemberId(memberId)) return null;
  const token = newToken();
  const hash = hashToken('pause', token);
  if (!hash) return null;
  try {
    const { error } = await db.from('pause_tokens').insert({ token_hash: hash, member_id: memberId }).abortSignal(timeout());
    if (error) return null;
    return absoluteUrl(ROUTES.pause(token));
  } catch {
    return null;
  }
}

/** What /pause/[token] shows: whose gate (name, cap), whether it is paused now, and whether this link can Undo. */
export interface PauseLinkView {
  member_name: string;
  cap: number;
  status: MemberStatus;
  paused_until: string | null;
  can_undo: boolean;
}

export async function getPauseLinkView(token: string, now: Date = new Date()): Promise<{ ok: true; view: PauseLinkView } | { ok: false; reason: 'invalid' | 'not_configured' | 'db_down' }> {
  try {
    const found = await lookupPauseToken(token);
    if (!found.ok) return { ok: false, reason: found.reason === 'not_configured' ? 'not_configured' : found.reason === 'invalid' || found.reason === 'not_found' ? 'invalid' : 'db_down' };
    const cur = await memberRow(found.token.member_id);
    if (!cur.ok) return { ok: false, reason: cur.reason === 'not_configured' ? 'not_configured' : 'db_down' };
    if (!cur.row) return { ok: false, reason: 'invalid' };
    const nowMs = now.getTime();
    const eff = effectiveStatus(cur.row.status, cur.row.paused_until, nowMs);
    const { paused_at, undo_status } = found.token;
    const can_undo = eff.status === 'paused' && paused_at !== null && undo_status !== null && nowMs - Date.parse(paused_at) < PAUSE_UNDO_MS;
    return { ok: true, view: { member_name: cur.row.name, cap: cur.row.cap, status: eff.status, paused_until: eff.paused_until, can_undo } };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

/* ========================================================================== *
 * Join, settings, turning the gate on, delete
 * ========================================================================== */

/**
 * Creates the members row for a VERIFIED session (id and email from Supabase Auth, never from the browser).
 * `created` is true when this call inserted it (audit `member_joined`).
 */
export async function ensureMemberRow(user: MemberRef): Promise<{ ok: true; created: boolean; row: MemberRow } | Failure> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(user.id)) return { ok: false, reason: 'bad_input' };
  const email = String(user.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return { ok: false, reason: 'bad_input' };
  try {
    const ins = await db.from('members').upsert({ id: user.id, email }, { onConflict: 'id', ignoreDuplicates: true }).select('*').abortSignal(timeout());
    if (ins.error) return dbFail(ins.error);
    const created = (ins.data?.length ?? 0) > 0;
    let row: MemberRow | null = ins.data?.[0] ?? null;
    if (!row) {
      const cur = await memberRow(user.id);
      if (!cur.ok) return cur;
      row = cur.row;
    }
    if (!row) return DB_DOWN;
    if (created) await recordAudit('member_joined', { actor_id: user.id, member_id: user.id });
    return { ok: true, created, row };
  } catch {
    return DB_DOWN;
  }
}

/**
 * Saves the /me settings form: profile, asker profile, link, cap, the matched-line toggle and (when the text
 * changed) a new rules version. With `turnOn`, a gate that isn't on yet turns on in the same save (first visit).
 * Rules are saved first, so a gate never turns on without rules.
 */
export async function saveMemberSettings(memberId: string, input: SettingsInput, options: { turnOn?: boolean; requireName?: boolean } = {}): Promise<SettingsResult> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '') as SettingsField;
    return { ok: false, reason: 'bad_input', field: field || undefined };
  }
  const s = parsed.data;
  if (options.requireName && !s.name) return { ok: false, reason: 'bad_input', field: 'name' };
  const rules = normalizeRules(s.rules);
  if (rulesProblem(rules)) return { ok: false, reason: 'bad_input', field: 'rules' };
  try {
    const cur = await memberRow(memberId);
    if (!cur.ok) return cur;
    if (!cur.row) return { ok: false, reason: 'not_found' };
    const before = await currentRules(memberId);
    if (!before.ok) return before;
    let version = before.rules?.version ?? 0;
    const rulesChanged = !before.rules || before.rules.text !== rules;
    if (rulesChanged) {
      const saved = await saveRules(memberId, rules, 'web');
      if (!saved.ok) return { ok: false, reason: saved.reason, field: saved.reason === 'bad_input' ? 'rules' : undefined };
      version = saved.version;
    }
    const turningOn = Boolean(options.turnOn) && cur.row.status === 'pending';
    const patch = {
      name: s.name,
      one_line: s.one_line,
      company: s.company,
      stage: s.stage,
      city: s.city,
      scheduling_url: s.scheduling_url,
      cap: s.cap,
      show_matched: s.show_matched,
      ...(turningOn ? { status: 'on' as const, paused_until: null } : {}),
    };
    const { data, error } = await db.from('members').update(patch).eq('id', memberId).select('status, updated_at').abortSignal(timeout()).single();
    if (error || !data) return { ...dbFail(error), field: error?.code === '23514' ? guessField(error.message) : undefined };
    if (turningOn) await recordAudit('member_gate_on', { actor_id: memberId, member_id: memberId, detail: { cap: s.cap } });
    const savedAt = rulesChanged ? new Date().toISOString() : data.updated_at;
    return { ok: true, version, saved_at: savedAt, rules_changed: rulesChanged, status: data.status };
  } catch {
    return DB_DOWN;
  }
}

function guessField(message: string | undefined): SettingsField | undefined {
  const m = message ?? '';
  for (const f of ['scheduling_url', 'one_line', 'company', 'stage', 'city', 'name', 'cap'] as const) if (m.includes(f)) return f;
  return undefined;
}

/**
 * First visit (“Turn on my gate”): makes sure the members row exists for the verified session, then saves the
 * settings and rules and turns the gate on. Name and at least one rule are required.
 */
export async function turnOnGate(user: MemberRef, input: SettingsInput): Promise<SettingsResult> {
  const ensured = await ensureMemberRow(user);
  if (!ensured.ok) return ensured;
  return saveMemberSettings(user.id, input, { turnOn: true, requireName: true });
}

/**
 * Deletes everything the member owns (ux-spec S3 “Delete”): scheduled emails are cancelled first (BE2), then the
 * auth user is deleted, which cascades every row (members, rules, offers, check-ins, tokens, their asks). The audit
 * fact `member_deleted` is written after the delete succeeds, with no member id: the board counts it, and a failed
 * delete never counts as one. (The contract writes it with the id just before; the id would be nulled by the
 * cascade either way, so the stored row is the same, and this order can't record a delete that didn't happen.)
 */
export async function deleteMember(memberId: string): Promise<SaveResult> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  try {
    const cancelled = await cancelMemberEmails(memberId, 'all');
    if (!cancelled.ok && cancelled.reason === 'db_down') return DB_DOWN;
    const { error } = await db.auth.admin.deleteUser(memberId);
    if (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404) return DB_DOWN;
      // No auth user: remove a stray members row directly (it cascades the same way).
      const { error: rowError } = await db.from('members').delete().eq('id', memberId).abortSignal(timeout());
      if (rowError) return dbFail(rowError);
    }
    await recordAudit('member_deleted', { detail: { via: 'web' } });
    return { ok: true };
  } catch {
    return DB_DOWN;
  }
}

/** Which source the current rules version came from (the first-visit block says “From the playground”). */
export async function getRulesSource(memberId: string, version: number): Promise<RulesSource | null> {
  const db = admin();
  if (!db || !isMemberId(memberId) || version < 1) return null;
  try {
    const { data } = await db.from('rule_versions').select('source').eq('member_id', memberId).eq('version', version).abortSignal(timeout()).maybeSingle();
    return data?.source ?? null;
  } catch {
    return null;
  }
}

/* ========================================================================== *
 * The monthly ledger (“This month”)
 * ========================================================================== */

export interface LedgerDecision {
  ask_id: string;
  attempt: number;
  verdict: 'accept' | 'decline' | 'ask_back' | null;
  /** lib/types CitedQuote[] as stored (offsets index that decision's rules version). */
  cited: unknown;
  created_at: string;
}

export interface MemberLedger extends LedgerCounts {
  /** Cap month, YYYY-MM-01 (Pacific time). */
  month: string;
  /** One per non-blank line of the CURRENT rules; null when nothing reached the gate this month. */
  tallies: string[] | null;
  /** The quoted words, mapped onto the current rules with findClause (offsets into the current text). */
  ranges: { start: number; end: number }[];
  /** The member's own words from the latest accept (the “Asker sees: Matched: …” preview), or null. */
  example: string | null;
}

function foundQuotes(cited: unknown): string[] {
  if (!Array.isArray(cited)) return [];
  const out: string[] = [];
  for (const c of cited) {
    if (c && typeof c === 'object' && (c as { found?: unknown }).found === true && typeof (c as { text?: unknown }).text === 'string') out.push((c as { text: string }).text);
  }
  return out;
}

/**
 * Counts and per-line tallies from the member's own gate decisions this month (docs/CONTRACT.md §b, S3): one final
 * decision per ask (the rerun after an answer replaces the first), quotes mapped onto the CURRENT rules with
 * findClause; quotes from older versions that no longer match count as `old_lines`. Never ask text, subject or asker.
 */
export function buildLedger(rules: string, decisions: readonly LedgerDecision[], reachedYou: number, month: string): MemberLedger {
  const finals = new Map<string, LedgerDecision>();
  for (const d of decisions) {
    const prev = finals.get(d.ask_id);
    if (!prev || d.attempt > prev.attempt || (d.attempt === prev.attempt && d.created_at > prev.created_at)) finals.set(d.ask_id, d);
  }
  const lines = ruleLines(rules);
  const per = lines.map(() => ({ accept: 0, ask_back: 0, decline: 0 }));
  const ranges: { start: number; end: number }[] = [];
  let declined = 0;
  let failed = 0;
  let noLine = 0;
  let oldLines = 0;
  let example: string | null = null;
  let exampleAt = '';
  for (const d of finals.values()) {
    if (!d.verdict) {
      failed++;
      continue;
    }
    if (d.verdict === 'decline') declined++;
    const quotes = foundQuotes(d.cited);
    if (!quotes.length) {
      if (d.verdict === 'decline') noLine++;
      continue;
    }
    const touched = new Set<number>();
    for (const quote of quotes) {
      const r = findClause(rules, quote);
      if (!r) continue;
      ranges.push({ start: r.start, end: r.end });
      for (const l of lines) if (r.start < Math.max(l.end, l.start + 1) && r.end > l.start) touched.add(l.index);
      if (d.verdict === 'accept' && (example === null || d.created_at > exampleAt)) {
        example = rules.slice(r.start, r.end);
        exampleAt = d.created_at;
      }
    }
    if (!touched.size) {
      oldLines++;
      continue;
    }
    for (const i of touched) {
      const t = per[i];
      if (t) t[d.verdict]++;
    }
  }
  const reached_gate = finals.size;
  return {
    month,
    reached_gate,
    reached_you: reachedYou,
    declined,
    failed,
    no_line: noLine,
    old_lines: oldLines,
    tallies: reached_gate ? per.map(tallyText) : null,
    ranges,
    example,
  };
}

/** The member's ledger for the current cap month (Pacific time): decisions their gate made, and offers delivered. */
export async function getMonthLedger(memberId: string, rules: string, now: Date = new Date()): Promise<{ ok: true; ledger: MemberLedger } | Failure> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  const month = capMonth(now);
  if (!isMemberId(memberId)) return { ok: true, ledger: buildLedger(rules, [], 0, month) };
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7));
  const start = new Date(zonedTimeToUtc(y, mo, 1, 0, 0, NETWORK_TZ)).toISOString();
  const end = nextMonthStart(month).toISOString();
  try {
    const [d, used] = await Promise.all([
      db
        .from('gate_decisions')
        .select('ask_id, attempt, verdict, cited, created_at')
        .eq('member_id', memberId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true })
        .limit(5000)
        .abortSignal(timeout()),
      getCapUsed(memberId, now),
    ]);
    if (d.error) return dbFail(d.error);
    if (!used.ok) return used;
    return { ok: true, ledger: buildLedger(rules, (d.data ?? []) as LedgerDecision[], used.used, month) };
  } catch {
    return DB_DOWN;
  }
}

/* ========================================================================== *
 * Export (GET /me/export): the member's own rows, never anyone else's
 * ========================================================================== */

export async function exportMemberData(memberId: string): Promise<{ ok: true; data: Record<string, unknown> } | Failure> {
  const db = admin();
  if (!db) return NOT_CONFIGURED;
  if (!isMemberId(memberId)) return { ok: false, reason: 'not_found' };
  try {
    const [m, versions, usage, offers, introsAsMember, introsAsAsker, checkins, tokens, pauses, decisions] = await Promise.all([
      db.from('members').select('*').eq('id', memberId).abortSignal(timeout()).maybeSingle(),
      db.from('rule_versions').select('version, text, source, created_at').eq('member_id', memberId).order('version', { ascending: true }).abortSignal(timeout()),
      db.from('cap_usage').select('month, used').eq('member_id', memberId).order('month', { ascending: true }).abortSignal(timeout()),
      db
        .from('offers')
        .select('id, ask_id, position, month, state, offered_at, expires_at, responded_at, answer, no_reason, no_note')
        .eq('member_id', memberId)
        .order('offered_at', { ascending: true })
        .abortSignal(timeout()),
      db.from('intros').select('id, ask_id, sent_at, created_at').eq('member_id', memberId).abortSignal(timeout()),
      db.from('intros').select('id, ask_id, sent_at, created_at').eq('asker_id', memberId).abortSignal(timeout()),
      db.from('checkins').select('id, intro_id, role, kind, due_at, sent_at, answer, answered_at, closes_at').eq('member_id', memberId).abortSignal(timeout()),
      db.from('api_tokens').select('id, label, created_at, last_used_at, last_used_from, revoked_at').eq('member_id', memberId).abortSignal(timeout()),
      db.from('pause_tokens').select('created_at, last_used_at, paused_at').eq('member_id', memberId).abortSignal(timeout()),
      db.from('gate_decisions').select('verdict, error_kind, created_at').eq('member_id', memberId).limit(20000).abortSignal(timeout()),
    ]);
    const firstError = [m, versions, usage, offers, introsAsMember, introsAsAsker, checkins, tokens, pauses, decisions].find((r) => r.error)?.error;
    if (firstError) return dbFail(firstError);
    if (!m.data) return { ok: false, reason: 'not_found' };
    // The subjects of asks that were offered to this member (they saw those cards); nothing about asks they never saw.
    const askIds = [...new Set((offers.data ?? []).map((o) => o.ask_id))];
    const subjects = new Map<string, string>();
    if (askIds.length) {
      const asks = await db.from('asks').select('id, subject').in('id', askIds).abortSignal(timeout());
      if (asks.error) return dbFail(asks.error);
      for (const a of asks.data ?? []) subjects.set(a.id, a.subject);
    }
    // Gate decisions as monthly counts only: the asks behind them were never shown to the member.
    const gate: Record<string, { checked: number; accept: number; decline: number; ask_back: number; not_checked: number }> = {};
    for (const d of decisions.data ?? []) {
      const month = capMonth(Date.parse(d.created_at));
      const g = (gate[month] ??= { checked: 0, accept: 0, decline: 0, ask_back: 0, not_checked: 0 });
      g.checked++;
      if (d.verdict) g[d.verdict]++;
      else g.not_checked++;
    }
    const row = m.data;
    return {
      ok: true,
      data: {
        member: {
          email: row.email,
          name: row.name,
          one_line: row.one_line,
          company: row.company,
          stage: row.stage,
          city: row.city,
          scheduling_url: row.scheduling_url,
          cap: row.cap,
          show_matched: row.show_matched,
          accept_guests: row.accept_guests,
          status: row.status,
          paused_until: row.paused_until,
          created_at: row.created_at,
        },
        rules_versions: versions.data ?? [],
        cap_usage: usage.data ?? [],
        gate_decisions_by_month: gate,
        offers_received: (offers.data ?? []).map((o) => ({ ...o, ask_subject: subjects.get(o.ask_id) ?? null })),
        intros: [
          ...(introsAsMember.data ?? []).map((i) => ({ ...i, role: 'member' })),
          ...(introsAsAsker.data ?? []).map((i) => ({ ...i, role: 'asker' })),
        ],
        checkins: checkins.data ?? [],
        claude_code_tokens: tokens.data ?? [],
        pause_links: pauses.data ?? [],
      },
    };
  } catch {
    return DB_DOWN;
  }
}

/* ========================================================================== *
 * Email-code sign-in (/join): rate limits, Supabase OTP, the members row
 * ========================================================================== */

/** Limits (tech.md “email_and_links”): Supabase allows one code per email a minute; ours sit on top. */
export const OTP_LIMITS = {
  resendAfterS: OTP_TIMING.resendAfterS,
  /** Codes per email address (“Too many codes requested. Try again at 10:40.”). */
  sendsPerEmail: { limit: 3, window_s: 900 },
  /** Code requests per network address. */
  sendsPerIp: { limit: 10, window_s: 600 },
  /** Tries per code (“That code didn’t match. 4 tries left.”). */
  triesPerCode: OTP_TIMING.triesPerCode,
  /**
   * Verify attempts per email address, whatever the code: the per-code count is keyed by the send time the browser
   * echoes back, so on its own a client could reset it. 3 codes × 5 tries per 15 minutes bounds a guesser at 15 tries
   * against a million codes per quarter hour.
   */
  verifiesPerEmail: { limit: 15, window_s: 900 },
  /** Verify attempts per network address. */
  verifiesPerIp: { limit: 30, window_s: 600 },
} as const;

type LimitHit = { allowed: boolean; hits: number; retry_at: string };

const processSalt = randomBytes(16).toString('hex');
const memoryWindows = new Map<string, { start: number; count: number }>();

function memoryHit(key: string, limit: number, windowS: number, nowMs: number): LimitHit {
  const start = Math.floor(nowMs / (windowS * 1000)) * windowS * 1000;
  const cur = memoryWindows.get(key);
  const entry = cur && cur.start === start ? cur : { start, count: 0 };
  entry.count++;
  memoryWindows.set(key, entry);
  if (memoryWindows.size > 5000) {
    for (const [k, v] of memoryWindows) if (v.start + windowS * 1000 < nowMs) memoryWindows.delete(k);
  }
  return { allowed: entry.count <= limit, hits: entry.count, retry_at: new Date(start + windowS * 1000).toISOString() };
}

/**
 * Counts one hit. Keys are HMAC(value, daily salt) (lib/oti/tokens rateKey), never a raw email or IP. Uses the
 * Postgres counter (public.hit_rate_limit, bucket `otp`) when the database and RATE_LIMIT_SALT_SECRET are set;
 * otherwise, or when that call fails or takes over 300 ms, an in-memory window per server instance.
 */
async function hitLimit(kind: string, value: string, limit: number, windowS: number, nowMs: number): Promise<LimitHit> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const hmac = rateKey(`${kind}:${value}`, day);
  const db = admin();
  if (hmac && db) {
    try {
      const { data, error } = await db
        .rpc('hit_rate_limit', { p_key: `${kind}:${hmac}`, p_bucket: 'otp', p_window_s: windowS, p_limit: limit })
        .abortSignal(AbortSignal.timeout(300));
      const row = Array.isArray(data) ? data[0] : null;
      if (!error && row) return { allowed: row.allowed, hits: row.hits, retry_at: new Date(row.retry_at).toISOString() };
    } catch {
      /* fall back to memory */
    }
  }
  const local = hmac ?? createHash('sha256').update(`${processSalt}:${kind}:${value}`).digest('hex').slice(0, 32);
  return memoryHit(`${kind}:${local}`, limit, windowS, nowMs);
}

/** Exposed for tests: forget the in-memory windows. */
export function __resetOtpMemoryForTests(): void {
  memoryWindows.clear();
}

/** The subset of Supabase Auth the sign-in flow uses (the server client's `auth`; a fake in tests). */
export interface OtpAuthClient {
  signInWithOtp(credentials: { email: string; options?: { shouldCreateUser?: boolean } }): Promise<{ error: AuthErrorLike | null }>;
  verifyOtp(params: { email: string; token: string; type: 'email' }): Promise<{ error: AuthErrorLike | null }>;
  getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: AuthErrorLike | null }>;
}
type AuthErrorLike = { message: string; status?: number; code?: string };

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);

export type SendCodeResult =
  | { ok: true; sent_at: number; resend_in_s: number }
  | { ok: false; error: 'invalid_email' | 'limited' | 'not_authorized' | 'not_available' | 'down'; retry_at: string | null };

type SendFailure = Extract<SendCodeResult, { ok: false }>['error'];

/** Maps Supabase's send errors. A 429 that says “after N seconds” means a code went out under a minute ago. */
function classifySendError(error: AuthErrorLike): { kind: 'just_sent'; wait_s: number } | { kind: SendFailure } {
  const code = error.code ?? '';
  const after = /after (\d+) seconds?/i.exec(error.message ?? '');
  if (after) return { kind: 'just_sent', wait_s: Math.min(60, Math.max(1, Number(after[1]))) };
  if (error.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return { kind: 'limited' };
  if (code === 'email_address_invalid' || code === 'validation_failed') return { kind: 'invalid_email' };
  if (code === 'email_address_not_authorized') return { kind: 'not_authorized' };
  if (code === 'signup_disabled' || code === 'otp_disabled' || code === 'email_provider_disabled') return { kind: 'not_available' };
  return { kind: 'down' };
}

/** Requests a 6-digit code (Supabase signInWithOtp; never a magic link). `ip` only feeds the HMAC'd limit key. */
export async function requestSignInCode(auth: OtpAuthClient | null, input: { email: unknown; ip: string | null }, now: Date = new Date()): Promise<SendCodeResult> {
  if (!auth || !admin()) return { ok: false, error: 'not_available', retry_at: null };
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return { ok: false, error: 'invalid_email', retry_at: null };
  const email = parsed.data;
  const nowMs = now.getTime();
  if (input.ip) {
    const byIp = await hitLimit('os', input.ip, OTP_LIMITS.sendsPerIp.limit, OTP_LIMITS.sendsPerIp.window_s, nowMs);
    if (!byIp.allowed) return { ok: false, error: 'limited', retry_at: byIp.retry_at };
  }
  const byEmail = await hitLimit('oe', email, OTP_LIMITS.sendsPerEmail.limit, OTP_LIMITS.sendsPerEmail.window_s, nowMs);
  if (!byEmail.allowed) return { ok: false, error: 'limited', retry_at: byEmail.retry_at };
  try {
    const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (!error) return { ok: true, sent_at: nowMs, resend_in_s: OTP_LIMITS.resendAfterS };
    const c = classifySendError(error);
    if (c.kind === 'just_sent') return { ok: true, sent_at: nowMs - (OTP_LIMITS.resendAfterS - c.wait_s) * 1000, resend_in_s: c.wait_s };
    return { ok: false, error: c.kind, retry_at: null };
  } catch {
    return { ok: false, error: 'down', retry_at: null };
  }
}

/** A same-site path to continue to after sign-in (`?next=`), or null. Never another origin, never /join itself. */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string') return null;
  const v = next.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.length > 300) return null;
  if (/[\u0000-\u001f\s]/.test(v)) return null;
  if (v === '/join' || v.startsWith('/join?') || v.startsWith('/join/') || v.startsWith('/api/')) return null;
  return v;
}

const carriedSchema = z.object({
  rules: z.string().max(4000),
  cap: z.number().int().min(1).max(5),
});

export type VerifyCodeResult =
  | { ok: true; next: string; created: boolean }
  | { ok: false; error: 'invalid_code' | 'rejected' | 'no_tries' | 'limited' | 'not_available' | 'down'; tries_left: number; retry_at: string | null };

/**
 * Verifies the code (Supabase verifyOtp sets the session cookies through the server client), then creates the
 * members row from the VERIFIED session (getUser, never the email the browser typed) and, for a member without rules
 * yet, saves the rules carried from the playground (source `playground`) and their cap. Rules never reach the database
 * before this point. A member who already has rules keeps them: /me?carried=1 offers the playground rules as unsaved
 * changes instead of overwriting anything.
 */
export async function verifySignInCode(
  auth: OtpAuthClient | null,
  input: { email: unknown; code: unknown; sent_at: unknown; carried: unknown; next: unknown; ip: string | null },
  now: Date = new Date(),
): Promise<VerifyCodeResult> {
  const fail = (error: Extract<VerifyCodeResult, { ok: false }>['error'], tries_left = 0, retry_at: string | null = null): VerifyCodeResult => ({ ok: false, error, tries_left, retry_at });
  if (!auth || !admin()) return fail('not_available');
  const email = emailSchema.safeParse(input.email);
  const code = typeof input.code === 'string' ? input.code.replace(/\D/g, '') : '';
  if (!email.success || code.length !== 6) return fail('invalid_code', OTP_LIMITS.triesPerCode);
  const nowMs = now.getTime();
  const sentAt = typeof input.sent_at === 'number' && Number.isFinite(input.sent_at) && input.sent_at <= nowMs + 60_000 && input.sent_at > nowMs - DAY_MS ? Math.floor(input.sent_at) : 0;
  if (input.ip) {
    const byIp = await hitLimit('vi', input.ip, OTP_LIMITS.verifiesPerIp.limit, OTP_LIMITS.verifiesPerIp.window_s, nowMs);
    if (!byIp.allowed) return fail('limited', 0, byIp.retry_at);
  }
  const byEmail = await hitLimit('ve', email.data, OTP_LIMITS.verifiesPerEmail.limit, OTP_LIMITS.verifiesPerEmail.window_s, nowMs);
  if (!byEmail.allowed) return fail('limited', 0, byEmail.retry_at);
  const tries = await hitLimit('vt', `${email.data}:${sentAt}`, OTP_LIMITS.triesPerCode, 3600, nowMs);
  if (!tries.allowed) return fail('no_tries', 0);
  const triesLeft = Math.max(0, OTP_LIMITS.triesPerCode - tries.hits);
  try {
    const verified = await auth.verifyOtp({ email: email.data, token: code, type: 'email' });
    if (verified.error) {
      const e = verified.error;
      if (e.status === 429 || e.code === 'over_request_rate_limit') return fail('limited', triesLeft);
      if (e.code === 'otp_expired' || e.code === 'validation_failed' || e.status === 403 || e.status === 400) {
        return triesLeft > 0 ? fail('rejected', triesLeft) : fail('no_tries', 0);
      }
      return fail('down', triesLeft);
    }
    // The code is spent and the session cookies are set. If anything below fails, still continue to /me: it creates
    // the members row on “Turn on my gate” (or shows its own error state), and the code can't be entered twice.
    const explicitNext = safeNext(input.next);
    const fallback: VerifyCodeResult = { ok: true, next: explicitNext ?? '/me?first=1', created: false };
    const { data, error } = await auth.getUser();
    const user = data.user;
    if (error || !user || !user.email) return fallback;
    const ensured = await ensureMemberRow({ id: user.id, email: user.email });
    if (!ensured.ok) return fallback;
    const carried = carriedSchema.safeParse(input.carried);
    let next = explicitNext ?? (ensured.row.status === 'pending' ? '/me?first=1' : '/me');
    if (carried.success && !rulesProblem(carried.data.rules)) {
      const cur = await currentRules(user.id);
      if (cur.ok && !cur.rules) {
        const saved = await saveRules(user.id, carried.data.rules, 'playground');
        if (saved.ok && ensured.row.status === 'pending') await setCap(user.id, carried.data.cap);
      } else if (cur.ok && cur.rules && cur.rules.text !== normalizeRules(carried.data.rules) && !explicitNext) {
        next = ensured.row.status === 'pending' ? '/me?first=1&carried=1' : '/me?carried=1';
      }
    }
    return { ok: true, next, created: ensured.created };
  } catch {
    return fail('down', triesLeft);
  }
}
