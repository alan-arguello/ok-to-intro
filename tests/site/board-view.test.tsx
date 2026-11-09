import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardContent } from '@/components/board/board-view';
import { boardView, emptyBoardView } from '@/components/board/model';
import { EXAMPLE_SNAPSHOT, exampleBoardView } from '@/components/board/qa-examples';
import { PROTOTYPE_NUMBERS_NOTE } from '@/lib/oti/copy';
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

const real = boardView({ snapshot: EXAMPLE_SNAPSHOT, asOfKind: 'checkpoint', evalSummary: NO_EVAL });
const html = (v = real, stale = false) => renderToStaticMarkup(<BoardContent view={v} stale={stale} />);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('the board markup (prototype board.html)', () => {
  it('has one h1, the sections in the prototype’s order, and the anchors other pages link to', () => {
    const out = html();
    expect(count(out, /<h1\b/g)).toBe(1);
    const order = ['b-head-title', 'b-funnel-title', 'b-prot-title', 'b-demand-title', 'b-eval-title', 'b-clause-title', 'b-play-title'].map((id) => out.indexOf(`id="${id}"`));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > (order[i - 1] as number)))).toBe(true);
    // The playground's quote test links to /board#b-clause-title (docs/requests/s1-playground.md).
    expect(out).toContain('<h2 class="h2" id="b-clause-title">Clause check</h2>');
    expect(out).toContain('aria-labelledby="b-clause-title"');
  });

  it('labels every section by its data: REAL counts, the EVAL file, SAMPLE examples', () => {
    const out = html();
    expect(count(out, /class="tag tag--real">Real</g)).toBe(5);
    expect(out).toContain('<span class="tag">Eval</span>');
    expect(count(out, /<span class="tag">Sample<\/span>/g)).toBe(2);
  });

  it('puts each number’s SQL in a title and under “How this is counted”', () => {
    const out = html();
    expect(out).toContain('<span title="count(*) from audit where action = &#x27;offer_delivered&#x27;">11</span>');
    expect(out).toContain('<summary>How this is counted</summary>');
    expect(out).toContain('class="mono board-sql"');
    expect(out).toContain('same times askers see changes');
  });

  it('shows the orange metric only for the ratio, and the small-sample note once per section', () => {
    const out = html();
    expect(out).toContain('<span class="metric metric--attn" title="people interrupted ÷ useful outcomes">2.2</span>');
    expect(count(out, /board-small/g)).toBe(1);
    expect(out).not.toContain(PROTOTYPE_NUMBERS_NOTE);
  });

  it('renders the clause-check example from SAMPLE data, labelled as a fake output', () => {
    const out = html();
    expect(out).toContain('<span class="clause clause--missing">“Happy to take any intro”</span>');
    expect(out).toContain('A test of the code check: a fake model output, not a model call.');
    expect(out).toContain('Real catches are counts only');
  });

  it('labels counts as stale only when the database is down', () => {
    expect(html(real, false)).not.toContain('board-stale');
    expect(html(real, true)).toContain('The database isn’t answering. These are the counts from Nov 10, 14:02.');
  });

  it('without a database: the designed not-connected board, no numbers, definitions kept', () => {
    const out = html(emptyBoardView('not_configured', NO_EVAL));
    expect(out).toContain('The real network isn’t connected on this instance yet.');
    expect(out).toContain('<summary>How this is counted</summary>');
    expect(out).toContain('No eval run yet.');
    expect(out).not.toContain('b-funnel-title');
    expect(out).not.toContain('b-clause-title');
    expect(out).not.toMatch(/>\s*254\s*</);
  });

  it('with the database down at build: the warn notice and the eval only', () => {
    const out = html(emptyBoardView('db_down', NO_EVAL));
    expect(out).toContain('class="notice notice--warn board-stale"');
    expect(out).not.toContain('b-head-title');
    expect(out).toContain('b-eval-title');
  });

  it('QA examples carry the dashed prototype note and the eval table with a caption, scopes and a phone stack', () => {
    const out = html(exampleBoardView('default'));
    expect(out).toContain(`<span class="proto-note">${PROTOTYPE_NUMBERS_NOTE}</span>`);
    expect(out).toContain('<caption class="sr-only">');
    expect(count(out, /<th scope="col"/g)).toBe(6);
    expect(count(out, /<th scope="row"/g)).toBe(6);
    expect(out).toContain('class="board-stack hide-desk"');
    expect(out).toContain('<summary>See the 6 cases missed (8 misses across 3 runs)</summary>');
    expect(out).toContain('Prototype: example numbers for layout.');
  });
});
