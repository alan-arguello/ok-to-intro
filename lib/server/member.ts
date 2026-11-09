import 'server-only';
import type { MemberProfile } from '@/lib/types';

/**
 * Owner: S3. Members: profile and settings, rules versions (public.save_rules), cap, pause, pause links,
 * delete and export. Rules never reach the database before the email code is verified.
 *
 * STUB (foundation): signatures are final. Until S3 replaces the bodies every call reports `not_configured`.
 */

export type MemberResult = { ok: true; member: MemberProfile | null } | { ok: false; reason: 'not_configured' | 'db_down' };

export type SaveResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: 'not_configured' | 'db_down' | 'bad_input' | 'not_found' | 'invalid'; message?: string };

export type RulesSource = 'web' | 'playground' | 'offer_edit' | 'mcp';

/**
 * The member's profile (incl. the asker profile: company, stage, city), settings and current rules;
 * `member: null` when signed in but no members row exists yet. S3 creates the members row with the email of the
 * VERIFIED session (never an email the browser sends) when the code verifies.
 */
export async function getMemberProfile(memberId: string): Promise<MemberResult> {
  void memberId;
  return { ok: false, reason: 'not_configured' };
}

/** Saves a new rules version (1..1000 characters) and makes it current. Used by /me, MCP set_rules. */
export async function saveRules(memberId: string, text: string, source: RulesSource): Promise<SaveResult<{ version: number }>> {
  void memberId;
  void text;
  void source;
  return { ok: false, reason: 'not_configured' };
}

/**
 * Appends one templated line to the member's rules as a new version (S4 “Add to my rules”). The line is written
 * by code, additive only; duplicates are a no-op that returns the current version.
 */
export async function appendRuleLine(memberId: string, line: string, source: RulesSource = 'offer_edit'): Promise<SaveResult<{ version: number }>> {
  void memberId;
  void line;
  void source;
  return { ok: false, reason: 'not_configured' };
}

/** Sets the monthly cap (1..5). Takes effect at the next offer; slots already used this month stay used. */
export async function setCap(memberId: string, cap: number): Promise<SaveResult> {
  void memberId;
  void cap;
  return { ok: false, reason: 'not_configured' };
}

/**
 * Pauses new offers until `until` (ISO), or until the member turns asks back on (`until: null`).
 * Offers already delivered can still be answered. `stopEmails` (one-click unsubscribe) also cancels this
 * member's scheduled check-in emails through BE2's cancelMemberEmails(memberId, 'checkins') (tech.md: cancel
 * scheduled sends on pause or delete). Deleting a member calls cancelMemberEmails(memberId, 'all') first.
 */
export async function pauseMember(memberId: string, until: string | null, options: { stopEmails?: boolean } = {}): Promise<SaveResult<{ paused_until: string | null }>> {
  void memberId;
  void until;
  void options;
  return { ok: false, reason: 'not_configured' };
}

/** Turns asks back on. */
export async function resumeMember(memberId: string): Promise<SaveResult> {
  void memberId;
  return { ok: false, reason: 'not_configured' };
}

/**
 * Pauses the member behind an email pause link (/pause/[token], List-Unsubscribe-Post via /api/pause).
 * `reason: 'invalid'` for an unknown token. No sign-in. Records on the token row when it paused and the member's
 * status / paused_until just before (pause_tokens.paused_at, undo_status, undo_paused_until), for Undo.
 * With `stopEmails` it also calls BE2's cancelMemberEmails(memberId, 'checkins').
 */
export async function pauseByToken(token: string, until: string | null, options: { stopEmails?: boolean } = {}): Promise<SaveResult<{ paused_until: string | null }>> {
  void token;
  void until;
  void options;
  return { ok: false, reason: 'not_configured' };
}

/**
 * Undo on /pause/[token] (“Paused until Dec 1. (Undo)”): restores the status and paused_until saved by this same
 * token's last pause, only within 24 hours of it, and clears them. Anything else is `invalid` (a pause token can't
 * un-pause a member who paused elsewhere). No sign-in. Emails cancelled by that pause stay cancelled.
 */
export async function undoPauseByToken(token: string): Promise<SaveResult<{ status: 'pending' | 'on' | 'paused'; paused_until: string | null }>> {
  void token;
  return { ok: false, reason: 'not_configured' };
}

/**
 * An absolute “Pause all asks” URL for this member's emails (`/pause/<token>`), minting a pause token on first
 * use. Null when tokens aren't configured. Used by BE2 when it builds email footers.
 */
export async function createPauseLink(memberId: string): Promise<string | null> {
  void memberId;
  return null;
}
