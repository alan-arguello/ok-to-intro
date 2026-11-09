import 'server-only';
import { rpc, networkConfigured, runInline } from './audit';
import { emailConfigured } from './email-send';
import { warmGate } from './gate';
import { deliverCheckinEmail, deliverIntroEmail, scheduleIntroCheckins } from './intros';
import { deliverOfferEmail, deliverWithdrawnEmail, tickDue } from './offers';

/**
 * Owner: BE2. The daily backstop (Vercel Hobby runs crons once a day, ±59 min). Everything here also happens on its
 * own when someone reads or acts; the cron catches what nobody looked at:
 * - time on every ask: offers past 72 hours expire and move on, deadlines close asks, answered asks with no choice
 *   close (public.net_tick_ask through tickDue);
 * - sends that never finished (the function died) or never started (a promoted queued ask, a tab closed between
 *   create and send);
 * - reruns that never recorded after an answer (they count as not checked);
 * - intro emails that didn't go out (an intro counts as made only once they do), then their check-ins;
 * - emails that failed or waited (retried from the outbox, rebuilt from the database, same idempotency key);
 * - check-in emails the scheduler never took, and the one d1 reminder;
 * - housekeeping (expired MCP drafts, rate-limit windows older than a day);
 * - one real gate call so the structured-output grammar never sits 24 hours unused (BE1 warmGate).
 * Idempotent: running it twice does nothing new the second time. Every job runs in place (`runInline`), so the
 * report says what was done, and it stops starting new work after ~50 s.
 */

const BUDGET_MS = 50_000;

export interface DailyReport {
  ok: boolean;
  network: 'configured' | 'not_configured';
  ticked: number;
  resumed: number;
  sent: number;
  reruns: number;
  intros: number;
  checkins: number;
  reminders: number;
  emails_retried: number;
  cleanup: { drafts: number; rate_limits: number } | null;
  warm: { ok: boolean; ms: number; kind?: string };
  stopped_early: boolean;
}

export function runDaily(now: Date = new Date()): Promise<DailyReport> {
  return runInline(() => daily(now));
}

async function daily(now: Date): Promise<DailyReport> {
  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);
  const report: DailyReport = {
    ok: true,
    network: networkConfigured() ? 'configured' : 'not_configured',
    ticked: 0,
    resumed: 0,
    sent: 0,
    reruns: 0,
    intros: 0,
    checkins: 0,
    reminders: 0,
    emails_retried: 0,
    cleanup: null,
    warm: { ok: false, ms: 0 },
    stopped_early: false,
  };

  // The grammar warm-up runs first and alone: it is one call, and it matters even on an instance without a database.
  try {
    report.warm = await warmGate();
  } catch {
    report.warm = { ok: false, ms: 0, kind: 'unavailable' };
  }
  if (report.network === 'not_configured') {
    // Without the whole network there is nothing to move, but stale drafts and rate-limit windows still go.
    const cleanup = await rpc<{ drafts: number; rate_limits: number }>('net_cleanup', { p_now: now.toISOString() });
    report.cleanup = cleanup.ok ? cleanup.data : null;
    return report;
  }

  // 1. Time on every ask.
  report.ticked = await tickDue({}, now, 500);

  // 2. Sends that never finished or never started, reruns that never recorded, intros whose email didn't go out.
  const unsent = await rpc<{ gating: { id: string }[]; ready: { id: string }[]; reruns: { ask_id: string; question_id: string }[]; intros: string[] }>(
    'net_unsent_asks',
    { p_now: now.toISOString(), p_limit: 20 },
  );
  if (unsent.ok && unsent.data) {
    const { resumeSend, sendInBackground } = await import('./dispatch');
    for (const a of unsent.data.gating ?? []) {
      if (left() < 15_000) break;
      if ((await resumeSend(a.id)) === 'resumed') report.resumed += 1;
    }
    for (const a of unsent.data.ready ?? []) {
      if (left() < 15_000) break;
      if ((await sendInBackground(a.id)) === 'sent') report.sent += 1;
    }
    for (const r of unsent.data.reruns ?? []) {
      // A rerun that never recorded counts as not checked (never an accept), and the ask moves on.
      const done = await rpc<{ settled: number }>('net_fail_missing_reruns', { p_ask: r.ask_id, p_question: r.question_id, p_now: now.toISOString() });
      if (done.ok) report.reruns += Number(done.data?.settled) || 0;
    }
    if (report.reruns) report.ticked += await tickDue({}, now, 100);
    for (const id of unsent.data.intros ?? []) {
      if (left() < 5_000) break;
      const res = await deliverIntroEmail(id, now);
      if (res && (res.status === 'sent' || res.status === 'scheduled')) {
        report.intros += 1;
        await scheduleIntroCheckins(id, now);
      }
    }
  }

  // 3. Emails that failed or waited: rebuilt from the database (only while still relevant), same key. Intros are
  //    step 2's (they also schedule their check-ins).
  if (emailConfigured() && left() > 5_000) {
    const due = await rpc<{ key: string; kind: string; attempts: number }[]>('net_outbox_due', { p_now: now.toISOString(), p_limit: 50 });
    for (const row of due.ok && Array.isArray(due.data) ? due.data : []) {
      if (left() < 5_000) break;
      const [kind, id, extra] = row.key.split(':');
      if (!id) continue;
      if (kind === 'offer') await deliverOfferEmail(id, now);
      else if (kind === 'withdrawn') await deliverWithdrawnEmail(id, now);
      else if (kind === 'checkin1' || kind === 'checkin14') await deliverCheckinEmail(id, now, { reminder: extra === 'reminder' });
      else continue;
      report.emails_retried += 1;
    }
  }

  // 4. Check-in emails the scheduler never took, and reminders that are due.
  if (emailConfigured() && left() > 5_000) {
    const due = await rpc<{ due: string[]; reminders: string[] }>('net_checkins_due', { p_now: now.toISOString(), p_limit: 50 });
    if (due.ok && due.data) {
      for (const id of due.data.due ?? []) {
        if (left() < 5_000) break;
        await deliverCheckinEmail(id, now);
        report.checkins += 1;
      }
      for (const id of due.data.reminders ?? []) {
        if (left() < 5_000) break;
        await deliverCheckinEmail(id, now, { reminder: true });
        report.reminders += 1;
      }
    }
  }

  // 5. Housekeeping.
  const cleanup = await rpc<{ drafts: number; rate_limits: number }>('net_cleanup', { p_now: now.toISOString() });
  report.cleanup = cleanup.ok ? cleanup.data : null;
  report.stopped_early = left() < 5_000;
  report.ok = true;
  return report;
}

/** The second daily cron: one warm gate call (twelve hours after the daily one). */
export async function runWarm(): Promise<{ ok: boolean; ms: number; kind?: string }> {
  try {
    return await warmGate();
  } catch {
    return { ok: false, ms: 0, kind: 'unavailable' };
  }
}
