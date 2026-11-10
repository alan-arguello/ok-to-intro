/**
 * The /me SAMPLE preview for QA states only (`?state=…` with QA enabled): the sample member Priya Shah with the
 * Sales operator rules and the prototype's example numbers (lib/sample/examples.ts EXAMPLE_ME), always under the
 * dashed “Prototype: example numbers for layout…” note. Never rendered without an explicit QA state
 * (docs/CONTRACT.md §e.4). Pure.
 */

import { findClause, ruleLines } from '@/lib/oti/clause';
import { capMonth, nextMonthStart } from '@/lib/oti/time';
import type { QaState } from '@/lib/qa';
import { EXAMPLE_ME } from '@/lib/sample/examples';
import { presetById } from '@/lib/sample/presets';
import { AUTHORED_VERDICTS } from '@/lib/sample/verdicts';
import { SAMPLE_TOKEN } from './copy';
import type { MeInitial, MeLedger } from './me-types';

export { SAMPLE_TOKEN };

function sampleLedger(rules: string, empty: boolean): MeLedger {
  const tallies = empty ? ['not used this month', '2 kept out', 'not used this month', '1 kept out'] : [...EXAMPLE_ME.lineTallies];
  const lines = ruleLines(rules);
  const seen = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  for (const v of AUTHORED_VERDICTS[EXAMPLE_ME.presetRules]) {
    for (const quote of v.cited) {
      const r = findClause(rules, quote);
      if (!r || seen.has(`${r.start}:${r.end}`)) continue;
      const line = lines.find((l) => r.start >= l.start && r.start < l.end);
      if (line && /^not used/.test(tallies[line.index] ?? '')) continue;
      seen.add(`${r.start}:${r.end}`);
      ranges.push({ start: r.start, end: r.end });
    }
  }
  const quotes = ranges.map((r) => rules.slice(r.start, r.end));
  const example = quotes.find((t) => t.length > 24) ?? null;
  const lineTallies = lines.map((l) => ({ text: l.text.trim(), tally: tallies[l.index] ?? 'not used this month' }));
  return empty
    ? { reached_gate: 6, reached_you: 0, declined: 6, failed: 0, no_line: 3, old_lines: 0, lines: lineTallies, quotes, example }
    : {
        reached_gate: EXAMPLE_ME.ledger.reached_gate,
        reached_you: EXAMPLE_ME.ledger.reached_you,
        declined: EXAMPLE_ME.ledger.stopped - 1,
        failed: 0,
        no_line: EXAMPLE_ME.noLine,
        old_lines: 0,
        lines: lineTallies,
        quotes,
        example,
      };
}

export function sampleMe(state: QaState<'me'>, nowMs: number): MeInitial {
  const me = EXAMPLE_ME;
  const rules = presetById(me.presetRules).rules;
  const first = state === 'first';
  const month = capMonth(nowMs);
  const used = state === 'empty-ledger' || first ? 0 : me.used;
  return {
    mode: 'sample',
    qaState: state,
    now: nowMs,
    status: first ? 'pending' : state === 'paused' ? 'paused' : 'on',
    pausedUntil: state === 'paused' ? nextMonthStart(month).toISOString() : null,
    profile: first
      ? { name: '', one_line: '', company: '', stage: '', city: '', scheduling_url: '', cap: me.cap, show_matched: false }
      : { name: me.name, one_line: me.oneLine, company: 'Oakline Health', stage: 'Seed', city: 'Chicago', scheduling_url: me.scheduling, cap: me.cap, show_matched: me.showMatched },
    rules,
    rulesVersion: first ? 0 : state === 'saved' ? me.version + 1 : me.version,
    saved: first ? null : { iso: null, label: state === 'saved' ? '21:16' : me.saved, fmt: 'clock' },
    rulesSourceLabel: first ? 'Sales operator preset' : null,
    capUsed: used,
    month,
    ledger: first ? null : sampleLedger(rules, state === 'empty-ledger'),
    pending: state === 'offer-pending' ? { title: me.pending.title, from: me.pending.from, hoursLeft: me.pending.hours_left, href: '/o/sample' } : null,
    asks: first
      ? { state: 'ok', items: [], example: true }
      : {
          state: 'ok',
          example: true,
          items: [
            { id: 'sa_health', subject: 'Intro to a hospital procurement lead', outcome: 'offered', created: { iso: null, label: 'Nov 9', fmt: 'day' }, href: '/ask/sa_health' },
            { id: 'sa_founder', subject: 'First SOC 2 in 60 days', outcome: 'question', created: { iso: null, label: 'Nov 8', fmt: 'day' }, href: '/ask/sa_founder' },
            { id: 'sa_eng', subject: 'Churn after month 3', outcome: 'intro', created: { iso: null, label: 'Nov 8', fmt: 'day' }, href: '/ask/sa_eng' },
          ],
        },
    token: first
      ? { state: 'none' }
      : state === 'token-created'
        ? { state: 'new', token: SAMPLE_TOKEN, created: { iso: null, label: 'Nov 9', fmt: 'day' } }
        : state === 'token-revoked'
          ? { state: 'revoked' }
          : { state: 'active', created: { iso: null, label: 'Nov 9', fmt: 'day' }, lastUsed: { iso: null, label: '21:04', fmt: 'last' } },
    first,
    carried: false,
    exportHref: null,
  };
}
