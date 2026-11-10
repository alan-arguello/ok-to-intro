import { describe, expect, it } from 'vitest';
import { allFound, checkQuotes, findClause, markedSegments, norm, ownWords, readViewLines, ruleLines } from '@/lib/oti/clause';
import { PRESETS } from '@/lib/sample';

const RULES = PRESETS[0]!.rules;

describe('norm', () => {
  it('folds NFKC, curly quotes, whitespace and case', () => {
    expect(norm('  “Happy” to\ttalk’s  ')).toBe('"happy" to talk\'s');
  });
});

describe('findClause', () => {
  it('returns offsets into the original rules text', () => {
    const r = findClause(RULES, 'real usage: a customer count, a churn rate or a ticket count');
    expect(r).not.toBeNull();
    expect(RULES.slice(r!.start, r!.end)).toBe('real usage: a customer count, a churn rate or a ticket count');
  });

  it('matches despite curly quotes, extra spaces and case, but still renders the member’s own words', () => {
    // The prototype kit's own example: a doubled space and curly quotes around the quote.
    const r = findClause(RULES, '“real usage:  a customer count, a churn rate or a ticket count”');
    expect(r).not.toBeNull();
    expect(RULES.slice(r!.start, r!.end)).toBe('real usage: a customer count, a churn rate or a ticket count');
    const upper = findClause(RULES, 'NO ASKS TO REVIEW A DECK.');
    expect(RULES.slice(upper!.start, upper!.end)).toBe('No asks to review a deck.');
  });

  it('matches across a line break in the rules (whitespace collapses)', () => {
    const r = findClause(RULES, 'support load. Only if they have');
    expect(r).not.toBeNull();
    expect(RULES.slice(r!.start, r!.end)).toBe('support load.\nOnly if they have');
  });

  it('rejects text that is not one contiguous span of the rules', () => {
    expect(findClause(RULES, 'Happy to take any intro')).toBeNull();
    expect(findClause(RULES, 'Postgres, queues or error rate')).toBeNull();
    expect(findClause(RULES, '')).toBeNull();
    expect(findClause(RULES, '“”')).toBeNull();
  });

  it('handles straight apostrophes against curly ones in the rules', () => {
    const rules = 'Happy to talk if you’ve shipped.';
    const r = findClause(rules, "if you've shipped");
    expect(rules.slice(r!.start, r!.end)).toBe('if you’ve shipped');
  });
});

describe('checkQuotes / ownWords', () => {
  it('marks each quote found or not, with offsets only when found', () => {
    const cited = checkQuotes(RULES, ['No fundraising asks.', 'Happy to take any intro']);
    expect(cited[0]).toMatchObject({ found: true });
    expect(cited[1]).toEqual({ text: 'Happy to take any intro', found: false });
    expect(allFound(cited)).toBe(false);
    expect(allFound([])).toBe(true);
    expect(ownWords(RULES, cited[0]!)).toBe('No fundraising asks.');
    expect(ownWords(RULES, cited[1]!)).toBeNull();
  });
});

describe('read view helpers', () => {
  it('splits rules into lines with offsets', () => {
    const lines = ruleLines(RULES);
    expect(lines).toHaveLength(4);
    for (const l of lines) expect(RULES.slice(l.start, l.end)).toBe(l.text);
  });

  it('merges overlapping marks and keeps their keys', () => {
    const segs = markedSegments('abcdefgh', [
      { start: 1, end: 4, keys: ['a01'] },
      { start: 3, end: 6, keys: ['a03'], className: 'is-active' },
      null,
    ]);
    expect(segs).toEqual([
      { text: 'a', mark: false },
      { text: 'bcdef', mark: true, className: 'is-active', keys: ['a01', 'a03'] },
      { text: 'gh', mark: false },
    ]);
  });

  it('clips ranges to lines and flags unused lines', () => {
    const a = findClause(RULES, 'founders about churn, activation or support load')!;
    const b = findClause(RULES, 'No asks to review a deck.')!;
    const view = readViewLines(RULES, [{ ...a, keys: ['a01'] }, b]);
    expect(view.map((l) => l.unused)).toEqual([false, true, true, false]);
    const marked = view[0]!.segments.filter((s) => s.mark).map((s) => s.text);
    expect(marked).toEqual(['founders about churn, activation or support load']);
  });
});
