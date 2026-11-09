import 'server-only';
import { checkinEmail, introEmail, outcomeNoteEmail } from '@/lib/emails';
import { askFacts } from '@/lib/oti/ask';
import { publicId } from '@/lib/oti/ids';
import { topicPhrase } from '@/lib/oti/rule-edits';
import { DAY_MS, fmtDay, fmtWeekday, NETWORK_TZ, toMs, zonedParts, zonedTimeToUtc } from '@/lib/oti/time';
import { absoluteUrl } from '@/lib/site';
import type { CheckinKind, CheckinRole, CitedQuote, CompiledAsk, D14Outcome } from '@/lib/types';
import { rpc } from './audit';
import { askerFooter, displayName, firstName, linkToken, linkTokenHash, memberFooter, sendEmail, type SendOutcome } from './email-send';

/**
 * Owner: BE2. Intros: after a member's OK, one email to both people (To: both, Reply-To: both; the service is not on
 * the thread), then the follow-through: +1 day to each person (did the call happen, useful 1–5) and +14 days to the
 * asker (unblocked · a customer · a hire · an investor · nothing yet). Check-in emails are scheduled at intro time
 * with Resend scheduled send; the daily cron sends any the scheduler never took.
 */

/** Check-ins land at 10:00 in Mexico City: the next day (d1) and two weeks after the intro (d14). */
const CHECKIN_HOUR = 10;
/** A check-in can be answered (and changed) for 30 days after the intro (tech.md: check-in tokens live 30 days). */
const CHECKIN_WINDOW_MS = 30 * DAY_MS;
/** “We haven't talked yet” → one reminder, 3 days later. */
export const REMINDER_DAYS = 3;

/** `days` local days after `at` in Mexico City, at `hour`:00 there. */
export function localDayAt(at: Date | number, days: number, hour: number): Date {
  const p = zonedParts(toMs(at), NETWORK_TZ);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return new Date(zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, 0, NETWORK_TZ));
}

export interface CheckinSeed {
  id: string;
  token_hash: string;
  role: CheckinRole;
  kind: CheckinKind;
  due_at: string;
  closes_at: string;
}

/**
 * The intro id and its three check-ins, minted before the OK is recorded so the whole intro commits in one
 * transaction (public.net_respond_offer). Null without TOKEN_HMAC_SECRET (check-in links can't be made).
 */
export function checkinPlan(now: Date): { intro_id: string; checkins: CheckinSeed[] } | null {
  const closes = new Date(now.getTime() + CHECKIN_WINDOW_MS).toISOString();
  const seeds: { role: CheckinRole; kind: CheckinKind; due: Date }[] = [
    { role: 'asker', kind: 'd1', due: localDayAt(now, 1, CHECKIN_HOUR) },
    { role: 'member', kind: 'd1', due: localDayAt(now, 1, CHECKIN_HOUR) },
    { role: 'asker', kind: 'd14', due: localDayAt(now, 14, CHECKIN_HOUR) },
  ];
  const checkins: CheckinSeed[] = [];
  for (const s of seeds) {
    const id = publicId('checkin', 12);
    const token_hash = linkTokenHash('checkin', id);
    if (!token_hash) return null;
    checkins.push({ id, token_hash, role: s.role, kind: s.kind, due_at: s.due.toISOString(), closes_at: closes });
  }
  return { intro_id: publicId('intro', 10), checkins };
}

/* ========================================================================== *
 * The intro email
 * ========================================================================== */

interface IntroRow {
  intro: { id: string; ask_id: string; offer_id: string; created_at: string; sent_at: string | null };
  ask: { id: string; subject: string; compiled: CompiledAsk };
  asker: { id: string; name: string; company: string; stage: string; city: string; email: string };
  member: { id: string; name: string; email: string; one_line: string; scheduling_url: string | null; show_matched: boolean };
  decision: { cited: CitedQuote[]; rules: string } | null;
  checkins: { id: string; role: CheckinRole; kind: CheckinKind; due_at: string }[];
}

function ownWordsOf(decision: IntroRow['decision']): string | null {
  const q = decision?.cited?.find((c) => c && c.found && typeof c.start === 'number' && typeof c.end === 'number');
  return decision && q && q.start !== undefined && q.end !== undefined ? decision.rules.slice(q.start, q.end) : null;
}

async function readIntro(introId: string): Promise<IntroRow | null> {
  const res = await rpc<IntroRow | null>('net_intro_view', { p_intro: introId });
  return res.ok && res.data && typeof res.data === 'object' && 'intro' in res.data ? res.data : null;
}

/**
 * The intro email to both people (key `intro:<id>`). The only email that carries the member's name. Returns what
 * happened to it (null when the intro can't be read), so the OK can say “We emailed you both” only when it's true.
 */
export async function deliverIntroEmail(introId: string, now: Date = new Date()): Promise<SendOutcome | null> {
  const row = await readIntro(introId);
  if (!row) return null;
  const c = row.ask.compiled;
  const d1 = row.checkins.find((x) => x.kind === 'd1');
  const d14 = row.checkins.find((x) => x.kind === 'd14');
  const message = introEmail({
    member_context: topicPhrase(c?.topic ?? null),
    member: {
      name: displayName(row.member.name, row.member.email),
      first: firstName(row.member.name, row.member.email),
      one_line: row.member.one_line,
      scheduling_url: row.member.scheduling_url,
      email: row.member.email,
    },
    asker: {
      name: displayName(row.asker.name, row.asker.email),
      first: firstName(row.asker.name, row.asker.email),
      company: row.asker.company,
      stage: row.asker.stage,
      city: row.asker.city,
      email: row.asker.email,
    },
    facts: askFacts(c.parts, typeof c.price === 'string' && c.price.trim() ? c.price.trim() : null),
    matched_line: row.member.show_matched ? ownWordsOf(row.decision) : null,
    checkin_d1_label: fmtWeekday(toMs(d1?.due_at ?? localDayAt(now, 1, CHECKIN_HOUR).toISOString()), NETWORK_TZ),
    checkin_d14_label: fmtWeekday(toMs(d14?.due_at ?? localDayAt(now, 14, CHECKIN_HOUR).toISOString()), NETWORK_TZ),
    member_footer: await memberFooter(row.member.id),
  });
  const both = [row.asker.email, row.member.email];
  return sendEmail({ key: `intro:${row.intro.id}`, kind: 'intro', member_id: row.member.id, to: both, reply_to: both, message, intro_id: row.intro.id }, now);
}

/** Schedules the intro's check-in emails (Resend scheduled send at each due time). */
export async function scheduleIntroCheckins(introId: string, now: Date = new Date()): Promise<void> {
  const row = await readIntro(introId);
  if (!row) return;
  for (const c of row.checkins) await deliverCheckinEmail(c.id, now);
}

/* ========================================================================== *
 * Check-in emails
 * ========================================================================== */

export interface CheckinRow {
  checkin: {
    id: string;
    intro_id: string;
    member_id: string;
    role: CheckinRole;
    kind: CheckinKind;
    due_at: string;
    sent_at: string | null;
    answer: Record<string, unknown> | null;
    answered_at: string | null;
    reminder_at: string | null;
    closes_at: string;
  };
  intro: { id: string; ask_id: string; created_at: string };
  ask: { id: string; subject: string };
  to: { id: string; name: string; email: string };
  other: { id: string; name: string };
}

export async function readCheckin(args: { p_token_hash: string | null; p_checkin_id: string | null; p_member: string | null }): Promise<
  { ok: true; row: CheckinRow | null } | { ok: false; reason: 'not_configured' | 'db_down' }
> {
  const res = await rpc<CheckinRow | null>('net_checkin_view', args);
  if (!res.ok) return { ok: false, reason: res.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  return { ok: true, row: res.data && typeof res.data === 'object' && 'checkin' in res.data ? res.data : null };
}

/** Idempotency key of a check-in email: `checkin1:<id>` / `checkin14:<id>`, plus `:reminder` for the one d1 reminder. */
export function checkinKey(kind: CheckinKind, id: string, reminder = false): string {
  return `${kind === 'd1' ? 'checkin1' : 'checkin14'}:${id}${reminder ? ':reminder' : ''}`;
}

/**
 * One check-in email: scheduled at its due time (or the reminder time), sent now when that has passed. Not sent once
 * answered (except the reminder, which exists because the answer was “not yet”) or after the window closed.
 */
export async function deliverCheckinEmail(checkinId: string, now: Date = new Date(), options: { reminder?: boolean } = {}): Promise<void> {
  const read = await readCheckin({ p_token_hash: null, p_checkin_id: checkinId, p_member: null });
  if (!read.ok || !read.row) return;
  const { checkin: c, ask, to, other } = read.row;
  if (toMs(c.closes_at) <= now.getTime()) return;
  if (options.reminder) {
    if (!c.reminder_at || c.answer?.not_yet !== true) return;
  } else if (c.answer) return;
  const token = linkToken('checkin', c.id);
  if (!token) return;
  const message = checkinEmail({
    kind: c.kind,
    role: c.role,
    to_first: firstName(to.name, to.email),
    other_name: displayName(other.name),
    other_first: firstName(other.name),
    checkin_url: absoluteUrl(`/c/${token}`),
    footer: c.role === 'member' ? await memberFooter(to.id) : askerFooter(ask.id),
  });
  const sendAt = new Date(toMs(options.reminder ? (c.reminder_at as string) : c.due_at));
  await sendEmail(
    { key: checkinKey(c.kind, c.id, !!options.reminder), kind: 'checkin', member_id: to.id, to: [to.email], message, send_at: sendAt, checkin_id: options.reminder ? undefined : c.id },
    now,
  );
}

/* ========================================================================== *
 * Outcome note (Should): the asker reported something useful at +14 days
 * ========================================================================== */

/** To the member, once per intro (key `outcome:<intro_id>`): “Lucía reported a customer from your intro (Nov 23).” */
export async function deliverOutcomeNote(introId: string, outcome: Exclude<D14Outcome, 'nothing_yet'>, now: Date = new Date()): Promise<void> {
  const row = await readIntro(introId);
  if (!row) return;
  const message = outcomeNoteEmail({
    member_first: firstName(row.member.name, row.member.email),
    asker_first: firstName(row.asker.name, row.asker.email),
    outcome,
    reported_on: fmtDay(now.getTime(), NETWORK_TZ),
    footer: await memberFooter(row.member.id),
  });
  await sendEmail({ key: `outcome:${row.intro.id}`, kind: 'outcome_note', member_id: row.member.id, to: [row.member.email], message }, now);
}
