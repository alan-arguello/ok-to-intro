import { describe, expect, it, vi } from 'vitest';
import { findClause } from '@/lib/oti/clause';
import { BANNED_COPY } from '@/lib/oti/text';
import { presetById } from '@/lib/sample/presets';
import { recordedRunFor } from '@/components/playground/engine';
import {
  ASK_IDS,
  chainText,
  checkGate,
  computeDisplays,
  countDisplays,
  latencyText,
  normalizeLiveGate,
  OUTCOME_LABEL,
  outcomeOf,
  QUOTE_NOT_IN_RULES,
  sortOrder,
  summaryLine,
  whyText,
  type RowGate,
  type Run,
} from '@/components/playground/model';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

const ENGINEER = presetById('engineer').rules;
const run = () => recordedRunFor('engineer', ENGINEER, Date.parse('2026-11-09T18:00:00Z'));

function liveCopy(r: Run): Run {
  const out: Run = { ...r, mode: 'live', source: 'live', gates: {}, errors: {}, wall_ms: 2300, cost_usd: 0.0019 };
  for (const [id, g] of Object.entries(r.gates)) out.gates[id as keyof Run['gates']] = { ...(g as RowGate), source: 'live', ms: 1290, confidence: 0.9 };
  return out;
}

describe('display verdicts (applyCap in the browser)', () => {
  it('Engineer example run: 2 reach you, 1 over your cap, 1 question first, 8 declined', () => {
    const { map, reachDays } = computeDisplays(run(), [], 2, false);
    const c = countDisplays(map);
    expect([c.reach, c.held, c.ask, c.declined, c.notChecked]).toEqual([2, 1, 1, 8, 0]);
    expect(map.a01.display).toBe('reach');
    expect(map.a01.pos).toBe(1);
    expect(map.a03.pos).toBe(2);
    expect(map.a09.display).toBe('held');
    expect(map.a06.display).toBe('ask');
    expect(reachDays).toEqual([2, 4]);
  });

  it('cap 1 moves Tallow AI over the cap with no model call', () => {
    const { map } = computeDisplays(run(), [], 1, false);
    expect(map.a03.display).toBe('held');
    expect(countDisplays(map).reach).toBe(1);
  });

  it('while streaming, an accept an earlier pending row could push over the cap stays CHECKING', () => {
    const r = run();
    delete r.gates.a01;
    const { map } = computeDisplays(r, ['a01'], 1, true);
    expect(map.a01.display).toBe('checking');
    expect(map.a03.display).toBe('checking');
  });

  it('errors: timeouts are NOT CHECKED, refused and parse are DECLINED BY CODE, never an accept', () => {
    const r = run();
    delete r.gates.a01;
    delete r.gates.a03;
    r.errors.a01 = { kind: 'timeout' };
    r.errors.a03 = { kind: 'refused' };
    const { map } = computeDisplays(r, [], 2, false);
    expect(map.a01.display).toBe('failed');
    expect(map.a03.display).toBe('code');
    expect(map.a09.display).toBe('reach');
    expect(outcomeOf(map.a01, ENGINEER)).toEqual({ kind: 'failed', label: OUTCOME_LABEL.failed, text: 'No answer in 6 s. A failed gate never counts as an accept.' });
    expect(outcomeOf(map.a03, ENGINEER)).toEqual({ kind: 'no', label: OUTCOME_LABEL.no, text: 'The model refused to evaluate this ask.', quotes: [] });
    expect(chainText(map.a01, 2)).toBe('model: no answer in 6 s → not checked, never an accept');
  });
});

describe('row copy: three plain outcomes, with the chain and latency for Details', () => {
  const r = run();
  const { map } = computeDisplays(r, [], 2, false);
  const first = (display: string) => {
    const id = ASK_IDS.find((x) => map[x].display === display);
    if (!id) throw new Error(`no ${display} row in the fixture`);
    return map[id];
  };

  it('reaches you: the label and the member’s own words at the offsets code found', () => {
    const d = first('reach');
    const o = outcomeOf(d, r.rules);
    expect(o).toMatchObject({ kind: 'reach', label: 'Reaches you' });
    const found = (d.gate?.cited ?? []).filter((c) => c.found);
    expect(o.kind === 'reach' ? o.quotes : []).toEqual(found.map((c) => r.rules.slice(c.start, c.end)));
    expect(found.length).toBeGreaterThan(0);
  });

  it('over the monthly limit: it matches, but says you’re at your limit', () => {
    expect(outcomeOf(first('held'), r.rules)).toMatchObject({ kind: 'limit', label: 'Matches, but you’re at your limit this month' });
  });

  it('a question first shows the question', () => {
    const d = first('ask');
    expect(outcomeOf(d, r.rules)).toEqual({ kind: 'question', label: 'They’d be asked a question first', text: d.gate?.question?.text });
    expect(d.gate?.question?.text).toBeTruthy();
  });

  it('not for you: one short reason (the quoted line, else the flag, else no line covers it)', () => {
    for (const id of ASK_IDS) {
      const d = map[id];
      if (d.display !== 'decline') continue;
      const o = outcomeOf(d, r.rules);
      expect(o).toMatchObject({ kind: 'no', label: 'Not for you' });
      if (o.kind !== 'no') continue;
      if (o.quotes.length) expect(o.text).toBeNull();
      else if (d.gate?.flags.includes('asker_not_founder')) expect(o.text).toBe('It reads as an investor asking for deal flow, not a founder asking for help.');
      else if (d.gate?.flags.includes('instruction_in_ask')) expect(o.text).toBe('The ask told the gate what to answer; it was read as text, not followed.');
      else expect(o.text).toBe('No line in your rules covers this ask.');
    }
  });

  it('before a run a row has no outcome; while checking it says so', () => {
    expect(outcomeOf(computeDisplays(null, [], 2, false).map.a01, '')).toEqual({ kind: 'idle' });
    const streaming = run();
    delete streaming.gates.a01;
    expect(outcomeOf(computeDisplays(streaming, ['a01'], 2, true).map.a01, r.rules)).toEqual({ kind: 'checking', label: 'Checking…' });
  });

  it('the summary sentence leaves out empty buckets, except what reaches you', () => {
    const c = countDisplays(map);
    expect(summaryLine(c)).toBe(`${c.reach} would reach you · ${c.held} over your limit · ${c.ask} question first · ${c.declined} filtered out`);
    expect(summaryLine({ ...c, reach: 0, held: 0, ask: 0, declined: 12 })).toBe('0 would reach you · 12 filtered out');
    expect(summaryLine({ ...c, reach: 3, held: 0, ask: 0, declined: 9 })).toBe('3 would reach you · 9 filtered out');
  });

  it('the chain says the limit is code, never Postgres, and hand-written rows never say “model” or show a latency', () => {
    expect(chainText(first('reach'), 2)).toMatch(/^example accept → code \d of \d quotes? found → cap 1 of 2$/);
    expect(chainText(first('held'), 2)).toMatch(/→ cap full, 2 of 2 used$/);
    expect(chainText(first('ask'), 2)).toMatch(/→ one question to the founder$/);
    for (const id of ASK_IDS) {
      expect(chainText(map[id], 2)).not.toMatch(/model|Postgres/);
      expect(latencyText(map[id])).toBeNull();
    }
  });

  it('model rows say model and show their latency; Why is the gate’s own sentence', () => {
    const lm = computeDisplays(liveCopy(r), [], 2, false).map;
    const id = ASK_IDS.find((x) => lm[x].display === 'reach') as (typeof ASK_IDS)[number];
    expect(chainText(lm[id], 2)).toMatch(/^model accept → code/);
    expect(latencyText(lm[id])).toBe('1.3 s · live');
    expect(whyText(lm[id])).toBe(lm[id].gate?.reason);
  });
});

describe('the clause check in the browser', () => {
  it('a quote not in the rules turns the verdict into a decline by code', () => {
    const r = run();
    const fake: RowGate = { ...(r.gates.a11 as RowGate), verdict: 'accept', model_verdict: 'accept', cited: [{ text: 'Happy to take any intro', found: false }] };
    const g = checkGate(fake, r.rules);
    expect(g.decided_by).toBe('clause_check');
    expect(g.verdict).toBe('decline');
    r.gates.a11 = g;
    const { map } = computeDisplays(r, [], 2, false);
    expect(map.a11.display).toBe('code');
    expect(outcomeOf(map.a11, r.rules)).toEqual({ kind: 'no', label: OUTCOME_LABEL.no, text: QUOTE_NOT_IN_RULES, quotes: [] });
    expect(chainText(map.a11, 2)).toBe('example accept → code 0 of 1 quote found → decline');
  });

  it('a live event that says found without usable offsets is checked again; a missing quote is never an accept', () => {
    const base: RowGate = {
      i: 0,
      ask_id: 'a01',
      verdict: 'accept',
      model_verdict: 'accept',
      cited: [{ text: 'founders about churn, activation or support load', found: true }],
      decided_by: 'gate',
      reason_code: 'match',
      reason: 'x',
      question: null,
      flags: [],
      confidence: 0.8,
      ms: 900,
      source: 'live',
    };
    const fixed = normalizeLiveGate(base, ENGINEER);
    const r = findClause(ENGINEER, 'founders about churn, activation or support load');
    expect(fixed.cited[0]).toMatchObject({ found: true, start: r?.start, end: r?.end });
    const lying = normalizeLiveGate({ ...base, cited: [{ text: 'not there', found: false }] }, ENGINEER);
    expect(lying.verdict).toBe('decline');
    expect(lying.decided_by).toBe('clause_check');
  });
});

describe('sort at done', () => {
  it('reaches you → question first → at your limit → not checked → not for you, each in arrival order', () => {
    const r = run();
    const { map } = computeDisplays(r, [], 2, false);
    const group = { reach: 0, ask: 1, held: 2, failed: 3, notrun: 3, checking: 3, decline: 4, code: 4 } as const;
    const order = sortOrder(map);
    expect([...order].sort()).toEqual([...ASK_IDS].sort());
    const ranks = order.map((id) => group[map[id].display]);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });
});

describe('copy rules', () => {
  it('no banned words in the playground copy', async () => {
    const copy = await import('@/components/playground/copy');
    const strings = Object.values(copy).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => unknown)(1, 1, true))] : []));
    for (const s of strings) for (const re of BANNED_COPY) expect(s).not.toMatch(re);
    for (const s of strings) expect(s).not.toMatch(/["']/);
  });
});
