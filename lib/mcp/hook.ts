import 'server-only';
import { HOUR_MS, toMs } from '@/lib/oti/time';
import { HOOK_MAX_LINES, type HookInput, hookContext, hookLines } from '@/lib/receipts';
import { verifyApiToken } from '@/lib/server/api-tokens';
import { listPendingForMember } from '@/lib/server/offers';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * The SessionStart hook's payload (GET /api/hook, called by the plugin's hooks/pending.sh with `curl --max-time 2`):
 * at most 3 lines when something waits on the member, nothing otherwise. Each item shows at most twice: when it
 * arrives, and once more when under 24 h remain (offers). `public.hook_seen` remembers what was shown. Any failure,
 * a missing token or a slow answer means silence (the hook prints nothing).
 */

export interface HookPayload {
  systemMessage: string;
  hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string };
}

/** The server's share of the hook's 2-second budget. */
export const HOOK_BUDGET_MS = 1_500;

type SeenRow = { item: string; shown: number; last_shown_at: string | null };

/** What `hook_seen` says about these items; null when it can't be read (then everything counts as new). */
async function readSeen(memberId: string, items: string[]): Promise<Map<string, SeenRow> | null> {
  const admin = getAdminClient();
  if (!admin.ok || !items.length) return new Map();
  try {
    const { data, error } = await admin.client
      .from('hook_seen')
      .select('item, shown, last_shown_at')
      .eq('member_id', memberId)
      .in('item', items)
      .abortSignal(AbortSignal.timeout(600));
    if (error) return null;
    return new Map((data ?? []).map((r) => [r.item, r as SeenRow]));
  } catch {
    return null;
  }
}

async function markSeen(memberId: string, rows: { item: string; shown: number }[], now: Date): Promise<void> {
  const admin = getAdminClient();
  if (!admin.ok || !rows.length) return;
  try {
    await admin.client
      .from('hook_seen')
      .upsert(rows.map((r) => ({ member_id: memberId, item: r.item, shown: Math.min(2, r.shown), last_shown_at: now.toISOString() })))
      .abortSignal(AbortSignal.timeout(600));
  } catch {
    // Best effort: an item may show once more than intended, never less.
  }
}

/** Shown before? Then only once more, when under 24 h remain and the last showing came before that window. */
export function dueToShow(seen: SeenRow | undefined, deadline: number | null, now: number): boolean {
  const shown = seen?.shown ?? 0;
  if (shown <= 0) return true;
  if (shown >= 2 || deadline === null) return false;
  const windowStart = deadline - 24 * HOUR_MS;
  const last = seen?.last_shown_at ? toMs(seen.last_shown_at) : 0;
  return now >= windowStart && now < deadline && last < windowStart;
}

async function build(authorization: string | null, now: Date): Promise<HookPayload | null> {
  const member = await verifyApiToken(authorization, 'hook');
  if (!member) return null;
  const res = await listPendingForMember(member.id, now);
  if (!res.ok) return null;
  const p = res.pending;
  const keyed = [
    ...p.offers.map((o) => ({ key: `offer:${o.offer_id}`, deadline: toMs(o.expires_at) as number | null, kind: 'offer' as const, o })),
    ...p.questions.map((q) => ({ key: `question:${q.question_id}`, deadline: null, kind: 'question' as const, q })),
    ...p.checkins.map((c) => ({ key: `checkin:${c.checkin_id}`, deadline: null, kind: 'checkin' as const, c })),
  ];
  if (!keyed.length) return null;
  const seen = await readSeen(
    member.id,
    keyed.map((k) => k.key),
  );
  const t = now.getTime();
  const due = keyed.filter((k) => dueToShow(seen?.get(k.key), k.deadline, t));
  if (!due.length) return null;
  const input: HookInput = {
    offers: due.flatMap((d) => (d.kind === 'offer' ? [{ offer_id: d.o.offer_id, expires_at: d.o.expires_at }] : [])),
    questions: due.flatMap((d) => (d.kind === 'question' ? [{ question_id: d.q.question_id, ask_id: d.q.ask_id, type: d.q.type }] : [])),
    checkins: due.flatMap((d) => (d.kind === 'checkin' ? [{ checkin_id: d.c.checkin_id, kind: d.c.kind, other_name: d.c.other_name }] : [])),
    cap: { cap: p.cap.cap, used: p.cap.used },
    now: t,
  };
  const lines = hookLines(input).slice(0, HOOK_MAX_LINES);
  if (!lines.length) return null;
  if (seen) await markSeen(member.id, due.map((d) => ({ item: d.key, shown: (seen.get(d.key)?.shown ?? 0) + 1 })), now);
  return { systemMessage: lines.join('\n'), hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: hookContext(input) } };
}

/** The payload, or null for silence (no token, nothing new, any error, or slower than HOOK_BUDGET_MS). */
export async function hookPayload(authorization: string | null, now: Date = new Date(), budgetMs: number = HOOK_BUDGET_MS): Promise<HookPayload | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    return await Promise.race([build(authorization, now).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
