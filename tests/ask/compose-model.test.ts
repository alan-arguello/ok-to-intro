import { describe, expect, it } from 'vitest';
import {
  checkingRows,
  compiledAskOf,
  composeReducer,
  exampleRows,
  initialCompose,
  isReady,
  isResolved,
  looksVague,
  manualRows,
  openSuggestions,
  partsHead,
  partTag,
  rowFromCompiled,
  sampleAnswers,
  sampleKindOf,
  subjectFromChallenge,
  suggestedFrom,
  textProblem,
  unresolvedCount,
  withEdit,
  type ComposeState,
} from '@/components/ask/compose-model';
import { validateAsk } from '@/lib/oti/ask';
import { codeRefusal } from '@/lib/server/compiler';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import type { CompiledPart, PresetId } from '@/lib/types';

const PRESETS: PresetId[] = ['engineer', 'health', 'founder'];

function compiled(preset: PresetId): ComposeState {
  const sa = SAMPLE_NETWORK_ASKS[preset];
  return composeReducer(initialCompose('sample', sa.partial), { type: 'checkExample', text: sa.partial, rows: exampleRows(sa, 'partial'), subject: sa.subject, topic: null });
}

describe('example compile results (the sample chips, hand-written)', () => {
  it.each(PRESETS)('%s: found parts are the founder’s own words, suggestions cite real phrases', (preset) => {
    const sa = SAMPLE_NETWORK_ASKS[preset];
    const rows = exampleRows(sa, 'partial');
    expect(rows.map((r) => r.key)).toEqual(['challenge', 'tried', 'needs', 'by', 'offers']);
    for (const r of rows.filter((x) => x.state === 'found')) expect(sa.partial).toContain(r.text);
    const suggested = sa.compiledPartial.find((p) => p.state === 'suggested');
    for (const phrase of suggested?.from ?? []) expect(sa.partial).toContain(phrase);
    // Only “who you need” is ever suggested; facts are never invented, they become questions.
    expect(rows.filter((r) => r.state === 'suggested').map((r) => r.key)).toEqual(['needs']);
    expect(rows.filter((r) => r.state === 'missing').every((r) => r.question.endsWith('?') && !!r.sample)).toBe(true);
  });

  it.each(PRESETS)('%s: the Complete chip finds all 5 parts as exact spans of its text', (preset) => {
    const sa = SAMPLE_NETWORK_ASKS[preset];
    const rows = exampleRows(sa, 'complete');
    expect(rows.every((r) => r.state === 'found')).toBe(true);
    for (const r of rows) expect(sa.complete).toContain(r.text);
  });

  it.each(PRESETS)('%s: partial + suggestions + sample answers assemble the complete sample text', (preset) => {
    const sa = SAMPLE_NETWORK_ASKS[preset];
    const ready = composeReducer(compiled(preset), { type: 'useAll' });
    expect(isReady(ready)).toBe(true);
    const ask = compiledAskOf(ready);
    expect(ask?.text).toBe(sa.complete);
    expect(ask?.subject).toBe(sa.subject);
    expect(validateAsk(ready.text, ask)).toEqual({ ok: true });
  });

  it('sample answers are the complete ask’s own words', () => {
    const sa = SAMPLE_NETWORK_ASKS.engineer;
    expect(sampleAnswers(sa)).toEqual({
      challenge: 'Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows',
      tried: 'monthly partitions and a read replica',
      needs: 'someone who has run Postgres past 100M rows',
      by: 'Nov 21',
      offers: 'our load-test harness',
    });
  });
});

describe('sample text detection', () => {
  it('matches a chip’s text whatever the spacing, and nothing else', () => {
    const sa = SAMPLE_NETWORK_ASKS.health;
    expect(sampleKindOf(sa.vague, sa)).toBe('vague');
    expect(sampleKindOf(`  ${sa.partial.replace(/ /g, '   ')}\n`, sa)).toBe('partial');
    expect(sampleKindOf(sa.complete, sa)).toBe('complete');
    // Any other change is the founder's own text: the compiler and live gates decide it (BE2 applies the same test).
    expect(sampleKindOf(sa.partial.toUpperCase(), sa)).toBeNull();
    expect(sampleKindOf(`${sa.partial} We charge $18k.`, sa)).toBeNull();
    expect(sampleKindOf('', sa)).toBeNull();
    expect(sampleKindOf(SAMPLE_NETWORK_ASKS.engineer.partial, sa)).toBeNull();
  });
});

describe('the parts list', () => {
  it('head counts each state like the prototype', () => {
    const s = compiled('engineer');
    expect(partsHead(s.parts)).toBe('5 parts · 2 found · 1 suggested · 2 missing');
    expect(openSuggestions(s.parts)).toBe(3);
    expect(unresolvedCount(s.parts)).toBe(3);
    const used = composeReducer(s, { type: 'partUse', i: 2 });
    expect(partsHead(used.parts)).toBe('5 parts · 2 found · 1 approved · 2 missing');
    const typed = composeReducer(used, { type: 'partInput', i: 3, value: 'Dec 1' });
    expect(partsHead(typed.parts)).toBe('5 parts · 2 found · 1 approved · 1 added · 1 missing');
    expect(partsHead(checkingRows())).toBe('5 parts · 5 checking');
  });

  it('tags: found, approved, suggested (outline), added, missing (outline), checking', () => {
    const rows = exampleRows(SAMPLE_NETWORK_ASKS.engineer, 'partial');
    expect(rows.map((r) => partTag(r))).toEqual([
      { kind: 'tag', outline: false, text: '✓ found' },
      { kind: 'tag', outline: false, text: '✓ found' },
      { kind: 'tag', outline: true, text: 'suggested' },
      { kind: 'tag', outline: true, text: 'missing' },
      { kind: 'tag', outline: true, text: 'missing' },
    ]);
    expect(partTag(checkingRows()[0]!)).toEqual({ kind: 'checking' });
    expect(partTag({ ...rows[3]!, value: 'Nov 21' })).toEqual({ kind: 'tag', outline: false, text: '✓ added' });
  });

  it('Edit turns a suggestion into an input holding it; Use approves it', () => {
    const s = compiled('engineer');
    const edited = composeReducer(s, { type: 'partEdit', i: 2 });
    expect(edited.parts?.[2]).toMatchObject({ state: 'editing', value: 'someone who has run Postgres past 100M rows' });
    expect(isResolved(edited.parts![2]!)).toBe(true);
    const cleared = composeReducer(edited, { type: 'partInput', i: 2, value: '  ' });
    expect(isResolved(cleared.parts![2]!)).toBe(false);
  });

  it('a live part shows the founder’s own words at the offsets code found', () => {
    const text = 'We sell to clinics. Tried 3 pilots. Need a buyer.';
    const found: CompiledPart = { key: 'tried', state: 'found', text: 'TRIED 3 PILOTS (model copy)', source: [{ text: 'Tried 3 pilots', found: true, start: 20, end: 34 }], question: null };
    expect(rowFromCompiled(found, text)).toMatchObject({ state: 'found', text: 'Tried 3 pilots', note: 'your text' });
    const suggested: CompiledPart = { key: 'needs', state: 'suggested', text: 'someone who buys for clinics', source: [{ text: 'clinics', found: true, start: 11, end: 18 }], question: null };
    expect(rowFromCompiled(suggested, text)).toMatchObject({ state: 'suggested', note: 'suggested from “clinics”' });
    const missing: CompiledPart = { key: 'by', state: 'missing', text: '', source: [], question: null };
    expect(rowFromCompiled(missing, text)).toMatchObject({ state: 'missing', question: 'By when do you need this?', value: '' });
  });

  it('suggestedFrom joins quoted phrases', () => {
    expect(suggestedFrom(['writes still block', '40M rows'])).toBe('suggested from “writes still block” and “40M rows”');
    expect(suggestedFrom([])).toBe('suggested');
  });
});

describe('the compose reducer', () => {
  it('editing the text after a check marks the parts stale until the next check', () => {
    const s = composeReducer(compiled('engineer'), { type: 'useAll' });
    expect(isReady(s)).toBe(true);
    const stale = composeReducer(s, { type: 'text', text: `${s.text} More.` });
    expect(stale.stale).toBe(true);
    expect(isReady(stale)).toBe(false);
    expect(stale.notes.map((n) => n.key)).toContain('stale');
    const again = composeReducer(stale, { type: 'checkStart', text: stale.text });
    expect(again.stale).toBe(false);
    expect(again.notes.map((n) => n.key)).not.toContain('stale');
    expect(again.phase).toBe('compiling');
  });

  it('a refusal clears the parts and shows one notice', () => {
    const s = composeReducer(compiled('engineer'), { type: 'checkRefused', kind: 'vague', text: 'x' });
    expect(s.parts).toBeNull();
    expect(s.phase).toBe('compose');
    expect(s.notes).toEqual([{ key: 'refused', kind: 'vague' }]);
  });

  it('compiler down: parts already found stay, the rest become inputs, and the subject follows the challenge', () => {
    const text = 'Our checkout drops 4% of card payments at 3DS. Tried two processors.';
    let s = composeReducer(initialCompose('sample', text), { type: 'checkStart', text });
    s = composeReducer(s, { type: 'checkPart', i: 1, row: { key: 'tried', state: 'found', text: 'Tried two processors', note: 'your text', question: '', value: '', sample: null } });
    s = composeReducer(s, { type: 'checkDown', kind: 'down', until: null, samples: null, subject: null, text });
    expect(s.source).toBe('manual');
    expect(s.parts?.map((p) => p.state)).toEqual(['missing', 'found', 'missing', 'missing', 'missing']);
    expect(s.notes).toEqual([{ key: 'down', kind: 'down', until: null }]);
    s = composeReducer(s, { type: 'partInput', i: 0, value: 'Checkout drops 4% of card payments at 3DS' });
    expect(s.subject).toBe('Checkout drops 4% of card payments, 20 min?');
    s = composeReducer(s, { type: 'subject', value: 'Card payments failing at 3DS, 20 min?' });
    s = composeReducer(s, { type: 'partInput', i: 0, value: 'Something else entirely' });
    expect(s.subject).toBe('Card payments failing at 3DS, 20 min?');
  });

  it('what the founder typed by hand survives a new check that still can’t reach the compiler', () => {
    const text = 'Our checkout drops 4% of card payments at 3DS. Tried two processors.';
    let s = composeReducer(initialCompose('sample', text), { type: 'checkDown', kind: 'off', until: null, samples: null, subject: null, text });
    s = composeReducer(s, { type: 'partInput', i: 0, value: 'Checkout drops 4% of card payments at 3DS' });
    s = composeReducer(s, { type: 'partInput', i: 3, value: 'Dec 4' });
    s = composeReducer(s, { type: 'subject', value: 'Card payments failing at 3DS, 20 min?' });
    // A typo fixed in the main text: stale, then Check again (live off: straight back to the manual form).
    s = composeReducer(s, { type: 'text', text: `${text} ` });
    expect(s.stale).toBe(true);
    let again = composeReducer(s, { type: 'checkDown', kind: 'off', until: null, samples: null, subject: null, text: `${text} ` });
    expect(again.parts!.map((p) => p.value)).toEqual(['Checkout drops 4% of card payments at 3DS', '', '', 'Dec 4', '']);
    expect(again.subject).toBe('Card payments failing at 3DS, 20 min?');
    expect(again.stale).toBe(false);
    // The same through a live attempt that fails (the API was down): the CHECKING rows give way to the typed parts.
    again = composeReducer(s, { type: 'checkStart', text });
    expect(again.parts!.every((p) => p.state === 'checking')).toBe(true);
    again = composeReducer(again, { type: 'checkDown', kind: 'down', until: null, samples: null, subject: null, text });
    expect(again.parts!.map((p) => p.value)).toEqual(['Checkout drops 4% of card payments at 3DS', '', '', 'Dec 4', '']);
    expect(again.manual).toBeNull();
    // A sample chip starts over.
    expect(composeReducer(s, { type: 'fill', text: 'x' }).manual).toBeNull();
  });

  it('manual rows keep the sample answers for “Use sample answer”', () => {
    const rows = manualRows(null, sampleAnswers(SAMPLE_NETWORK_ASKS.founder));
    expect(rows.every((r) => r.state === 'missing' && !!r.sample)).toBe(true);
    expect(openSuggestions(rows)).toBe(5);
  });

  it('send failures keep the ask and say why', () => {
    const s = composeReducer(composeReducer(compiled('engineer'), { type: 'sendStart' }), { type: 'sendFailed', note: { key: 'offline' } });
    expect(s.sending).toBe(false);
    expect(s.notes.map((n) => n.key)).toEqual(['offline']);
  });

  it('text limits', () => {
    expect(textProblem('   ')).toBe('empty');
    expect(textProblem('x'.repeat(601))).toBe('over');
    expect(textProblem('x'.repeat(600))).toBeNull();
  });
});

describe('subjects written by code from the founder’s challenge', () => {
  it.each([
    // Cut on a word boundary to fit “, 20 min?” in 45 characters (the prototype's rule); the founder can edit it.
    ['Our Postgres p95 went from 40 ms to 900 ms past 40M rows', 'Postgres p95 went from 40 ms to 900, 20 min?'],
    ['We need a first engineer', 'Need a first engineer, 20 min?'],
    ['Checkout drops 4% of card payments at 3DS', 'Checkout drops 4% of card payments, 20 min?'],
    ['', ''],
  ])('%s → %s', (challenge, subject) => {
    const s = subjectFromChallenge(challenge);
    expect(s).toBe(subject);
    expect(s.length).toBeLessThanOrEqual(45);
  });
});

describe('“Use this edit” inserts the one true sentence after the line it extends', () => {
  it('adds the workload number after “writes still block.”', () => {
    const sa = SAMPLE_NETWORK_ASKS.engineer;
    const text = withEdit(sa.complete, sa.noMatchEdit);
    expect(text).toContain('writes still block. Our events table takes 2k writes/s at peak. Need 20 minutes');
  });
  it('appends when the context isn’t in the text', () => {
    expect(withEdit('Something else.', { context: 'Not here at all, really.', add: 'Added.' })).toBe('Something else. Added.');
  });
});

describe('the vague rule the page runs while live checks are off', () => {
  it('agrees with the compiler’s own code refusal (BE1 codeRefusal) on every case', () => {
    const texts = [
      ...PRESETS.flatMap((p) => [SAMPLE_NETWORK_ASKS[p].vague, `  ${SAMPLE_NETWORK_ASKS[p].vague.toUpperCase()}  `, SAMPLE_NETWORK_ASKS[p].partial, SAMPLE_NETWORK_ASKS[p].complete]),
      'Need help please',
      'Need intros to investors',
      'Need intros to investors in Pacific time soon',
      'Our checkout drops 4% of card payments at 3DS. Tried two processors.',
      'one two three four five',
      'one two three four five six',
      '',
    ];
    for (const t of texts) expect(looksVague(t), t).toBe(codeRefusal(t) === 'vague');
  });
});
