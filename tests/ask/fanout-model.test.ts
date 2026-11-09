import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  applyLoop,
  cellDetail,
  cellView,
  emptyRun,
  exampleCompiled,
  exampleRealView,
  exampleRun,
  holderCell,
  interrupted,
  legendItems,
  moveOn,
  NETWORK_TOTAL,
  outcomeAfterDone,
  pendingQuestions,
  questionsFromCells,
  rankAccepts,
  realLegend,
  realWhyLine,
  sourceLine,
  splitTraceLine,
  traceRows,
  waffleLabel,
  whyLine,
  youCell,
  type SampleCell,
  type SampleRun,
} from '@/components/ask/fanout-model';
import { AUTHORED_FANOUT_LABEL } from '@/lib/oti/copy';
import { hash32, hex4, shuffled } from '@/lib/oti/text';
import { QA_STATES } from '@/lib/qa';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { PRESETS } from '@/lib/sample/presets';
import type { PlaygroundStore } from '@/lib/oti/storage';

const NOW = Date.UTC(2026, 10, 9, 16, 4);
const ASKER_VIEW = new Set(['offered', 'next', 'ask', 'nothistime', 'checking', 'queued']);

function pg(preset: 'engineer' | 'health' | 'founder'): PlaygroundStore {
  const p = PRESETS.find((x) => x.id === preset)!;
  return { v: 1, preset, rules: p.rules, cap: 2, edited: false, run_id: null, ran_at: null, mode: null, run_rules: null, results: [], marks: [] };
}

describe('QA example runs (canonical sample data, never stored)', () => {
  it.each(QA_STATES.askStatus.filter((s) => s !== 'real'))('%s renders a consistent run', (state) => {
    const run = exampleRun('sa_eng', state, null, NOW);
    expect(run.example).toBe(true);
    expect(run.cells).toHaveLength(NETWORK_TOTAL);
    const expected: Record<string, string> = {
      offered: 'offered',
      streaming: 'streaming',
      'offered-you': 'offered-you',
      'ask-back': 'offered',
      answered: 'answered',
      intro: 'intro',
      'moved-on': 'moved-on',
      'no-match': 'no-match',
      'closed-all-passed': 'closed-all-passed',
      'expired-deadline': 'expired-deadline',
      'failed-closed': 'failed-closed',
      'partial-failure': 'offered',
      withdrawn: 'withdrawn',
    };
    expect(run.outcome).toBe(expected[state]);
    // Askers see four states only (plus checking while streaming).
    for (let pos = 0; pos < NETWORK_TOTAL; pos++) expect(ASKER_VIEW.has(cellView(run, pos, false))).toBe(true);
    // The legend accounts for every cell, revealed or not.
    for (const reveal of [false, true]) {
      const total = legendItems(run, reveal).reduce((n, i) => n + Number(i.text.match(/^\d+/)?.[0] ?? 0), 0);
      expect(total).toBe(NETWORK_TOTAL);
    }
  });

  it('positions and the 40th cell follow BE2’s rule: shuffled(40, hash32(id)), the filler or your gate last', () => {
    const run = exampleRun('sa_health', 'offered', null, NOW);
    const order = shuffled(NETWORK_TOTAL, hash32('sa_health'));
    const last = run.cells[order[NETWORK_TOTAL - 1] as number]!;
    expect(last.label).toBe(`m-${hex4('sa_health:fill')}`);
    expect(last.state).toBe('decline');
    const withYou = exampleRun('sa_health', 'offered', pg('health'), NOW);
    expect(withYou.cells[order[NETWORK_TOTAL - 1] as number]!.you).toBe(true);
  });

  it('your gate on the Health ask asks for the price first (lib/sample youAskBack)', () => {
    const run = exampleRun('sa_health', 'offered', pg('health'), NOW);
    const you = youCell(run)!;
    expect(you.state).toBe('ask_back');
    expect(you.question?.type).toBe('price');
    expect(you.cited).toBe('B2B founders selling to public hospitals or insurers in Mexico or Colombia');
    // One question per type; your gate's wording leads and both gates count.
    expect(pendingQuestions(run)[0]).toMatchObject({ type: 'price', gates: 2 });
  });

  it('offered-you gives your own gate the offer (most unused cap)', () => {
    const run = exampleRun('sa_eng', 'offered-you', null, NOW);
    expect(holderCell(run)?.you).toBe(true);
    expect(cellView(run, holderCell(run)!.cell, false)).toBe('offered');
  });

  it('no-match folds small buckets and skips into “other” (ux-spec copy)', () => {
    expect(whyLine(exampleRun('sa_eng', 'no-match', null, NOW))).toBe('Why: topic 26 · stage 4 · other 10.');
  });

  it('failed-closed and partial-failure carry the failure counts', () => {
    const closed = exampleRun('sa_eng', 'failed-closed', null, NOW);
    expect(closed.done).toMatchObject({ gates_ran: 33, gates_failed: 9, failed_closed: true });
    expect(closed.offered).toEqual([]);
    const partial = exampleRun('sa_eng', 'partial-failure', null, NOW);
    expect(partial.done).toMatchObject({ gates_ran: 33, gates_failed: 2, failed_closed: false });
  });

  it('streaming freezes 21 of 40 answered', () => {
    const run = exampleRun('sa_eng', 'streaming', null, NOW);
    expect(run.cells.filter(Boolean)).toHaveLength(21);
    expect(legendItems(run, false)[0]).toEqual({ state: 'checking', text: '19 checking' });
  });
});

describe('who gets it next (the same order as BE2)', () => {
  const cell = (pos: number, cap: number, used: number, at: number | null = null): SampleCell => ({
    cell: pos, state: 'accept', you: false, label: `m-${pos}`, city: 'x', reason_code: 'match', cited: null, question: null, ms: null, cap, used, na: null, source: 'authored', at,
  });

  it('most unused cap, then the earliest answer, then position', () => {
    const cells = [null, cell(1, 2, 1, 50), cell(2, 3, 0, 90), cell(3, 2, 1, 10), cell(4, 2, 1, 10)];
    expect(rankAccepts(cells)).toEqual([2, 3, 4, 1]);
    expect(rankAccepts(cells, [2, 3])).toEqual([4, 1]);
  });

  it('a pass moves the ask on; with nobody left it closes', () => {
    let run = exampleRun('sa_eng', 'offered', null, NOW);
    expect(interrupted(run)).toBe(1);
    run = moveOn(run, NOW + 1000);
    expect(run.outcome).toBe('moved-on');
    expect(interrupted(run)).toBe(2);
    // The member who passed reads “not this time” to the asker: a pass and an expiry look the same.
    expect(cellView(run, run.offered[0]!, false)).toBe('nothistime');
    expect(cellView(run, run.offered[0]!, true)).toBe('passed');
    run = moveOn(run, NOW + 2000);
    expect(run.outcome).toBe('closed-all-passed');
  });
});

describe('the sample loop (oti.sampleOffer, written by /o/sample)', () => {
  it('applies OK, an answer or a No once, only while someone holds the offer', () => {
    const run = exampleRun('sa_eng', 'offered', null, NOW);
    const ok = applyLoop(run, { action: 'ok', at: NOW + 10, text: null }, NOW + 20);
    expect(ok.outcome).toBe('intro');
    expect(applyLoop(ok, { action: 'no', at: NOW + 30, text: null }, NOW + 40)).toBe(ok);
    const answered = applyLoop(run, { action: 'answer', at: NOW + 10, text: ' Check pg_locks first. ' }, NOW + 20);
    expect(answered).toMatchObject({ outcome: 'answered', member_answer: 'Check pg_locks first.' });
    const moved = applyLoop(run, { action: 'no', at: NOW + 10, text: null }, NOW + 20);
    expect(moved.outcome).toBe('moved-on');
    // Replaying the same action does nothing.
    expect(applyLoop(moved, { action: 'no', at: NOW + 10, text: null }, NOW + 30)).toBe(moved);
  });
});

describe('outcome after the stream', () => {
  const base = () => emptyRun({ id: 'sa_eng', preset: 'engineer', sample_ask_id: 'sa_eng', text: 'x', compiled: exampleCompiled(SAMPLE_NETWORK_ASKS.engineer), you: null, sent_at: NOW });
  const done = { wall_ms: 3, people_interrupted: 0, counts: { offered: 0, next: 0, question: 0, nothistime: 40 }, gates_ran: 33, gates_failed: 0, failed_closed: false, at: 5 };

  it('fail closed beats everything; an offer, a question, or no match', () => {
    const ex = exampleRun('sa_eng', 'offered', null, NOW);
    expect(outcomeAfterDone({ ...ex, done: { ...done, failed_closed: true } })).toBe('failed-closed');
    expect(outcomeAfterDone(ex)).toBe('offered');
    const noOffer: SampleRun = { ...ex, offer: null, offered: [] };
    expect(outcomeAfterDone(noOffer)).toBe('question');
    const nothing: SampleRun = { ...base(), cells: ex.cells.map((c) => (c && c.state !== 'na' ? { ...c, state: 'decline' as const } : c)), done };
    expect(outcomeAfterDone(nothing)).toBe('no-match');
  });
});

describe('labels by source (docs/CONTRACT.md §e)', () => {
  it('hand-written results say so; recorded and live say what they are', () => {
    const run = exampleRun('sa_eng', 'offered', pg('engineer'), NOW);
    const stored = { ...run, example: false };
    expect(sourceLine({ ...stored, plan: { ask_id: 'sa_eng', network: 'sample', total: 40, sample_source: 'authored' } }, true)).toBe(`${AUTHORED_FANOUT_LABEL} + your gate (${youCell(run)?.state === 'failed' ? 'not checked: live checks are off on this instance' : 'live'})`);
    expect(sourceLine({ ...stored, plan: { ask_id: 'sa_eng', network: 'sample', total: 40, sample_source: 'model', recorded_at: '2026-11-09T09:00:00-06:00' } }, false)).toBe('39 recorded sample members (Nov 9, replayed at recorded speed) + your gate (live)');
    const noYou = exampleRun('sa_eng', 'offered', null, NOW);
    expect(sourceLine(noYou, true)).toBe('Example results for 40 sample members, written by hand · not a model run');
    expect(sourceLine(noYou, true)).not.toMatch(/recorded|model run ·|\$/);
  });

  it('the SAMPLE trace never claims Postgres decided anything (§e.9)', () => {
    for (const state of ['offered', 'moved-on', 'failed-closed'] as const) {
      const run = exampleRun('sa_health', state, pg('health'), NOW);
      const text = traceRows(run, true, () => 'Thu Nov 12, 10:04 CST', 47)
        .map((r) => r.parts.map((p) => (typeof p === 'string' ? p : p.text)).join(''))
        .join('\n');
      expect(text).not.toMatch(/Postgres|reserve_slot/);
      expect(text).toContain('ask sa_health · compiled 5/5 · 47 words · SAMPLE network · 40 members');
    }
  });

  it('reveal-mode details carry cap and reason; the asker view carries neither', () => {
    const run = exampleRun('sa_eng', 'offered', null, NOW);
    const holder = holderCell(run)!;
    expect(cellDetail(run, holder.cell, true)).toMatch(/^m-[0-9a-f]{4} · .* · accepted · offered · cited “.+” · cap 2 of 2 used$/);
    const label = waffleLabel(legendItems(run, false), 40);
    expect(label).toBe('40 members: 1 offered, 1 next in line, 1 question for you, 37 not this time');
    expect(label).not.toMatch(/cap|declined|paused|m-/);
  });
});

describe('questions', () => {
  it('one per type, counting every gate that asked', () => {
    const run = exampleRun('sa_eng', 'offered', null, NOW);
    expect(questionsFromCells(run.cells, 'sa_eng')).toEqual([{ qid: `q_${hex4('sa_eng:role')}`, type: 'role', text: 'Who on your team would join the call, and what is their role?', gates: 1, at: null }]);
  });

  it('an answer reruns only the gates that asked; the record says whether your own gate was one of them', () => {
    const run = { ...exampleRun('sa_health', 'ask-back', pg('health'), NOW), example: false };
    const q = pendingQuestions(run)[0]!;
    expect(q).toMatchObject({ type: 'price', gates: 2 });
    const asked = run.cells.filter((c): c is SampleCell => !!c && c.state === 'ask_back');
    const cells = asked.map((c) => ({ ...c, state: 'accept' as const, question: null, reason_code: 'match' as const }));
    const next = applyAnswer(run, q, '$18k a year per hospital', { reran: 2, accepted: 2, cells, offer: null }, NOW);
    expect(next.answers).toEqual([{ qid: q.qid, question: { type: 'price', text: q.text }, text: '$18k a year per hospital', reran: 2, accepted: 2, offer: false, you: true }]);
    expect(pendingQuestions(next)).toEqual([]);
    expect(youCell(next)!.state).toBe('accept');
    // The offer stays where it was: nobody new was interrupted.
    expect(next.offered).toEqual(run.offered);
    expect(next.outcome).toBe(run.outcome);
  });
});

describe('REAL: the serializer’s four states', () => {
  it('the QA example is the REAL layout example and nothing more', () => {
    const v = exampleRealView();
    expect(new Set(v.cells)).toEqual(new Set(['offered', 'next', 'nothistime']));
    expect(realLegend(v.cells).map((i) => i.text)).toEqual(['1 offered', '2 next in line', '37 not this time']);
    expect(v.trace).toHaveLength(4);
    expect(splitTraceLine(v.trace[1]!)).toEqual({ time: '+2104 ms  ', rest: 'gates done' });
    expect(splitTraceLine('no time here')).toEqual({ time: null, rest: 'no time here' });
  });

  it('why line folds into other', () => {
    expect(realWhyLine({ topic: 26, stage: 4, other: 10 })).toBe('Why: topic 26 · stage 4 · other 10.');
    expect(realWhyLine({ other: 7 })).toBe('Why: other 7.');
  });
});
