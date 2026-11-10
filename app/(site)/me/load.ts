import 'server-only';
import { timeLabelText } from '@/components/member/copy';
import type { MeAsks, MeInitial, MeLedger, MeToken, TimeLabel } from '@/components/member/me-types';
import { ruleLines } from '@/lib/oti/clause';
import { capMonth, fmtClock, fmtDay, hoursLeft, NETWORK_TZ } from '@/lib/oti/time';
import { listMyAsks } from '@/lib/server/asks';
import { getApiTokenStatus } from '@/lib/server/api-tokens';
import { getCapUsed, getMemberProfile, getMonthLedger, getRulesSource, type MemberLedger } from '@/lib/server/member';
import { listPendingForMember } from '@/lib/server/offers';
import { ROUTES } from '@/lib/site';
import type { MemberRef } from '@/lib/types';

/**
 * Everything /me shows for a signed-in member, read server-side (owner: S3). Times are labelled in Pacific time for
 * the server render; the client re-labels them in the viewer's zone after hydration (TimeLabel.iso).
 * Member data failing → the page's “Something broke on our side” state. BE2 data (the pending offer, “Your asks”)
 * failing → those parts degrade on their own.
 */

function day(iso: string): TimeLabel {
  return { iso, label: fmtDay(Date.parse(iso), NETWORK_TZ), fmt: 'day' };
}
function clock(iso: string): TimeLabel {
  return { iso, label: fmtClock(Date.parse(iso), NETWORK_TZ), fmt: 'clock' };
}
function last(iso: string, nowMs: number): TimeLabel {
  return { iso, label: timeLabelText('last', Date.parse(iso), nowMs, NETWORK_TZ), fmt: 'last' };
}

function toMeLedger(rules: string, l: MemberLedger): MeLedger {
  const { month: _month, tallies, ranges, ...counts } = l;
  const quotes = [...new Set(ranges.map((r) => rules.slice(r.start, r.end)))];
  return { ...counts, lines: tallies ? ruleLines(rules).map((line) => ({ text: line.text.trim(), tally: tallies[line.index] ?? 'not used this month' })) : null, quotes };
}

export type MeLoad = { ok: true; initial: MeInitial } | { ok: false; reason: 'not_configured' | 'db_down' };

export async function loadMe(user: MemberRef, now: Date, flags: { first: boolean; carried: boolean }): Promise<MeLoad> {
  const prof = await getMemberProfile(user.id);
  if (!prof.ok) return prof;
  const m = prof.member;
  const nowMs = now.getTime();
  const pendingGate = !m || m.status === 'pending';

  const [source, used, ledger, token, pending, asks] = await Promise.all([
    m && m.rules_version ? getRulesSource(user.id, m.rules_version) : Promise.resolve(null),
    m ? getCapUsed(user.id, now) : Promise.resolve({ ok: true as const, used: 0, month: capMonth(now) }),
    m && !pendingGate && m.rules ? getMonthLedger(user.id, m.rules, now) : Promise.resolve(null),
    getApiTokenStatus(user.id),
    m && !pendingGate ? listPendingForMember(user.id, now) : Promise.resolve(null),
    m ? listMyAsks(user) : Promise.resolve({ ok: true as const, items: [] }),
  ]);

  if (!used.ok) return { ok: false, reason: used.reason === 'not_configured' ? 'not_configured' : 'db_down' };
  if (ledger && !ledger.ok) return { ok: false, reason: 'db_down' };
  if (!token.ok && token.reason === 'db_down') return { ok: false, reason: 'db_down' };

  let tokenState: MeToken = { state: 'off' };
  if (token.ok) {
    const s = token.status;
    tokenState =
      s.state === 'active'
        ? { state: 'active', created: day(s.created_at), lastUsed: s.last_used_at ? last(s.last_used_at, nowMs) : null }
        : s.state === 'revoked'
          ? { state: 'revoked' }
          : { state: 'none' };
  }

  const offer = pending && pending.ok ? pending.pending.offers[0] : undefined;

  let asksState: MeAsks;
  if (asks.ok) {
    asksState = {
      state: 'ok',
      example: false,
      items: asks.items.map((a) => ({ id: a.id, subject: a.subject, outcome: a.outcome, created: day(a.created_at), href: ROUTES.askStatus(a.id) })),
    };
  } else asksState = asks.reason === 'db_down' ? { state: 'down' } : { state: 'off' };

  const rulesSavedAt = m?.rules_saved_at ?? null;
  const initial: MeInitial = {
    mode: 'real',
    qaState: null,
    now: nowMs,
    status: m?.status ?? 'pending',
    pausedUntil: m?.paused_until ?? null,
    profile: {
      name: m?.name ?? '',
      one_line: m?.one_line ?? '',
      company: m?.company ?? '',
      stage: m?.stage ?? '',
      city: m?.city ?? '',
      scheduling_url: m?.scheduling_url ?? '',
      cap: m?.cap ?? 2,
      show_matched: m?.show_matched ?? false,
    },
    rules: m?.rules ?? '',
    rulesVersion: m?.rules_version ?? 0,
    saved: rulesSavedAt ? clock(rulesSavedAt) : null,
    rulesSourceLabel: source === 'playground' ? 'From the playground' : null,
    capUsed: used.used,
    month: used.month,
    ledger: ledger && ledger.ok ? toMeLedger(m?.rules ?? '', ledger.ledger) : null,
    pending: offer
      ? { title: offer.title, from: offer.asker.name, hoursLeft: hoursLeft(Date.parse(offer.expires_at), nowMs), href: ROUTES.offer(offer.offer_id) }
      : null,
    asks: asksState,
    token: tokenState,
    first: flags.first,
    carried: flags.carried,
    exportHref: '/me/export',
  };
  return { ok: true, initial };
}
