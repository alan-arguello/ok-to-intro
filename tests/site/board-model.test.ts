import { describe, expect, it } from 'vitest';
import {
  BOARD_COPY,
  boardView,
  clauseExample,
  emptyBoardView,
  evalView,
  fmtHours,
  fmtUsdAbout,
  fmtUsdConst,
  frac,
  lineText,
  parseBoardSnapshot,
  type BoardSnapshot,
  type BoardView,
} from '@/components/board/model';
import { EXAMPLE_EVAL, EXAMPLE_SNAPSHOT, exampleBoardView, exampleSnapshot } from '@/components/board/qa-examples';
import { PROTOTYPE_NUMBERS_NOTE } from '@/lib/oti/copy';
import { BANNED_COPY, hasStraightQuotes } from '@/lib/oti/text';
import { EXAMPLE_BOARD } from '@/lib/sample/examples';
import type { EvalSummary } from '@/lib/types';

const NO_EVAL: EvalSummary = {
  source: 'none',
  ran_at: null,
  model: null,
  rubric_hash: null,
  header: null,
  rows: [],
  totals: null,
  wrongly_let_through: null,
  wrongly_blocked: null,
  misses: [],
};

const ZERO: BoardSnapshot = { ...exampleSnapshot('launch-day') };

function snap(over: Partial<BoardSnapshot>): BoardSnapshot {
  return { ...ZERO, ...over };
}

function view(s: BoardSnapshot, opts: Partial<Parameters<typeof boardView>[0]> = {}): BoardView {
  return boardView({ snapshot: s, asOfKind: 'read', evalSummary: NO_EVAL, ...opts });
}

/** Every string a view prints (headline, rows, notes, demand, eval, clause, playground). */
function allText(v: BoardView): string {
  const parts: string[] = [v.lede, v.headlineDef, v.notice ?? '', v.headline ? lineText(v.headline.line) : '', v.headline?.kind === 'ratio' ? v.headline.ratio : ''];
  for (const r of [...v.funnel, ...v.protection]) parts.push(r.label, r.value, r.note);
  parts.push(...v.defsNotes, ...v.demand.rows.map((d) => `${d.topic} ${lineText(d.line)}`), v.demand.empty ?? '', v.demand.other ? lineText(v.demand.other) : '');
  parts.push(v.eval.header, v.eval.note ?? '', v.eval.errors ?? '', v.eval.missesSummary ?? '', lineText(v.clause.line), lineText(v.playground));
  return parts.join('\n');
}

const row = (v: BoardView, label: string) => [...v.funnel, ...v.protection].find((r) => r.label === label);

describe('parseBoardSnapshot', () => {
  const raw = {
    ...EXAMPLE_SNAPSHOT,
    as_of: '2026-11-10T20:02:00+00:00',
    // Postgres bigint and numeric arrive as numbers or numeric strings.
    asks_sent: '12',
    median_hours_to_answer: 3.1,
  };

  it('accepts what board_snapshot() returns', () => {
    const s = parseBoardSnapshot(raw);
    expect(s?.asks_sent).toBe(12);
    expect(s?.as_of).toBe('2026-11-10T20:02:00.000Z');
    expect(s?.demand[0]).toEqual({ topic: 'Hospital procurement, US', asks: 4, reached: 1, askers: 3 });
  });

  it('refuses a snapshot with a missing or invalid count rather than print a 0 nobody counted', () => {
    const { interrupted: _drop, ...missing } = raw;
    expect(parseBoardSnapshot(missing)).toBeNull();
    expect(parseBoardSnapshot({ ...raw, gate_checks: -1 })).toBeNull();
    expect(parseBoardSnapshot({ ...raw, gate_checks: 'many' })).toBeNull();
    expect(parseBoardSnapshot({ ...raw, as_of: 'yesterday' })).toBeNull();
    expect(parseBoardSnapshot({ ...raw, demand: [{ topic: '', asks: 1, reached: 0, askers: 3 }] })).toBeNull();
    expect(parseBoardSnapshot(null)).toBeNull();
    expect(parseBoardSnapshot([])).toBeNull();
  });

  it('keeps a null median and a null since', () => {
    const s = parseBoardSnapshot({ ...raw, median_hours_to_answer: null, since: null });
    expect(s?.median_hours_to_answer).toBeNull();
    expect(s?.since).toBeNull();
  });
});

describe('formatting', () => {
  it('prints denominators, and a count alone when there is nothing to divide by', () => {
    expect(frac(7, 11, 'offers')).toBe('7 of 11 offers');
    expect(frac(1, 1, 'offers')).toBe('1 of 1 offer');
    expect(frac(9, 12)).toBe('9 of 12');
    expect(frac(0, 0, 'intros')).toBe('0');
    expect(frac(1980, 2500)).toBe('1,980 of 2,500');
  });

  it('formats hours and dollars the way the board writes them', () => {
    expect(fmtHours(3.1)).toBe('3.1 h');
    expect(fmtHours(0.4)).toBe('24 min');
    expect(fmtHours(26.4)).toBe('26 h');
    expect(fmtUsdConst(0.00016)).toBe('$0.00016');
    expect(fmtUsdAbout(1980 * 0.00016)).toBe('$0.32');
    expect(fmtUsdAbout(0.00528)).toBe('$0.005');
    expect(fmtUsdAbout(0.00192)).toBe('$0.002');
    expect(fmtUsdAbout(0)).toBe('$0');
  });
});

describe('boardView: real counts', () => {
  it('writes the lede with the first join and the last update, in Pacific time', () => {
    const v = view(EXAMPLE_SNAPSHOT);
    expect(v.lede).toBe('Real counts since Nov 9, 2026. Every number has its denominator. Last update Nov 10, 14:02 PT.');
    expect(v.updated).toBe('Nov 10, 14:02');
    expect(view(snap({ since: null })).lede.startsWith('Real counts. Every number has its denominator. Last update')).toBe(true);
  });

  it('shows the ratio only from 3 useful outcomes', () => {
    const ratio = view(EXAMPLE_SNAPSHOT).headline;
    expect(ratio?.kind).toBe('ratio');
    if (ratio?.kind === 'ratio') {
      expect(ratio.ratio).toBe('2.2');
      expect(lineText(ratio.line)).toBe('11 people interrupted ÷ 5 useful outcomes');
    }
    const small = view({ ...EXAMPLE_SNAPSHOT, useful: 2 }).headline;
    expect(small?.kind).toBe('text');
    expect(lineText(small?.line ?? [])).toBe('Not enough outcomes yet: 11 people interrupted, 2 useful outcomes so far.');
    expect(lineText(view(snap({ interrupted: 1, useful: 1, intros: 1 })).headline?.line ?? [])).toBe(
      'Not enough outcomes yet: 1 person interrupted, 1 useful outcome so far.',
    );
    expect(lineText(view(ZERO).headline?.line ?? [])).toBe(BOARD_COPY.noIntros);
  });

  it('notes a small sample under the headline below 20 interruptions only', () => {
    expect(view(EXAMPLE_SNAPSHOT).headlineDef.endsWith(BOARD_COPY.headlineSmall)).toBe(true);
    expect(view({ ...EXAMPLE_SNAPSHOT, interrupted: 40, useful: 10 }).headlineDef.endsWith(BOARD_COPY.headlineSmall)).toBe(false);
  });

  it('gives every rate its denominator and adds one small-sample note per section', () => {
    const v = view(EXAMPLE_SNAPSHOT);
    expect(row(v, 'Asks that reached a person')?.value).toBe('9 of 12');
    expect(row(v, 'OK to intro')?.value).toBe('7 of 11 offers');
    expect(row(v, 'Answered in 2 lines')?.value).toBe('1 of 11 offers');
    expect(row(v, 'Call happened')).toMatchObject({ value: '5 of 7 intros', note: '6 of 7 answered the +1 day check-in' });
    expect(row(v, 'Gate checks that stopped an ask')?.value).toBe('231 of 254');
    expect(row(v, 'Verdicts overruled by code')?.value).toBe('2 of 254');
    expect(v.funnelSmall).toBe(true);
    // 254 gate checks is not a small sample: protection has no row under 20.
    expect(v.protectionSmall).toBe(false);
    const big = view({ ...EXAMPLE_SNAPSHOT, asks_sent: 40, asks_reached_person: 30, interrupted: 60, offers_ok: 30, offers_answered: 5, intros: 30, calls_happened: 25, d1_answered: 28, useful: 20 });
    expect(big.funnelSmall).toBe(false);
  });

  it('bounds gate checks by asks × members plus reruns, and says so', () => {
    expect(row(view(EXAMPLE_SNAPSHOT), 'Gate checks')?.note).toBe('at most 12 asks × 23 members, plus 3 reruns');
    // Members who deleted their data leave the bound short: say what a gate check is instead.
    expect(row(view({ ...EXAMPLE_SNAPSHOT, members_with_rules: 10 }), 'Gate checks')?.note).toBe('one per member per ask after SQL skips, plus 3 reruns');
    expect(row(view(ZERO), 'Gate checks')?.note).toBe('');
  });

  it('publishes the median answer time only from 3 answered offers', () => {
    expect(row(view(EXAMPLE_SNAPSHOT), 'Median time to answer an offer')).toMatchObject({ value: '3.1 h', note: '10 offers answered' });
    const two = row(view({ ...EXAMPLE_SNAPSHOT, offers_answered_count: 2, median_hours_to_answer: 0.4 }), 'Median time to answer an offer');
    expect(two).toMatchObject({ value: '—', note: 'shown from 3 answered offers' });
  });

  it('lists a demand topic only with 3 or more founders, and counts the rest as other topics', () => {
    const v = view(EXAMPLE_SNAPSHOT);
    expect(v.demand.rows.map((d) => `${d.topic}: ${lineText(d.line)}`)).toEqual([
      'Hospital procurement, US: 4 asks from 3 founders · 3 of 4 reached nobody',
      'First SOC 2 audit: 3 asks from 3 founders · 3 of 3 reached nobody',
    ]);
    expect(lineText(v.demand.other ?? [])).toBe('Other topics (fewer than 3 founders each): 5 asks');
    // Even if a topic with 2 founders ever reached the view, it is not printed.
    const leak = view({ ...EXAMPLE_SNAPSHOT, demand: [{ topic: 'Someone’s own company', asks: 2, reached: 0, askers: 2 }] });
    expect(allText(leak)).not.toContain('Someone’s own company');
    expect(leak.demand.empty).toBe(BOARD_COPY.demandEmpty);
    expect(view(ZERO).demand).toEqual({ rows: [], other: null, empty: BOARD_COPY.demandEmpty });
  });

  it('describes the clause check by what code counts, with the right number words', () => {
    expect(lineText(view(EXAMPLE_SNAPSHOT).clause.line)).toBe(
      '2 of 254 gate verdicts didn’t pass the code check (a quote not in the member’s rules, no quote, or a question outside the rules), so code declined both.',
    );
    expect(lineText(view({ ...EXAMPLE_SNAPSHOT, quotes_not_found: 1 }).clause.line).endsWith('so code declined it.')).toBe(true);
    expect(lineText(view({ ...EXAMPLE_SNAPSHOT, quotes_not_found: 5 }).clause.line).endsWith('so code declined each one.')).toBe(true);
    expect(lineText(view(ZERO).clause.line)).toBe(BOARD_COPY.noVerdicts);
  });

  it('prices playground calls with the one cost constant, said as “about”', () => {
    expect(lineText(view(EXAMPLE_SNAPSHOT).playground)).toBe(
      '214 playground runs · 1,980 live gate calls (about $0.32 at $0.00016 a call) · 0 rules stored · 37 sample asks sent',
    );
  });

  it('carries the SQL definition of every number', () => {
    const v = view(EXAMPLE_SNAPSHOT);
    for (const r of [...v.funnel, ...v.protection]) expect(r.def.length).toBeGreaterThan(10);
    expect(v.defs.map((d) => d.label)).toEqual([...v.funnel, ...v.protection].map((r) => r.label));
    const titled = (line: ReturnType<typeof view>['playground']) => line.filter((s) => typeof s !== 'string' && s.title).length;
    expect(titled(v.playground)).toBe(4);
    expect(titled(v.clause.line)).toBe(2);
  });

  it('explains the checkpoint only when the counts are as of one', () => {
    expect(view(EXAMPLE_SNAPSHOT, { asOfKind: 'checkpoint' }).defsNotes).toContain(BOARD_COPY.defsNoteCheckpoint);
    expect(view(EXAMPLE_SNAPSHOT, { asOfKind: 'read' }).defsNotes).not.toContain(BOARD_COPY.defsNoteCheckpoint);
  });

  it('is never labelled as example numbers unless it is the QA example', () => {
    expect(view(EXAMPLE_SNAPSHOT).example).toBe(false);
    expect(exampleBoardView('default').example).toBe(true);
  });
});

describe('emptyBoardView: no counts', () => {
  it('says the real network is not connected, with no numbers, but keeps the definitions and the eval', () => {
    const v = emptyBoardView('not_configured', NO_EVAL);
    expect(v.mode).toBe('not_configured');
    expect(lineText(v.headline?.line ?? [])).toBe('The real network isn’t connected on this instance yet.');
    expect(v.sections).toBe(false);
    expect(v.funnel).toEqual([]);
    expect(v.defs.length).toBe(16);
    expect(v.eval.header).toBe('No eval run yet.');
    expect(allText(v)).not.toMatch(/\b(254|23|2\.2|231)\b/);
  });

  it('says the database is not answering when there is nothing cached to show', () => {
    const v = emptyBoardView('db_down', NO_EVAL);
    expect(v.notice).toBe(BOARD_COPY.dbDown);
    expect(v.headline).toBeNull();
    expect(v.defs).toEqual([]);
  });
});

describe('evalView', () => {
  it('shows “No eval run yet” for the committed placeholder', () => {
    const e = evalView(NO_EVAL);
    expect(e.state).toBe('none');
    expect(e.header).toBe('No eval run yet.');
    expect(e.rows).toEqual([]);
  });

  it('reads a real eval file: runs, totals, errors, and every miss with where and what', () => {
    const e = evalView(EXAMPLE_EVAL);
    expect(e.state).toBe('ran');
    expect(e.runLabels).toEqual(['Run 1', 'Run 2', 'Run 3']);
    expect(e.totals).toEqual({ n: 20, runs: [17, 18, 17], baseline: 11 });
    expect(e.errors).toBe('Wrongly let through: 1 · 0 · 1 (baseline 4). Wrongly blocked: 1 · 0 · 1 (baseline 5).');
    expect(e.missesSummary).toBe('See the 6 cases missed (8 misses across 3 runs)');
    expect(e.misses[2]).toMatchObject({ caseType: 'Right topic, wrong stage', where: 'runs 1 and 2', expected: 'question first', got: 'decline' });
    expect(e.misses[0]?.cited).toEqual([]);
  });
});

describe('the QA examples', () => {
  it('match the prototype’s example numbers (lib/sample/examples.ts)', () => {
    const v = exampleBoardView('default');
    const proto = new Map([...EXAMPLE_BOARD.funnel, ...EXAMPLE_BOARD.protection].map(([label, value]) => [label, value]));
    for (const label of ['Members with rules', 'Asks sent', 'Gate checks', 'Asks that reached a person', 'People interrupted (offers delivered)', 'OK to intro', 'Answered in 2 lines', 'Call happened', 'Gate checks that stopped an ask', 'Offers per member this month', 'Cap overruns', 'Median time to answer an offer', 'Members who paused · deleted']) {
      expect(row(v, label)?.value, label).toBe(proto.get(label));
    }
    expect(row(v, 'Verdicts overruled by code')?.value).toBe(proto.get('Quotes not found in the member’s rules'));
    expect(v.headline?.kind === 'ratio' && v.headline.ratio).toBe(EXAMPLE_BOARD.headline.ratio);
    expect(v.lede).toBe(`Real counts since ${EXAMPLE_BOARD.since}. Every number has its denominator. Last update ${EXAMPLE_BOARD.updated}.`);
  });

  it('render the four prototype states', () => {
    expect(lineText(exampleBoardView('launch-day').headline?.line ?? [])).toBe(BOARD_COPY.noIntros);
    expect(exampleBoardView('launch-day').lede).toContain('Last update Nov 9, 21:30 PT.');
    expect(lineText(exampleBoardView('small-n').headline?.line ?? [])).toContain('2 useful outcomes so far');
    expect(exampleBoardView('stale').stale).toBe(true);
    expect(exampleBoardView('default').stale).toBe(false);
  });

  it('have an eval whose misses add up to its table', () => {
    for (const r of EXAMPLE_EVAL.rows) {
      const missesOfType = EXAMPLE_EVAL.misses.filter((m) => m.case_type === r.case_type);
      r.runs.forEach((correct, k) => {
        const wrong = missesOfType.filter((m) => m.actual[k] !== m.expected).length;
        expect(correct, `${r.label} run ${k + 1}`).toBe(r.n - wrong);
      });
    }
    const runs = [0, 1, 2];
    expect(runs.map((k) => EXAMPLE_EVAL.misses.filter((m) => m.actual[k] === 'accept' && m.expected !== 'accept').length)).toEqual(EXAMPLE_EVAL.wrongly_let_through?.runs);
    expect(runs.map((k) => EXAMPLE_EVAL.misses.filter((m) => m.expected === 'accept' && m.actual[k] !== 'accept').length)).toEqual(EXAMPLE_EVAL.wrongly_blocked?.runs);
  });
});

describe('the clause-check example', () => {
  it('runs the real clause finder on the SAMPLE rules and says what code did', () => {
    const ex = clauseExample();
    expect(ex.company).toBe('Sagefen Health');
    expect(ex.quoted).toEqual([{ text: 'Happy to take any intro', found: false }]);
    expect(`${ex.found} of ${ex.total}`).toBe('0 of 1');
    expect(ex.change).toBe('accept → decline (code)');
  });
});

describe('copy', () => {
  it('has no banned words, exclamation marks or straight quotes in what the board says', () => {
    const texts = [allText(view(EXAMPLE_SNAPSHOT)), allText(emptyBoardView('not_configured', NO_EVAL)), allText(emptyBoardView('db_down', NO_EVAL)), allText(exampleBoardView('launch-day'))];
    for (const t of texts) {
      for (const re of BANNED_COPY) expect(t).not.toMatch(re);
      // Prose only: the SQL definitions (titles and “How this is counted”) keep SQL's own quotes.
      expect(hasStraightQuotes(t)).toBe(false);
    }
    for (const value of Object.values(BOARD_COPY)) {
      if (typeof value === 'string') expect(hasStraightQuotes(value), value).toBe(false);
    }
    expect(PROTOTYPE_NUMBERS_NOTE).toContain('example numbers');
  });
});
