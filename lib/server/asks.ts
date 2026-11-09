import 'server-only';
import type { AskerAskView, AskListItem, CompiledAsk, MemberRef } from '@/lib/types';

/**
 * Owner: BE2. REAL asks: who may ask, creating (persisted before any streaming), listing and the asker's view.
 * The asker's view always goes through lib/server/serializer.ts (docs/CONTRACT.md §d).
 *
 * STUB (foundation): signatures are final. Until BE2 replaces the bodies every call reports `not_configured`.
 */

export type RealAskAccess =
  | { allowed: true }
  | { allowed: false; reason: 'not_configured' | 'not_invited' | 'profile_incomplete' | 'db_down' };

/**
 * Whether this signed-in person may ask the REAL network (copy: REAL_ASK_COPY in lib/oti/copy.ts):
 * - `REAL_ASKERS_MODE === 'open'` (REAL_ASKERS unset or `*`, Alan's launch decision): every signed-in member;
 * - `'allowlist'`: only emails on `real_askers` (seeded from REAL_ASKERS on first use; Alan adds invited founders),
 *   otherwise `not_invited`.
 * In both modes the asker needs a members row with a name and company (`profile_incomplete` → “Edit profile ›”).
 */
export async function canAskReal(user: MemberRef): Promise<RealAskAccess> {
  void user;
  return { allowed: false, reason: 'not_configured' };
}

export interface CreateAskInput {
  /** The founder's text (1..600 characters). */
  text: string;
  /** The parts and subject the founder approved on /ask (or in Claude Code). Checked again with lib/oti/ask validateAsk. */
  compiled: CompiledAsk;
  /** Client-generated; a repeat returns the same ask (“Already sent as a_91x at 21:04.”). */
  idempotency_key: string;
  /** “Edit and resend” of one of the asker's own earlier asks (`/ask?resend=<a_id>`): at most one a week. */
  resend_of?: string | null;
}

export type CreateAskResult =
  | { ok: true; id: string; status: 'ready' | 'queued'; repeated: boolean; created_at: string }
  | {
      ok: false;
      /** `refused`: a YC-application ask (YC_APPLICATION_REFUSAL); `too_soon`: a resend within a week (`retry_at`). */
      reason: 'not_configured' | 'not_allowed' | 'invalid' | 'refused' | 'too_soon' | 'db_down';
      message: string;
      retry_at?: string;
    };

/**
 * Creates a REAL ask for `user`, after canAskReal and validateAsk (lib/oti/ask.ts; never trust the client's parts).
 * Status `ready`, or `queued` when they already have 3 open asks (“You have 3 open asks. This one sends when one of
 * them closes.”; BE2 sends the oldest queued ask when one closes). Never sends: POST /api/asks/[id]/send does.
 */
export async function createAsk(user: MemberRef, input: CreateAskInput): Promise<CreateAskResult> {
  void user;
  void input;
  return { ok: false, reason: 'not_configured', message: 'The real network isn’t set up on this instance.' };
}

export type ListResult<T> = { ok: true; items: T[] } | { ok: false; reason: 'not_configured' | 'db_down' };

/** The signed-in person's asks, newest first (S3 “Your asks”, MCP my_asks). */
export async function listMyAsks(user: MemberRef): Promise<ListResult<AskListItem>> {
  void user;
  return { ok: false, reason: 'not_configured' };
}

export type AskerViewResult = { ok: true; view: AskerAskView } | { ok: false; reason: 'not_found' | 'not_configured' | 'db_down' };

/**
 * The asker's view of one REAL ask, serialized for the asker (4 states, checkpoints applied as of `now`).
 * `not_found` also covers asks that belong to someone else (never reveal that an id exists).
 */
export async function getAskerView(askId: string, user: MemberRef, now: Date = new Date()): Promise<AskerViewResult> {
  void askId;
  void user;
  void now;
  return { ok: false, reason: 'not_configured' };
}
