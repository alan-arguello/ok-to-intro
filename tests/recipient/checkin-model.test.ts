import { describe, expect, it } from 'vitest';
import {
  answerText,
  answerValue,
  checkinHref,
  checkinValue,
  parseCheckinQuery,
  sampleCheckinKeep,
  saveLabel,
  savedQaState,
  toAnswer,
  uiFromQuery,
  uiFromRecord,
  type CheckinQuery,
} from '@/components/checkin/model';
import { checkinQuestion } from '@/lib/emails';
import { QA_STATES } from '@/lib/qa';
import type { CheckinView } from '@/lib/types';

const NOW = Date.parse('2026-11-11T15:00:00Z');
const q = (sp: Record<string, string>, qa = false): CheckinQuery => parseCheckinQuery(sp, qa);

function view(over: Partial<CheckinView> = {}): CheckinView {
  return {
    checkin_id: 'c_88aB',
    kind: 'd1',
    role: 'asker',
    sample: false,
    other_name: 'Ana Ruiz',
    other_first: 'Ana',
    intro_subject: 'Hospital procurement in Mexico, 20 min?',
    intro_made_at: '2026-11-09T21:16:00-06:00',
    answer: null,
    answered_at: null,
    closes_at: '2026-12-09T10:00:00-06:00',
    reminder_at: null,
    ...over,
  };
}

describe('values, answers and labels', () => {
  it('accepts only values that fit the kind', () => {
    expect(checkinValue('4', 'd1')).toBe('4');
    expect(checkinValue('wont', 'd1')).toBe('wont');
    expect(checkinValue('customer', 'd1')).toBeNull();
    expect(checkinValue('6', 'd1')).toBeNull();
    expect(checkinValue('nothing', 'd14')).toBe('nothing_yet');
    expect(checkinValue('4', 'd14')).toBeNull();
  });

  it('maps a POST to the CheckinAnswer BE2 records', () => {
    expect(toAnswer('d1', '4', null, null)).toEqual({ kind: 'd1', rating: 4 });
    expect(toAnswer('d1', 'notyet', 'timing', null)).toEqual({ kind: 'd1', not_yet: true });
    expect(toAnswer('d1', 'wont', 'wrong_person', null)).toEqual({ kind: 'd1', wont_happen: true, reason: 'wrong_person' });
    expect(toAnswer('d1', 'wont', 'bogus', null)).toEqual({ kind: 'd1', wont_happen: true, reason: null });
    expect(toAnswer('d14', 'customer', null, '  signed   a pilot ')).toEqual({ kind: 'd14', outcome: 'customer', note: 'signed a pilot' });
    expect(toAnswer('d14', 'hire', null, 'x'.repeat(200))?.kind).toBe('d14');
    expect(toAnswer('d1', null, null, null)).toBeNull();
    expect(answerValue({ kind: 'd1', rating: 5 })).toBe('5');
    expect(answerValue({ kind: 'd14', outcome: 'investor', note: null })).toBe('investor');
  });

  it('uses the spec’s words', () => {
    expect(saveLabel('d1', '4')).toBe('Save: 4 of 5');
    expect(saveLabel('d1', 'notyet')).toBe('Save: not yet');
    expect(saveLabel('d1', 'wont')).toBe('Save: won’t happen');
    expect(saveLabel('d14', 'customer')).toBe('Save');
    expect(answerText('d1', '4')).toBe('4 of 5');
    expect(answerText('d1', 'notyet')).toBe('we haven’t talked yet');
    expect(answerText('d14', 'customer')).toBe('A customer');
    expect(checkinQuestion('d1', 'asker', 'Ana')).toBe('How useful was the call with Ana?');
    expect(checkinQuestion('d1', 'member', 'Lucía')).toBe('Was the call with Lucía worth your 20 minutes?');
    expect(checkinQuestion('d14', 'asker', 'Ana')).toBe('What came of the intro to Ana?');
  });
});

describe('SAMPLE and QA: the URL is the state', () => {
  it('preselects from `v`, defaulting like the prototype; `done` shows the result; `change` the form again', () => {
    expect(uiFromQuery(q({}))).toMatchObject({ view: 'form', kind: 'd1', role: 'asker', value: '4' });
    expect(uiFromQuery(q({ v: '2', role: 'member' }))).toMatchObject({ view: 'form', role: 'member', value: '2' });
    expect(uiFromQuery(q({ kind: '14d' }))).toMatchObject({ kind: 'd14', value: 'customer' });
    expect(uiFromQuery(q({ v: 'wont', why: 'timing' }))).toMatchObject({ value: 'wont', reason: 'timing' });
    expect(uiFromQuery(q({ v: '5', why: 'timing' })).reason).toBeNull();
    expect(uiFromQuery(q({ done: '1', v: '5' }))).toMatchObject({ view: 'saved', value: '5' });
    expect(uiFromQuery(q({ done: '1', change: '1' })).view).toBe('form');
    expect(uiFromQuery(q({ error: 'input' })).failed).toBe('input');
  });

  it('every prototype QA state renders a designed view', () => {
    const expected: Record<string, string> = {
      'd1-preselected': 'form',
      'd1-saved': 'saved',
      'd1-notyet': 'saved',
      'd1-wont': 'saved',
      'member-d1': 'form',
      'd14-preselected': 'form',
      'd14-saved': 'saved',
      'already-answered': 'already',
      closed: 'closed',
      invalid: 'invalid',
      'save-failed': 'form',
    };
    for (const s of QA_STATES.checkin) expect(uiFromQuery(q({ state: s }, true)).view, s).toBe(expected[s]);
    expect(uiFromQuery(q({ state: 'member-d1' }, true)).role).toBe('member');
    expect(uiFromQuery(q({ state: 'd14-saved' }, true)).kind).toBe('d14');
    expect(uiFromQuery(q({ state: 'd1-notyet' }, true)).value).toBe('notyet');
    expect(uiFromQuery(q({ state: 'save-failed' }, true)).failed).toBe('client');
    expect(uiFromQuery(q({ state: 'already-answered', kind: '14d' }, true))).toMatchObject({ kind: 'd14', value: 'customer' });
  });

  it('a POST on the QA example lands on the prototype’s saved state', () => {
    expect(savedQaState('d1', 'asker', '4')).toBe('d1-saved');
    expect(savedQaState('d1', 'member', 'wont')).toBe('d1-saved');
    expect(savedQaState('d1', 'asker', 'wont')).toBe('d1-wont');
    expect(savedQaState('d1', 'member', 'notyet')).toBe('d1-notyet');
    expect(savedQaState('d14', 'asker', 'hire')).toBe('d14-saved');
  });

  it('SAMPLE links keep the loop’s ask, the kind and the role', () => {
    const query = q({ ask: 'sa_eng', role: 'member' });
    expect(sampleCheckinKeep(query, uiFromQuery(query))).toEqual({ ask: 'sa_eng', who: 'member' });
    // “Change” keeps the form open across the options' links.
    const change = q({ kind: '14d', change: '1', v: 'hire' });
    expect(sampleCheckinKeep(change, uiFromQuery(change))).toEqual({ kind: '14d', change: '1' });
    expect(uiFromQuery(q({ done: '1', change: '1', v: '3' })).view).toBe('form');
    expect(checkinHref('sample', { ask: 'sa_eng', who: 'member', v: '4', why: null })).toBe('/c/sample?ask=sa_eng&who=member&v=4');
    expect(q({ ask: '"><script>' }).ask).toBeNull();
  });
});

describe('REAL: the check-in decides', () => {
  it('unanswered: the form, preselected from the email', () => {
    expect(uiFromRecord(view(), q({ v: '5' }), NOW)).toMatchObject({ view: 'form', value: '5' });
    expect(uiFromRecord(view(), q({}), NOW)).toMatchObject({ view: 'form', value: null });
    expect(uiFromRecord(view({ kind: 'd14' }), q({ v: '4' }), NOW).value).toBeNull();
  });

  it('answered: “You answered on …” with (Change); `change=1` reopens it with the saved answer', () => {
    const a = view({ answer: { kind: 'd1', rating: 4 }, answered_at: '2026-11-10T10:00:00-06:00' });
    expect(uiFromRecord(a, q({}), NOW)).toMatchObject({ view: 'already', value: '4' });
    expect(uiFromRecord(a, q({ change: '1' }), NOW)).toMatchObject({ view: 'form', value: '4' });
    expect(uiFromRecord(a, q({ change: '1', v: '2' }), NOW)).toMatchObject({ view: 'form', value: '2' });
    expect(uiFromRecord(a, q({ done: '1' }), NOW)).toMatchObject({ view: 'saved', value: '4' });
    const w = view({ answer: { kind: 'd1', wont_happen: true, reason: 'timing' } });
    expect(uiFromRecord(w, q({}), NOW)).toMatchObject({ view: 'already', value: 'wont', reason: 'timing' });
  });

  it('a closed window reads closed, answered or not', () => {
    expect(uiFromRecord(view({ closes_at: '2026-11-11T14:00:00Z' }), q({ v: '4' }), NOW).view).toBe('closed');
    expect(uiFromRecord(view({ closes_at: '2026-11-11T14:00:00Z', answer: { kind: 'd1', rating: 3 } }), q({}), NOW).view).toBe('closed');
  });
});
