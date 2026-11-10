import { describe, expect, it } from 'vitest';
import {
  capText,
  clampAnswerLines,
  exampleHref,
  fineText,
  normalizeAnswer,
  normalizeNote,
  offerHref,
  parseOfferQuery,
  resultHref,
  uiFromQuery,
  uiFromRecord,
  WHY_OPTIONS,
  WHY_TO_REASON,
  withoutLine,
  type OfferQuery,
} from '@/components/offer/model';
import { canonicalCard, cardFromLoop, clientSampleCard, loopForAsk, loopForPlayground, serverSampleCard, type SampleStores } from '@/components/offer/sample-loop';
import { askFacts } from '@/lib/oti/ask';
import { findClause, norm } from '@/lib/oti/clause';
import { SUGGESTED_EDIT_UNTESTED } from '@/lib/oti/copy';
import { sharesWords, suggestRuleEdit } from '@/lib/oti/rule-edits';
import type { PlaygroundStore, SampleAskStore } from '@/lib/oti/storage';
import { QA_STATES } from '@/lib/qa';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { PRESETS } from '@/lib/sample/presets';
import type { OfferView } from '@/lib/types';

const NOW = Date.parse('2026-11-10T17:00:00Z');
const NONE: SampleStores = { sampleAsk: null, sampleOffer: null, playground: null };
const q = (sp: Record<string, string>, qa = false): OfferQuery => parseOfferQuery(sp, qa);

function record(over: Partial<OfferView> = {}): OfferView {
  return {
    offer_id: 'o_3Fp9kL',
    state: 'pending',
    sample: false,
    title: 'Intro to a hospital procurement lead',
    subject: 'Intro to a hospital procurement lead',
    asker: { name: 'Maya Bennett', first: 'Maya', company: 'Oakline Health', stage: 'Seed', city: 'Chicago' },
    matched: { text: OFFER_SAMPLE.matched, start: 22, end: 98, line: 'Happy to talk to B2B founders selling to enterprise customers.' },
    rules_version: 3,
    topic: 'Enterprise sales, US',
    scheduling_url: 'https://cal.com/priya-shah/20min',
    facts: [...OFFER_SAMPLE.facts],
    cap: 2,
    nth: 1,
    offered_at: '2026-11-09T21:04:00-08:00',
    expires_at: '2026-11-12T21:04:00-08:00',
    responded_at: null,
    answer: null,
    no_reason: null,
    paused_until: null,
    ask_withdrawn_at: null,
    member_first: 'Priya',
    ...over,
  };
}

describe('the URL (GET renders, never changes anything)', () => {
  it('parses only known values; SAMPLE ask ids are validated; QA states only when QA is on', () => {
    expect(q({ choice: 'ok', done: 'nope', why: 'area', step: 'applied', ask: 'sa_eng' })).toMatchObject({ choice: 'ok', done: null, why: 'area', step: 'applied', ask: 'sa_eng', qa: null });
    expect(q({ ask: 'javascript:alert(1)' }).ask).toBeNull();
    expect(q({ ask: 'a07' }).ask).toBe('a07');
    expect(q({ ask: 'a13' }).ask).toBeNull();
    expect(q({ state: 'expired' }, false).qa).toBeNull();
    expect(q({ state: 'expired' }, true).qa).toBe('expired');
    expect(q({ state: 'nonsense' }, true).qa).toBeNull();
  });

  it('the email’s choice preselects: OK opens the confirm, Answer the composer, No moves the primary', () => {
    expect(uiFromQuery(q({ choice: 'ok' })).view).toBe('confirm');
    expect(uiFromQuery(q({ choice: 'answer' })).view).toBe('answer');
    expect(uiFromQuery(q({ choice: 'no' }))).toMatchObject({ view: 'open', nohint: true });
    expect(uiFromQuery(q({}))).toMatchObject({ view: 'open', nohint: false, failed: null });
  });

  it('SAMPLE results come from `done`, `why` and `step`', () => {
    expect(uiFromQuery(q({ done: 'ok' })).view).toBe('ok-sent');
    expect(uiFromQuery(q({ done: 'answer' })).view).toBe('answer-sent');
    expect(uiFromQuery(q({ done: 'no', why: 'area', step: 'applied' }))).toMatchObject({ view: 'no', why: 'area', step: 'applied' });
    expect(uiFromQuery(q({ done: 'no', step: 'applied' }))).toMatchObject({ view: 'no', why: null, step: null });
    expect(uiFromQuery(q({ choice: 'answer', error: 'input' }))).toMatchObject({ view: 'answer', failed: 'input' });
  });

  it('every prototype QA state renders a designed view', () => {
    const expected: Record<string, string> = {
      open: 'open',
      'confirm-ok': 'confirm',
      answer: 'answer',
      'ok-sent': 'ok-sent',
      'answer-sent': 'answer-sent',
      'no-done': 'no',
      'no-reason-diff': 'no',
      'no-reason-busy': 'no',
      'diff-applied': 'no',
      'already-acted': 'already-acted',
      expired: 'expired',
      withdrawn: 'withdrawn',
      'paused-member': 'open',
      invalid: 'invalid',
      'post-failed': 'open',
      sample: 'open',
    };
    for (const s of QA_STATES.offer) expect(uiFromQuery(q({ state: s }, true)).view, s).toBe(expected[s]);
    expect(uiFromQuery(q({ state: 'paused-member' }, true)).paused).toBe(true);
    expect(uiFromQuery(q({ state: 'post-failed' }, true)).failed).toBe('client');
    expect(uiFromQuery(q({ state: 'no-reason-busy' }, true)).why).toBe('busy');
    expect(uiFromQuery(q({ state: 'no-reason-diff', why: 'area' }, true)).why).toBe('area');
    expect(uiFromQuery(q({ state: 'diff-applied' }, true))).toMatchObject({ why: 'stage', step: 'applied' });
    expect(uiFromQuery(q({ state: 'already-acted', did: 'no' }, true)).did).toBe('no');
  });
});

describe('REAL: the offer’s state decides', () => {
  it('pending: open, preselected, paused, and past its deadline reads as expired', () => {
    expect(uiFromRecord(record(), q({ choice: 'ok' }), NOW).view).toBe('confirm');
    expect(uiFromRecord(record({ paused_until: '2026-12-01T08:00:00Z' }), q({}), NOW)).toMatchObject({ view: 'open', paused: true });
    expect(uiFromRecord(record({ paused_until: '2026-11-01T08:00:00Z' }), q({}), NOW).paused).toBe(false);
    expect(uiFromRecord(record({ expires_at: '2026-11-10T16:00:00Z' }), q({ choice: 'ok' }), NOW).view).toBe('expired');
    expect(uiFromRecord(record({ ask_withdrawn_at: '2026-11-10T12:00:00Z' }), q({}), NOW).view).toBe('withdrawn');
  });

  it('acted: “just did it” only right after the POST, “you did this before” on any later visit', () => {
    expect(uiFromRecord(record({ state: 'ok' }), q({ done: 'ok' }), NOW).view).toBe('ok-sent');
    expect(uiFromRecord(record({ state: 'ok' }), q({ choice: 'ok' }), NOW)).toMatchObject({ view: 'already-acted', did: 'ok' });
    expect(uiFromRecord(record({ state: 'answered' }), q({ done: 'answer' }), NOW).view).toBe('answer-sent');
    expect(uiFromRecord(record({ state: 'answered' }), q({}), NOW)).toMatchObject({ view: 'already-acted', did: 'answer' });
    expect(uiFromRecord(record({ state: 'passed' }), q({ done: 'no' }), NOW)).toMatchObject({ view: 'no', why: null });
    expect(uiFromRecord(record({ state: 'passed', no_reason: 'no_time' }), q({ done: 'no' }), NOW)).toMatchObject({ view: 'no', why: 'busy', step: null });
    expect(uiFromRecord(record({ state: 'passed' }), q({ done: 'no', why: 'area', step: 'applied' }), NOW)).toMatchObject({ why: 'area', step: 'applied' });
    expect(uiFromRecord(record({ state: 'passed' }), q({}), NOW)).toMatchObject({ view: 'already-acted', did: 'no' });
    // A URL can't fake a result: done=ok on a pending offer still shows the decision.
    expect(uiFromRecord(record(), q({ done: 'ok' }), NOW).view).toBe('open');
    expect(uiFromRecord(record({ state: 'expired' }), q({ done: 'ok' }), NOW).view).toBe('expired');
    expect(uiFromRecord(record({ state: 'withdrawn' }), q({}), NOW).view).toBe('withdrawn');
  });
});

describe('where POSTs land', () => {
  it('builds stable result URLs (303 targets) for SAMPLE, REAL and the QA example', () => {
    expect(offerHref('sample', { ask: 'sa_eng', choice: null })).toBe('/o/sample?ask=sa_eng');
    expect(resultHref('sample', { ask: 'sa_eng' }, { done: 'ok' })).toBe('/o/sample?ask=sa_eng&done=ok');
    expect(resultHref('3Fp9Kx7QmW2cAbCdEfGhIj', {}, { done: 'no', why: 'area', step: 'applied' })).toBe('/o/3Fp9Kx7QmW2cAbCdEfGhIj?done=no&why=area&step=applied');
    expect(resultHref('o_3Fp9kL', {}, { choice: 'ok', error: 'server' })).toBe('/o/o_3Fp9kL?choice=ok&error=server');
    expect(exampleHref('demo', { done: 'ok' })).toBe('/o/demo?state=ok-sent');
    expect(exampleHref('demo', { done: 'no', why: 'stage', step: 'applied' })).toBe('/o/demo?state=diff-applied&why=stage');
    expect(exampleHref('demo', { done: 'no', why: 'busy', step: 'cap' })).toBe('/o/demo?state=no-reason-busy&step=cap');
    expect(exampleHref('demo', { done: 'no', why: 'vague' })).toBe('/o/demo?state=no-done&why=vague');
    expect(exampleHref('demo', { choice: 'ok', error: 'server' })).toBe('/o/demo?state=post-failed&choice=ok');
  });
});

describe('the 2-line answer and the private note', () => {
  it('keeps at most 2 line breaks and 280 characters', () => {
    expect(clampAnswerLines('a\nb\nc\nd\ne')).toBe('a\nb\nc d e');
    expect(normalizeAnswer('  Ask for the technical annex.\r\nThat’s where pilots stall.  ')).toBe('Ask for the technical annex.\nThat’s where pilots stall.');
    expect(normalizeAnswer('   ')).toBeNull();
    expect(normalizeAnswer('x'.repeat(281))).toBeNull();
    expect(normalizeAnswer('x'.repeat(280))).toHaveLength(280);
    expect(normalizeAnswer(42)).toBeNull();
    expect(normalizeNote('  not  now ')).toBe('not now');
    expect(normalizeNote('x'.repeat(141))).toBeNull();
  });
});

describe('the card copy', () => {
  it('fine print and cap usage, first names, never pronouns', () => {
    const c = canonicalCard();
    expect(fineText(c)).toBe('Maya sees your name only if you choose OK. A No is private. This counts as 1 of your 2 whatever you answer.');
    expect(capText(c)).toBe('1 of your 2 this month');
    expect(fineText({ ...c, who: 'the founder' }).startsWith('The founder sees your name')).toBe(true);
    expect(c.facts.map(([k]) => k)).toEqual(['Problem', 'Needs', 'Tried', 'By', 'Offers', 'Price']);
  });
});

describe('the SAMPLE loop (/o/sample?ask=…, ?from=playground)', () => {
  it('a known sample id without a tab renders the canonical sample ask, quoting the visitor’s preset words', () => {
    const loop = loopForAsk('sa_eng', NONE, NOW);
    expect(loop).not.toBeNull();
    const card = cardFromLoop(loop!);
    expect(card.title).toBe('Churn after month 3: a 20-minute call');
    expect(card.from).toBe('Sample founder · Tidewell Data · Seed · San Francisco');
    expect(card.facts[0]?.[0]).toBe('Problem');
    expect(card.facts.find(([k]) => k === 'Needs')?.[1]).toBe('20 minutes with someone who has cut early churn in a B2B product');
    const rules = PRESETS.find((p) => p.id === 'engineer')!.rules;
    expect(findClause(rules, card.matched!)).not.toBeNull();
    expect(card.who).toBe('the founder');
  });

  it('the tab wins: the ask exactly as sent, who held it, and the clock from the offer time', () => {
    const st: SampleAskStore = {
      v: 1,
      id: 'sa_eng',
      preset: 'engineer',
      state: 'offered',
      offered_to: 'm-7f2a',
      question: null,
      answered: null,
      sent_at: NOW - 3 * 3_600_000,
      offered_at: NOW - 2 * 3_600_000,
      compiled: { parts: { challenge: 'Accounts leave after month 3', tried: 'A check-in call', needs: 'Someone who cut early churn', by: 'Nov 21', offers: 'Our notes' }, subject: 'Accounts leave at month 3, 20 min?', text: 'x', price: null, topic: 'Churn' },
      you_cited: [],
    };
    const live = clientSampleCard({ kind: 'ask', id: 'sa_eng' }, { ...NONE, sampleAsk: st }, NOW);
    expect(live?.card.title).toBe('Accounts leave at month 3');
    expect(live?.card.matched).toBe('Happy to talk about churn and retention in B2B software');
    expect(live?.card).toMatchObject({ cap: 2, nth: 2 });
    expect(live?.hours).toBe(70);
    expect(live?.loop.member.name).toBe('Hannah Kim');
  });

  it('a custom sample id needs the tab; without it the page falls back to the canonical sample', () => {
    expect(loopForAsk('sa_x7Kq2m', NONE, NOW)).toBeNull();
    expect(serverSampleCard({ kind: 'ask', id: 'sa_x7Kq2m' }, NOW).card.title).toBe(OFFER_SAMPLE.title);
  });

  it('?from=playground builds the card from the top “Reaches you” row, in the visitor’s own words', () => {
    const pg: PlaygroundStore = {
      v: 1,
      preset: 'engineer',
      rules: PRESETS[0]!.rules,
      cap: 2,
      edited: false,
      run_id: 'r_1',
      ran_at: null,
      mode: 'recorded',
      run_rules: PRESETS[0]!.rules,
      results: [
        { ask_id: 'a02', display: 'decline', cited: [] },
        { ask_id: 'a03', display: 'reach', cited: ['founders about churn, activation or support load'] },
      ],
      marks: [],
    };
    const loop = loopForPlayground({ ...NONE, playground: pg }, NOW);
    expect(loop?.askId).toBe('a03');
    const card = cardFromLoop(loop!);
    expect(card.from).toBe('Tallow AI · Seed · Austin');
    expect(card.matched).toBe('founders about churn, activation or support load');
    expect(loopForPlayground(NONE, NOW)).toBeNull();
  });
});

describe('the templated rule edit after a No, tested on the 12 sample asks', () => {
  // For every preset (a member's rules) and every one of the 12 sample asks, the edit for “Not my area” and
  // “Wrong stage” must be additive, name no company, copy no 6 consecutive words of the ask, and never repeat a line.
  const cases = PRESETS.flatMap((p) => SAMPLE_ASKS.map((a) => ({ p, a })));

  it(`covers ${cases.length} member × ask pairs`, () => {
    expect(cases).toHaveLength(36);
  });

  it.each(cases)('$p.id × $a.id ($a.company)', ({ p, a }) => {
    const facts = askFacts(a.parts);
    const askText = facts.map(([, v]) => v).join(' ');
    for (const reason of ['not_my_area', 'wrong_stage'] as const) {
      const edit = suggestRuleEdit(reason, { rules: p.rules, matchedLine: p.rules.split('\n')[0] ?? null, topic: a.topic, askText, companies: [a.company] });
      if (!edit) continue;
      expect(edit.add).toMatch(/^[A-Z].*\.$/);
      expect(norm(p.rules)).not.toContain(norm(edit.add).replace(/\.$/, ''));
      expect(norm(edit.add)).not.toContain(norm(a.company));
      expect(sharesWords(edit.add, askText, 6)).toBe(false);
      expect(edit.add.split('\n')).toHaveLength(1);
      if (edit.context) expect(p.rules.split('\n').map((l) => l.trim())).toContain(edit.context);
      // Applying it is one appended line; undoing it restores the rules exactly.
      const applied = `${p.rules}\n${edit.add}`;
      expect(withoutLine(applied, edit.add)).toBe(p.rules);
      // Once applied it isn't suggested again.
      expect(suggestRuleEdit(reason, { rules: applied, matchedLine: null, topic: a.topic, askText, companies: [a.company] })).toBeNull();
    }
  });

  it('only the reasons that map to a rule suggest a line', () => {
    const ctx = { rules: PRESETS[1]!.rules, matchedLine: null, topic: 'Enterprise sales, US', askText: 'x', companies: ['Oakline Health'] };
    expect(suggestRuleEdit('not_my_area', ctx)?.add).toBe('No asks about enterprise sales.');
    expect(suggestRuleEdit('wrong_stage', ctx)?.add).toBe('Only after a first paying customer.');
    for (const r of ['not_specific', 'no_time', 'other'] as const) expect(suggestRuleEdit(r, ctx)).toBeNull();
    expect(WHY_OPTIONS.map(([k]) => WHY_TO_REASON[k])).toEqual(['not_my_area', 'wrong_stage', 'not_specific', 'no_time', 'other']);
  });

  it('labels hand-written expectations as such; REAL edits say they were not run', () => {
    for (const e of Object.values(OFFER_SAMPLE.suggested_edits)) {
      expect(e.expected.startsWith('Expected on the 12 sample asks (written by hand, not a model run):')).toBe(true);
      expect(PRESETS[1]!.rules.split('\n')).toContain(e.context);
    }
    expect(SUGGESTED_EDIT_UNTESTED).not.toMatch(/tested on/i);
  });
});
