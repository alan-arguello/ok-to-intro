import 'server-only';
import { looksLikeToken } from '@/lib/oti/ids';
import { bareSubject, NOTE_MAX } from '@/lib/oti/text';
import { toMs } from '@/lib/oti/time';
import { hashToken } from '@/lib/oti/tokens';
import type { CheckinAnswer, CheckinLookup, CheckinSaveResult, CheckinView, D14Outcome, WontHappenReason } from '@/lib/types';
import { background, networkConfigured, rpc } from './audit';
import { cancelEmailKey, displayName, firstName } from './email-send';
import { checkinKey, deliverCheckinEmail, deliverOutcomeNote, localDayAt, readCheckin, REMINDER_DAYS, type CheckinRow } from './intros';

/**
 * Owner: BE2. Follow-through: +1 day (both people: did the call happen, useful 1–5) and +14 days (the asker:
 * unblocked · a customer · a hire · an investor · nothing yet). GET preselects, one POST saves; the answer can
 * change until the window closes. Check-in emails are scheduled at intro time (Resend scheduled send) with the
 * daily cron as a backstop.
 *
 * `/c/[token]` takes the link token from the email (or a check-in id `c_…` for its signed-in recipient).
 */

export type CheckinRef = { token: string } | { checkin_id: string; member_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECKIN_ID = /^c_[0-9A-Za-z]{3,16}$/;
const OUTCOMES: readonly D14Outcome[] = ['unblocked', 'customer', 'hire', 'investor', 'nothing_yet'];
const WONT: readonly WontHappenReason[] = ['no_reply', 'wrong_person', 'timing'];

function refArgs(ref: CheckinRef): { p_token_hash: string | null; p_checkin_id: string | null; p_member: string | null } | null {
  if ('token' in ref) {
    if (typeof ref.token !== 'string' || !looksLikeToken(ref.token)) return null;
    const hash = hashToken('checkin', ref.token);
    return hash ? { p_token_hash: hash, p_checkin_id: null, p_member: null } : null;
  }
  if (typeof ref.checkin_id !== 'string' || !CHECKIN_ID.test(ref.checkin_id) || typeof ref.member_id !== 'string' || !UUID.test(ref.member_id)) return null;
  return { p_token_hash: null, p_checkin_id: ref.checkin_id, p_member: ref.member_id };
}

/** A stored answer, read back only in the shapes the page knows (anything else reads as unanswered). */
function storedAnswer(raw: Record<string, unknown> | null): CheckinAnswer | null {
  return raw ? cleanAnswer(raw) : null;
}

/** Validates and normalises an answer (drops unknown fields). */
export function cleanAnswer(raw: unknown): CheckinAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.kind === 'd1') {
    if (typeof a.rating === 'number' && Number.isInteger(a.rating) && a.rating >= 1 && a.rating <= 5) return { kind: 'd1', rating: a.rating as 1 | 2 | 3 | 4 | 5 };
    if (a.not_yet === true) return { kind: 'd1', not_yet: true };
    if (a.wont_happen === true) {
      const reason = a.reason === null || a.reason === undefined ? null : WONT.includes(a.reason as WontHappenReason) ? (a.reason as WontHappenReason) : undefined;
      return reason === undefined ? null : { kind: 'd1', wont_happen: true, reason };
    }
    return null;
  }
  if (a.kind === 'd14') {
    if (!OUTCOMES.includes(a.outcome as D14Outcome)) return null;
    const note = a.note === null || a.note === undefined ? null : String(a.note).replace(/\s+/g, ' ').trim();
    if (note !== null && note.length > NOTE_MAX) return null;
    return { kind: 'd14', outcome: a.outcome as D14Outcome, note: note || null };
  }
  return null;
}

function toCheckinView(row: CheckinRow): CheckinView {
  const c = row.checkin;
  return {
    checkin_id: c.id,
    ask_id: c.role === 'asker' ? String(row.ask.id) : null,
    kind: c.kind,
    role: c.role,
    sample: false,
    other_name: displayName(row.other.name),
    other_first: firstName(row.other.name),
    intro_subject: bareSubject(row.ask.subject),
    intro_made_at: new Date(toMs(row.intro.created_at)).toISOString(),
    answer: storedAnswer(c.answer),
    answered_at: c.answered_at ? new Date(toMs(c.answered_at)).toISOString() : null,
    closes_at: new Date(toMs(c.closes_at)).toISOString(),
    reminder_at: c.reminder_at ? new Date(toMs(c.reminder_at)).toISOString() : null,
  };
}

export async function getCheckin(ref: CheckinRef, now: Date = new Date()): Promise<CheckinLookup> {
  void now;
  if (!networkConfigured()) return { found: false, reason: 'not_configured' };
  const args = refArgs(ref);
  if (!args) return { found: false, reason: 'invalid' };
  const read = await readCheckin(args);
  if (!read.ok) return { found: false, reason: read.reason };
  if (!read.row) return { found: false, reason: 'invalid' };
  return { found: true, checkin: toCheckinView(read.row) };
}

/** Saves (or changes) an answer. Idempotent per (check-in, idempotency key). Used by /c and MCP record_outcome. */
export async function saveCheckin(ref: CheckinRef, answer: CheckinAnswer, idempotencyKey: string, now: Date = new Date()): Promise<CheckinSaveResult> {
  void idempotencyKey; // the same answer twice is the repeat: the database compares answers, not keys
  if (!networkConfigured()) return { ok: false, reason: 'not_configured' };
  const args = refArgs(ref);
  if (!args) return { ok: false, reason: 'invalid' };
  const clean = cleanAnswer(answer);
  if (!clean) {
    const read = await readCheckin(args);
    return { ok: false, reason: 'bad_input', ...(read.ok && read.row ? { checkin: toCheckinView(read.row) } : {}) };
  }
  const before = await readCheckin(args);
  if (!before.ok) return { ok: false, reason: before.reason };
  if (!before.row) return { ok: false, reason: 'invalid' };
  const wasNotYet = before.row.checkin.answer?.not_yet === true;

  const res = await rpc<{ ok: boolean; reason?: 'invalid' | 'closed' | 'bad_input'; repeated?: boolean; checkin_id?: string; first?: boolean; reminder_at?: string | null; intro_id?: string }>(
    'net_save_checkin',
    { ...args, p_answer: clean, p_now: now.toISOString(), p_reminder_at: localDayAt(now, REMINDER_DAYS, 10).toISOString() },
  );
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const d = res.data;
  const after = await readCheckin({ p_token_hash: null, p_checkin_id: before.row.checkin.id, p_member: null });
  const view = after.ok && after.row ? toCheckinView(after.row) : toCheckinView(before.row);
  if (!d?.ok) return { ok: false, reason: d?.reason ?? 'invalid', checkin: view };

  if (!d.repeated) {
    // Emails this answer causes go out after the response (the /c POST and its 303 stay fast); each has its own key.
    const c = before.row.checkin;
    const isNotYet = 'not_yet' in clean;
    // “We haven't talked yet”: one reminder. Any other answer makes a pending reminder moot.
    if (isNotYet && d.reminder_at) await background('check-in reminder', () => deliverCheckinEmail(c.id, now, { reminder: true }));
    if (!isNotYet && wasNotYet) await background('reminder cancel', () => cancelEmailKey(checkinKey(c.kind, c.id, true)));
    // The asker reported something useful two weeks on: a short thank-you note to the member, once per intro.
    const introId = d.intro_id;
    if (clean.kind === 'd14' && c.role === 'asker' && clean.outcome !== 'nothing_yet' && introId) {
      const outcome = clean.outcome;
      await background('outcome note', () => deliverOutcomeNote(introId, outcome, now));
    }
  }
  return { ok: true, checkin: view, repeated: !!d.repeated };
}
