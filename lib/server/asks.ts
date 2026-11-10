import 'server-only';
import { REAL_ASKERS, REAL_ASKERS_MODE } from '@/lib/env';
import { PART_MAX, TOPIC_MAX, validateAsk } from '@/lib/oti/ask';
import { NOTHING_SENT, REAL_ASK_COPY } from '@/lib/oti/copy';
import { isRealAskId, publicId } from '@/lib/oti/ids';
import { fmtWeekday, NETWORK_TZ, toMs, zonedParts } from '@/lib/oti/time';
import type { AskerAskView, AskerOutcome, AskListItem, CompiledAsk, MemberRef } from '@/lib/types';
import { background, networkConfigured, rpc } from './audit';
import { afterAdvance, completeAdvance, deliverWithdrawnEmail, mintSlots, sendPromoted, tickAsk, tickDue, type AdvanceResult } from './offers';
import { askListItem, parseSnapshot, serializeForAsker } from './serializer';

/**
 * Owner: BE2. REAL asks: who may ask, creating (persisted before any streaming), listing and the asker's view.
 * The asker's view always goes through lib/server/serializer.ts (docs/CONTRACT.md §d).
 */

/**
 * What a cookie-authenticated /api/asks route answers when nobody is signed in (401), sign-in isn't set up on this
 * instance (503, “not set up”, never “down”), or the session check failed (503). Nothing changed either way.
 */
export function sessionRefusal(reason: 'not_configured' | 'signed_out' | 'error'): { status: 401 | 503; body: { error: string; message: string } } {
  if (reason === 'signed_out') {
    return { status: 401, body: { error: 'signed_out', message: REAL_ASKERS_MODE === 'open' ? REAL_ASK_COPY.signedOutOpen : REAL_ASK_COPY.signedOutAllowlist } };
  }
  if (reason === 'not_configured') return { status: 503, body: { error: 'not_configured', message: `${REAL_ASK_COPY.notConfigured} ${NOTHING_SENT}` } };
  return { status: 503, body: { error: 'error', message: `Sign-in isn’t answering right now. ${NOTHING_SENT}` } };
}

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
  if (!networkConfigured()) return { allowed: false, reason: 'not_configured' };
  const email = String(user?.email ?? '').toLowerCase();
  const res = await rpc<{ member: boolean; name: string; company: string; listed: boolean }>('net_asker_access', {
    p_asker: user.id,
    p_email: email,
    p_env_emails: REAL_ASKERS_MODE === 'allowlist' ? [...REAL_ASKERS] : [],
  });
  if (!res.ok) return { allowed: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const d = res.data;
  if (REAL_ASKERS_MODE === 'allowlist' && !(REAL_ASKERS.includes(email) || d?.listed)) return { allowed: false, reason: 'not_invited' };
  if (!d?.member || !String(d.name ?? '').trim() || !String(d.company ?? '').trim()) return { allowed: false, reason: 'profile_incomplete' };
  return { allowed: true };
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

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * The asker's deadline (“By”) as a Pacific-time date, when it names one: “Nov 21”, “before November 21, 2026”,
 * “21 Nov”, “2026-11-21”. A date without a year is the next one on or after today. Anything else has no deadline.
 */
export function parseDeadline(by: string, now: Date = new Date()): string | null {
  const s = String(by ?? '').toLowerCase();
  const today = zonedParts(now.getTime(), NETWORK_TZ);
  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const md = s.match(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4})\\b)?`));
  const dm = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?(?:,?\\s*(\\d{4})\\b)?`));
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (md) [m, d, y] = [MONTHS[md[1] as string] ?? null, Number(md[2]), md[3] ? Number(md[3]) : null];
  else if (dm) [d, m, y] = [Number(dm[1]), MONTHS[dm[2] as string] ?? null, dm[3] ? Number(dm[3]) : null];
  if (!m || !d) return null;
  if (y === null) y = m < today.month || (m === today.month && d < today.day) ? today.year + 1 : today.year;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < today.year - 1 || y > today.year + 2) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The ask exactly as approved, trimmed, with no price: a price is known only after a gate asked and the asker answered. */
function cleanCompiled(text: string, c: CompiledAsk): CompiledAsk {
  const t = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, PART_MAX);
  const topic = typeof c.topic === 'string' ? c.topic.replace(/\s+/g, ' ').trim().slice(0, TOPIC_MAX) : '';
  return {
    parts: { challenge: t(c.parts.challenge), tried: t(c.parts.tried), needs: t(c.parts.needs), by: t(c.parts.by), offers: t(c.parts.offers) },
    subject: String(c.subject).trim(),
    text: String(c.text || text).trim(),
    price: null,
    topic: topic || null,
  };
}

/**
 * Creates a REAL ask for `user`, after canAskReal and validateAsk (lib/oti/ask.ts; never trust the client's parts).
 * Status `ready`, or `queued` when they already have 3 open asks (“You have 3 open asks. This one sends when one of
 * them closes.”; BE2 sends the oldest queued ask when one closes). Never sends: POST /api/asks/[id]/send does.
 */
export async function createAsk(user: MemberRef, input: CreateAskInput): Promise<CreateAskResult> {
  if (!networkConfigured()) return { ok: false, reason: 'not_configured', message: `${REAL_ASK_COPY.notConfigured} ${NOTHING_SENT}` };
  const access = await canAskReal(user);
  if (!access.allowed) {
    if (access.reason === 'not_invited') return { ok: false, reason: 'not_allowed', message: REAL_ASK_COPY.notInvited };
    if (access.reason === 'profile_incomplete') return { ok: false, reason: 'not_allowed', message: REAL_ASK_COPY.profileIncomplete };
    if (access.reason === 'not_configured') return { ok: false, reason: 'not_configured', message: `${REAL_ASK_COPY.notConfigured} ${NOTHING_SENT}` };
    return { ok: false, reason: 'db_down', message: `Something broke on our side. ${NOTHING_SENT}` };
  }
  const key = typeof input?.idempotency_key === 'string' ? input.idempotency_key.trim() : '';
  if (!key || key.length > 128) return { ok: false, reason: 'invalid', message: 'Send an idempotency key (1 to 128 characters).' };
  const check = validateAsk(input.text, input.compiled);
  if (!check.ok) return { ok: false, reason: check.reason === 'yc_application' ? 'refused' : 'invalid', message: check.message };
  const resendOf = input.resend_of ?? null;
  if (resendOf !== null && (typeof resendOf !== 'string' || !isRealAskId(resendOf))) return { ok: false, reason: 'invalid', message: 'That ask isn’t yours to resend.' };

  const now = new Date();
  const compiled = cleanCompiled(input.text, input.compiled);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await rpc<{ ok: boolean; reason?: string; id?: string; status?: 'ready' | 'queued'; repeated?: boolean; created_at?: string; retry_at?: string }>('net_create_ask', {
      p_id: publicId('ask'),
      p_asker: user.id,
      p_idempotency_key: key,
      p_raw: String(input.text).trim(),
      p_compiled: compiled,
      p_subject: compiled.subject,
      p_deadline: parseDeadline(compiled.parts.by, now),
      p_resend_of: resendOf,
      p_now: now.toISOString(),
    });
    if (!res.ok) {
      if (res.code === '23505' && attempt < 2) continue; // a new id collided with an old one: mint another
      return res.reason === 'not_configured'
        ? { ok: false, reason: 'not_configured', message: `${REAL_ASK_COPY.notConfigured} ${NOTHING_SENT}` }
        : { ok: false, reason: 'db_down', message: `Something broke on our side. ${NOTHING_SENT} Your text is kept.` };
    }
    const d = res.data;
    if (d?.ok && d.id && d.status && d.created_at) {
      return { ok: true, id: d.id, status: d.status, repeated: !!d.repeated, created_at: new Date(toMs(d.created_at)).toISOString() };
    }
    if (d?.reason === 'too_soon' && d.retry_at) {
      return { ok: false, reason: 'too_soon', retry_at: new Date(toMs(d.retry_at)).toISOString(), message: `You can resend an ask once a week. The next resend of this one is on ${fmtWeekday(toMs(d.retry_at), NETWORK_TZ)}.` };
    }
    if (d?.reason === 'too_many') return { ok: false, reason: 'not_allowed', message: 'You have 3 open asks and 3 more waiting to send. Withdraw one of them first.' };
    if (d?.reason === 'not_found') return { ok: false, reason: 'invalid', message: 'That ask isn’t yours to resend.' };
    return { ok: false, reason: 'not_allowed', message: REAL_ASK_COPY.profileIncomplete };
  }
  return { ok: false, reason: 'db_down', message: `Something broke on our side. ${NOTHING_SENT} Your text is kept.` };
}

export type ListResult<T> = { ok: true; items: T[] } | { ok: false; reason: 'not_configured' | 'db_down' };

/** The signed-in person's asks, newest first (S3 “Your asks”, MCP my_asks). */
export async function listMyAsks(user: MemberRef): Promise<ListResult<AskListItem>> {
  if (!networkConfigured()) return { ok: false, reason: 'not_configured' };
  const now = new Date();
  await tickDue({ asker: user.id }, now, 50);
  const res = await rpc<unknown[]>('net_ask_snapshots', { p_asker: user.id, p_limit: 50 });
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const items: AskListItem[] = [];
  for (const raw of Array.isArray(res.data) ? res.data : []) {
    const snap = parseSnapshot(raw);
    if (snap) items.push(askListItem(serializeForAsker(snap, now), snap.ask.created_at));
  }
  return { ok: true, items };
}

export type AskerViewResult = { ok: true; view: AskerAskView } | { ok: false; reason: 'not_found' | 'not_configured' | 'db_down' };

async function readView(askId: string, askerId: string, now: Date): Promise<AskerViewResult & { status?: string }> {
  const res = await rpc<unknown>('net_ask_snapshot', { p_ask: askId, p_asker: askerId });
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  if (res.data === null || res.data === undefined) return { ok: false, reason: 'not_found' };
  const snap = parseSnapshot(res.data);
  if (!snap) return { ok: false, reason: 'db_down' };
  return { ok: true, view: serializeForAsker(snap, now), status: snap.ask.status };
}

/**
 * The asker's view of one REAL ask, serialized for the asker (4 states, checkpoints applied as of `now`).
 * `not_found` also covers asks that belong to someone else (never reveal that an id exists).
 */
export async function getAskerView(askId: string, user: MemberRef, now: Date = new Date()): Promise<AskerViewResult> {
  if (!networkConfigured()) return { ok: false, reason: 'not_configured' };
  if (typeof askId !== 'string' || !isRealAskId(askId)) return { ok: false, reason: 'not_found' };
  const first = await readView(askId, user.id, now);
  if (!first.ok) return first;
  if (first.status !== 'open' && first.status !== 'answered') return { ok: true, view: first.view };
  // Time moves first: offers past 72 hours expire and the ask goes to the next person in line (lazily, on read).
  const tick = await tickAsk(askId, now);
  if (!tick.ok) return { ok: true, view: first.view };
  const second = await readView(askId, user.id, now);
  return second.ok ? { ok: true, view: second.view } : { ok: true, view: first.view };
}

/* ========================================================================== *
 * The asker's actions on a REAL ask (POST /api/asks/[id]/withdraw and /resolve)
 * ========================================================================== */

export type WithdrawResult = { ok: true; withdrawn_at: string; repeated: boolean } | { ok: false; reason: 'not_found' | 'closed' | 'not_configured' | 'db_down' };

/** Withdraws an ask: the person holding it is told it's no longer needed; nobody else is asked. Idempotent. */
export async function withdrawAsk(askId: string, user: MemberRef, now: Date = new Date()): Promise<WithdrawResult> {
  if (!networkConfigured()) return { ok: false, reason: 'not_configured' };
  if (!isRealAskId(String(askId ?? ''))) return { ok: false, reason: 'not_found' };
  const res = await rpc<{ ok: boolean; reason?: 'not_found' | 'closed'; repeated?: boolean; withdrawn_at?: string; held_offer_id?: string | null; promoted?: string | null }>(
    'net_withdraw_ask',
    { p_ask: askId, p_asker: user.id, p_now: now.toISOString() },
  );
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const d = res.data;
  if (!d?.ok || !d.withdrawn_at) return { ok: false, reason: d?.reason === 'closed' ? 'closed' : 'not_found' };
  // After the response: the note to the person who held it (key withdrawn:<offer>; the cron retries a failure) and
  // the asker's next queued ask, which now has room.
  const held = d.held_offer_id;
  if (held) await background('withdrawn email', () => deliverWithdrawnEmail(held, now));
  if (d.promoted) await sendPromoted(d.promoted);
  return { ok: true, withdrawn_at: new Date(toMs(d.withdrawn_at)).toISOString(), repeated: !!d.repeated };
}

export type ResolveResult = { ok: true; outcome: AskerOutcome; repeated: boolean } | { ok: false; reason: 'not_found' | 'not_answered' | 'not_configured' | 'db_down' };

/**
 * After a member's 2-line answer, “Did that solve it?”: `solved` closes the ask; otherwise it goes to the next person
 * in line (or closes when nobody is left). Only once the answer is visible to the asker. Idempotent.
 */
export async function resolveAsk(askId: string, user: MemberRef, solved: boolean, now: Date = new Date()): Promise<ResolveResult> {
  if (!networkConfigured()) return { ok: false, reason: 'not_configured' };
  if (!isRealAskId(String(askId ?? ''))) return { ok: false, reason: 'not_found' };
  const res = await rpc<{ ok: boolean; reason?: 'not_found' | 'not_answered'; repeated?: boolean; advance?: AdvanceResult; promoted?: string | null }>('net_resolve_ask', {
    p_ask: askId,
    p_asker: user.id,
    p_solved: !!solved,
    p_now: now.toISOString(),
    p_slots: mintSlots(6),
  });
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  const d = res.data;
  if (!d?.ok) return { ok: false, reason: d?.reason === 'not_answered' ? 'not_answered' : 'not_found' };
  if (d.advance) await afterAdvance(await completeAdvance(askId, d.advance, now), now);
  if (d.promoted) await sendPromoted(d.promoted);
  const view = await getAskerView(askId, user, now);
  return { ok: true, outcome: view.ok ? view.view.outcome : solved ? 'closed' : 'offered', repeated: !!d.repeated };
}
