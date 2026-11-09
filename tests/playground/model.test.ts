import { describe, expect, it, vi } from 'vitest';
import { findClause } from '@/lib/oti/clause';
import { BANNED_COPY } from '@/lib/oti/text';
import { presetById } from '@/lib/sample/presets';
import { recordedRunFor } from '@/components/playground/engine';
import {
  addedOneLine,
  arrivedText,
  askOf,
  asideText,
  bodySegments,
  chainText,
  checkGate,
  computeDisplays,
  countDisplays,
  decidedByText,
  dividers,
  footModel,
  gateOutput,
  latencyText,
  normalizeLiveGate,
  quoteCheck,
  quoteLine,
  readView,
  runDiff,
  snapshotOf,
  sortOrder,
  traceRows,
  whyText,
  type RowGate,
  type Run,
} from '@/components/playground/model';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

const ENGINEER = presetById('engineer').rules;
const run = () => recordedRunFor('engineer', ENGINEER, Date.parse('2026-11-09T16:00:00Z'));

function liveCopy(r: Run): Run {
  const out: Run = { ...r, mode: 'live', source: 'live', gates: {}, errors: {}, events: [], wall_ms: 2300, cost_usd: 0.0019 };
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

  it('cap 1 moves Lumbre AI over the cap with no model call', () => {
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
    expect(footModel(map.a01, { rules: ENGINEER, cap: 2, reachDays: [] })).toEqual({ kind: 'note', text: 'No answer in 6 s. A failed gate never counts as an accept.' });
    expect(footModel(map.a03, { rules: ENGINEER, cap: 2, reachDays: [] })).toEqual({ kind: 'note', text: 'The model refused to evaluate this ask.' });
    expect(chainText(map.a01, 2)).toBe('model: no answer in 6 s → not checked, never an accept');
  });
});

describe('row copy (ux-spec S1 “Exact row copy by verdict”)', () => {
  const r = run();
  const { map, reachDays } = computeDisplays(r, [], 2, false);
  const ctx = { rules: r.rules, cap: 2, reachDays };

  it('cited words are the member’s own text at the offsets code found', () => {
    const foot = footModel(map.a01, ctx);
    expect(foot).toEqual({ kind: 'cites', quotes: ['founders about Postgres, queues or LLM evals in production', 'a real workload: a table size, a p95 or an error rate'], notes: [] });
    for (const c of map.a01.gate?.cited ?? []) expect(r.rules.slice(c.start, c.end)).toBe(c.text);
  });

  it('over your cap names the days the cap was used', () => {
    expect(footModel(map.a09, ctx)).toMatchObject({ kind: 'cites', notes: ['Accepted, but your cap of 2 was used on day 2 and day 4.'] });
  });

  it('question first quotes the question', () => {
    expect(footModel(map.a06, ctx)).toEqual({
      kind: 'note',
      text: 'Question first: “How many jobs a day do you run, and what share gets dropped?” Your gate reruns once on the founder’s answer.',
    });
  });

  it('declines: a cited line, no line, and the trap flags', () => {
    expect(footModel(map.a12, ctx)).toEqual({ kind: 'cites', quotes: ['No asks to review a deck.'], notes: [] });
    expect(footModel(map.a02, ctx)).toEqual({ kind: 'note', text: 'No line in your rules covers this ask.' });
    expect(footModel(map.a10, ctx)).toEqual({ kind: 'note', text: 'No line in your rules covers this ask. It reads as an investor asking for deal flow, not a founder asking for help.' });
    expect(footModel(map.a11, ctx)).toEqual({ kind: 'note', text: 'No line in your rules covers this ask. The ask told the gate what to answer; it was read as text, not followed.' });
  });

  it('the decided-by chain says “(code)” for the cap, never Postgres, and hand-written rows never say “model”', () => {
    expect(chainText(map.a01, 2)).toBe('example accept → code 2 of 2 quotes found → cap 1 of 2');
    expect(chainText(map.a09, 2)).toBe('example accept → code 2 of 2 quotes found → cap full, 2 of 2 used');
    expect(chainText(map.a06, 2)).toBe('example ask_back → code 1 of 1 quote found → one question to the founder');
    expect(chainText(map.a10, 2)).toBe('example decline → code: no quote to check · flag asker_not_founder');
    expect(decidedByText(map.a01, 2)).toBe(
      'Example verdict (written by hand) → clause check passed, 2 of 2 quotes found (code) → cap 1 of 2 (code; Postgres enforces the same rule on real offers)',
    );
    expect(decidedByText(map.a09, 2)).toBe('Example verdict (written by hand) → clause check passed, 2 of 2 quotes found (code) → cap (code)');
    for (const id of Object.keys(map) as (keyof typeof map)[]) {
      expect(chainText(map[id], 2)).not.toMatch(/model|Postgres/);
      expect(latencyText(map[id])).toBeNull();
      expect(asideText(map[id])).toBe('');
    }
  });

  it('model rows say model and show their latency', () => {
    const live = liveCopy(r);
    const lm = computeDisplays(live, [], 2, false).map;
    expect(chainText(lm.a01, 2)).toBe('model accept → code 2 of 2 quotes found → cap 1 of 2');
    expect(decidedByText(lm.a01, 2)).toMatch(/^Gate \(model\) → clause check passed/);
    expect(latencyText(lm.a01)).toBe('1.3 s · live');
    expect(asideText(lm.a01)).toBe('1.3 s');
    expect(gateOutput(lm.a01.gate as RowGate).note).toBe('confidence is model-reported and uncalibrated');
  });

  it('hand-written gate output is labelled as such', () => {
    const out = gateOutput(map.a01.gate as RowGate);
    expect(out.summary).toBe('Example output (written by hand, not a model run)');
    expect(JSON.parse(out.json)).toMatchObject({ verdict: 'accept', confidence: null });
  });

  it('why, arrived and trap spans', () => {
    expect(whyText(map.a01)).toBe('Postgres at 40M rows with a 900 ms p95: the topic, with a real workload.');
    expect(arrivedText(askOf('a08'))).toBe('day 16 of the month · Pre-seed');
    const segs = bodySegments(askOf('a12'));
    expect(segs.filter((s) => s.trap).map((s) => s.text)).toEqual(['Huge fan of your work!', 'feedback on our pitch deck']);
    expect(segs.map((s) => s.text).join('')).toBe(askOf('a12').text);
  });
});

describe('the clause check in the browser', () => {
  it('a quote not in the rules turns the verdict into a decline by code', () => {
    const r = run();
    const fake: RowGate = { ...(r.gates.a11 as RowGate), verdict: 'accept', model_verdict: 'accept', cited: [{ text: 'Happy to take any intro', found: false }], source: 'test' };
    const g = checkGate(fake, r.rules);
    expect(g.decided_by).toBe('clause_check');
    expect(g.verdict).toBe('decline');
    r.gates.a11 = g;
    const { map } = computeDisplays(r, [], 2, false);
    expect(map.a11.display).toBe('code');
    expect(footModel(map.a11, { rules: r.rules, cap: 2, reachDays: [] })).toEqual({
      kind: 'code',
      missing: ['Happy to take any intro'],
      note: 'Not in your rules, so code changed accept to decline.',
      test: true,
    });
    expect(chainText(map.a11, 2)).toBe('test output accept → code 0 of 1 quote found → decline');
    expect(decidedByText(map.a11, 2)).toBe('Test output (not a model call) → clause check failed, 0 of 1 quotes found (code) → decline');
    expect(quoteLine(quoteCheck(map))).toBe('1 quote not in your rules, changed to a decline');
  });

  it('a live event that says found without usable offsets is checked again; a missing quote is never an accept', () => {
    const base: RowGate = {
      i: 0,
      ask_id: 'a01',
      verdict: 'accept',
      model_verdict: 'accept',
      cited: [{ text: 'founders about Postgres, queues or LLM evals in production', found: true }],
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
    const r = findClause(ENGINEER, 'founders about Postgres, queues or LLM evals in production');
    expect(fixed.cited[0]).toMatchObject({ found: true, start: r?.start, end: r?.end });
    const lying = normalizeLiveGate({ ...base, cited: [{ text: 'not there', found: false }] }, ENGINEER);
    expect(lying.verdict).toBe('decline');
    expect(lying.decided_by).toBe('clause_check');
  });
});

describe('read view (marks at code-found offsets, tallies per line)', () => {
  it('Engineer: tallies as in ux-spec S1', () => {
    const r = run();
    const { map } = computeDisplays(r, [], 2, false);
    const view = readView(r, map, false);
    expect(view.lines.map((l) => l.tally)).toEqual(['3 let in · 1 question', '3 let in · 1 kept out', 'not used by these 12', '1 kept out']);
    expect(view.lines[0]?.segments.filter((s) => s.mark).map((s) => s.text)).toEqual(['founders about Postgres, queues or LLM evals in production']);
    expect(view.lines[2]?.unused).toBe(true);
    expect(view.nomatch).toBe(6);
    expect(view.missing).toEqual([]);
  });

  it('while a run streams every tally reads checking…', () => {
    const r = run();
    const { map } = computeDisplays(r, [], 2, false);
    expect(readView(r, map, true).lines.every((l) => l.tally === 'checking…')).toBe(true);
  });
});

describe('sort at done and the dividers', () => {
  it('reaches you → question first → over your cap → not checked → traps → other declines', () => {
    const r = run();
    delete r.gates.a05;
    r.errors.a05 = { kind: 'timeout' };
    const { map } = computeDisplays(r, [], 2, false);
    const order = sortOrder(map);
    expect(order).toEqual(['a01', 'a03', 'a06', 'a09', 'a05', 'a08', 'a10', 'a11', 'a12', 'a02', 'a04', 'a07']);
    expect(dividers(order, map)).toEqual([
      { id: 'pg-g-traps', before: 'a08', text: 'Traps · 4 of 4 caught' },
      { id: 'pg-g-rest', before: 'a02', text: 'No line matched · 3' },
    ]);
  });
});

describe('run diff', () => {
  it('a flipped row is named; an added line that decides nothing says so', () => {
    const prevRun = run();
    const prev = snapshotOf(prevRun, computeDisplays(prevRun, [], 2, false).map);
    const next = run();
    next.rules = `${ENGINEER}\nNo asks from health companies.`;
    next.gates.a09 = { ...(next.gates.a09 as RowGate), verdict: 'decline', model_verdict: 'decline', cited: [] };
    const d = runDiff(prev, next, computeDisplays(next, [], 2, false).map);
    expect(d.diff).toBe('1 changed since your last run: Guadua Health.');
    expect(d.changed).toEqual({ a09: 'held' });
    const same = run();
    same.rules = `${ENGINEER}\nNo asks about crypto.`;
    expect(runDiff(prev, same, computeDisplays(same, [], 2, false).map).diff).toBe('No verdict changed. That line did not decide any of these 12 asks.');
    expect(addedOneLine('a\nb', 'a\nb\nc')).toBe(true);
    expect(addedOneLine('a\nb', 'a\nc')).toBe(false);
  });

  it('same rules: a live run that differs from the hand-written examples is not called model variance', () => {
    const prevRun = run();
    const prev = snapshotOf(prevRun, computeDisplays(prevRun, [], 2, false).map);
    const live = liveCopy(run());
    live.gates.a06 = { ...(live.gates.a06 as RowGate), verdict: 'decline', model_verdict: 'decline', question: null };
    const d = runDiff(prev, live, computeDisplays(live, [], 2, false).map);
    expect(d.diff).toBe('1 differs from the hand-written examples: Pinole Labs.');
    expect(d.variance).toEqual([]);
    const second = liveCopy(run());
    const d2 = runDiff(snapshotOf(live, computeDisplays(live, [], 2, false).map), second, computeDisplays(second, [], 2, false).map);
    expect(d2.variance).toEqual(['a06']);
  });

  it('a run on another preset is a fresh start', () => {
    const prevRun = run();
    const prev = snapshotOf(prevRun, computeDisplays(prevRun, [], 2, false).map);
    const health = recordedRunFor('health', presetById('health').rules, 0);
    expect(runDiff(prev, health, computeDisplays(health, [], 2, false).map)).toEqual({ changed: {}, variance: [], diff: null });
  });
});

describe('raw trace', () => {
  it('hand-written runs have no time column, no cost, and the cap step says (code)', () => {
    const r = run();
    const { map, reachDays } = computeDisplays(r, [], 2, false);
    const rows = traceRows(r, map, 2, reachDays);
    const text = rows.map((row) => `${row.time ?? ''}${row.segs.map((s) => s.text).join('')}`);
    expect(rows.every((row) => row.time === null)).toBe(true);
    expect(text[0]).toBe('plan  example verdicts, written by hand · not a model run · 12 asks · rules 196 chars');
    expect(text).toContain('gate  #1 Arrecife Data accept');
    expect(text).toContain('check #1 quotes 2/2 found (code)');
    expect(text).toContain('cap   #1 reach · 1 of 2 (code)');
    expect(text).toContain('cap   #9 over_cap · used day 2, day 4 (code)');
    expect(text[text.length - 1]).toBe('done  3 accept · 1 ask_back · 8 decline · 0 failed');
    expect(text.join('\n')).not.toMatch(/postgres|\$/i);
  });

  it('live runs are timed and report the measured cost', () => {
    const live = liveCopy(run());
    live.events = [{ kind: 'plan', t: 0, text: 'run r_8f2a · live · 12 gates · rules 196 chars' }];
    for (const [i, id] of (['a01', 'a02'] as const).entries()) live.events.push({ kind: 'gate', t: 1290 + i, ev: live.gates[id] as RowGate });
    live.events.push({ kind: 'done', t: 2300, cost_usd: 0.0019 });
    const { map, reachDays } = computeDisplays(live, [], 2, false);
    const rows = traceRows(live, map, 2, reachDays);
    expect(rows[0]?.time).toBe('+0 ms     ');
    expect(rows[1]?.time).toBe('+1290 ms  ');
    expect(rows[rows.length - 1]?.segs.map((s) => s.text).join('')).toBe('done  3 accept · 1 ask_back · 8 decline · 0 failed · $0.0019');
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
