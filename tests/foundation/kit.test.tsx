import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Bar, Button, Cap, Clause, Diff, Facts, Notice, OfferCard, RadioGroup, RulesReadView, Verdict, Waffle } from '@/components/kit';
import { findClause } from '@/lib/oti/clause';
import { OFFER_SAMPLE, PRESETS } from '@/lib/sample';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('kit markup matches prototype/kit.html', () => {
  it('buttons: primary pill with the ⌘↵ hint hidden from the accessible name', () => {
    const out = html(
      <Button variant="primary" size="lg" primary kbd>
        Run 12 sample asks
      </Button>,
    );
    expect(out).toContain('class="btn btn--primary btn--lg"');
    expect(out).toContain('data-primary=""');
    expect(out).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"');
    expect(out).toContain('<span class="kbd" aria-hidden="true" data-k="">⌘↵</span>');
  });

  it('verdict pills use the kit words', () => {
    expect(html(<Verdict kind="reach" />)).toBe('<span class="verdict verdict--reach">Reaches you</span>');
    expect(html(<Verdict kind="code" />)).toBe('<span class="verdict verdict--code">Declined by code</span>');
    expect(html(<Verdict kind="nothistime" />)).toBe('<span class="verdict verdict--nothistime">Not this time</span>');
  });

  it('cap squares: orange for used, labelled when standalone, hidden next to text', () => {
    expect(html(<Cap cap={2} used={1} />)).toBe('<span class="cap" role="img" aria-label="1 of 2 used"><i class="is-used"></i><i></i></span>');
    expect(html(<Cap cap={2} used={2} hidden />)).toBe('<span class="cap" aria-hidden="true"><i class="is-used"></i><i class="is-used"></i></span>');
  });

  it('clauses are the member’s words in curly quotes; a rejected quote is struck', () => {
    expect(html(<Clause>No asks to review a deck.</Clause>)).toBe('<span class="clause">“No asks to review a deck.”</span>');
    expect(html(<Clause missing>Happy to take any intro</Clause>)).toBe('<span class="clause clause--missing">“Happy to take any intro”</span>');
  });

  it('the offer card keeps its order and puts Problem first', () => {
    const out = html(
      <OfferCard
        label="What a member sees"
        kicker="Ask for you"
        title={OFFER_SAMPLE.title}
        from="Maya Bennett · Oakline Health · Seed · Chicago"
        match="Matched your rule"
        fine="Maya sees your name only if you choose OK."
        facts={[...OFFER_SAMPLE.facts].reverse()}
      />,
    );
    const order = ['offer-card__kicker', 'offer-card__title', 'offer-card__from', 'offer-card__match', 'offer-card__fine', 'class="facts"'].map((s) => out.indexOf(s));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    const labels = [...out.matchAll(/<dt>(\w+)<\/dt>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Problem', 'Needs', 'Tried', 'By', 'Offers', 'Price']);
  });

  it('diffs carry screen-reader prefixes', () => {
    const out = html(<Diff label="Suggested change to your rules" lines={[{ kind: 'ctx', text: 'a' }, { kind: 'add', text: 'b' }, { kind: 'del', text: 'c' }]} />);
    expect(out).toContain('<span class="d-add"><span class="sr-only">Add: </span>b</span>');
    expect(out).toContain('<span class="d-del"><span class="sr-only">Remove: </span>c</span>');
  });

  it('radiogroups have one tab stop on the checked option', () => {
    const out = html(<RadioGroup variant="seg" labelledBy="lbl-cap" value="2" onChange={() => undefined} options={['1', '2', '3'].map((v) => ({ value: v, label: v }))} />);
    expect(out).toContain('class="seg" role="radiogroup" aria-labelledby="lbl-cap"');
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain('role="radio" aria-checked="true" tabindex="0" data-value="2"');
  });

  it('the read view marks exactly the found span', () => {
    const rules = PRESETS[0]!.rules;
    const r = findClause(rules, 'No asks to review a deck.');
    const out = html(<RulesReadView rules={rules} ranges={[r]} tallies={['', '', '', '1 kept out']} />);
    expect(out).toContain('<mark class="mark">No asks to review a deck.</mark><span class="tally">1 kept out</span>');
    expect(out.match(/class="is-unused"/g)).toHaveLength(3);
  });

  it('the waffle is an image with its counts; the bar pads the body without JS', () => {
    expect(html(<Waffle label="40 members: 1 offered" cells={[{ state: 'offered', you: true }, { state: 'next' }]} />)).toBe(
      '<div class="waffle" role="img" aria-label="40 members: 1 offered"><span class="cell cell--offered cell--you">you</span><span class="cell cell--next">✓</span></div>',
    );
    expect(html(<Bar text="2 reach you">x</Bar>)).toContain('class="bar bar--phone" data-has-bar=""');
    expect(html(<Bar stack>x</Bar>)).toContain('data-has-bar="lg"');
  });

  it('notices and facts', () => {
    expect(html(<Notice kind="error" title="Nothing was sent to anyone.">9 of 33 gates failed.</Notice>)).toBe(
      '<div class="notice notice--error"><p><span class="notice__title">Nothing was sent to anyone.</span> 9 of 33 gates failed.</p></div>',
    );
    expect(html(<Facts plain items={[['Decided by', 'Gate (model)']]} />)).toBe('<dl class="facts facts--plain"><dt>Decided by</dt><dd>Gate (model)</dd></dl>');
  });
});
