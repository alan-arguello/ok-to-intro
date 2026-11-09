'use client';

import Link from 'next/link';
import { Fragment, memo, useEffect, useRef } from 'react';
import { Clause } from '@/components/kit/clause';
import { cx } from '@/components/kit/cx';
import { Disclosure, Facts, type FactItem } from '@/components/kit/surfaces';
import type { DisplayVerdict } from '@/lib/oti/cap';
import type { SampleAsk } from '@/lib/sample/types';
import type { SampleAskKey } from '@/lib/types';
import { BOARD_CLAUSE_LINK, MODEL_VARIANCE } from './copy';
import {
  arrivedText,
  asideText,
  bodySegments,
  chainText,
  decidedByText,
  footModel,
  gateOutput,
  IN_YOUR_RULES,
  isResolved,
  LABEL,
  latencyText,
  MARKABLE,
  TEST_LABEL,
  whyText,
  type RowDisplay,
} from './model';

export interface RowActions {
  toggleRow(id: SampleAskKey): void;
  toggleMark(id: SampleAskKey): void;
  retry(id: SampleAskKey): void;
  setActive(id: SampleAskKey | null): void;
}

export interface PgRowProps {
  ask: SampleAsk;
  d: RowDisplay;
  /** The rules the row's run checked (cited offsets index this text). */
  rules: string;
  cap: number;
  /** “day 2 and day 4” source, joined so the prop stays stable between renders. */
  reachDays: string;
  open: boolean;
  marked: boolean;
  stale: boolean;
  changedWas: DisplayVerdict | null;
  variance: boolean;
  hidden: boolean;
  busy: boolean;
  flash: number;
  actions: RowActions;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The ask, with a trap's tell underlined (dotted) so the reader sees what the gate ignored. */
function AskBody({ ask }: { ask: SampleAsk }) {
  return (
    <>
      {bodySegments(ask).map((seg, i) =>
        seg.trap ? (
          <mark key={i} className="mark--trap">
            <span className="sr-only">Trap text: </span>
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}

function Foot({ d, rules, cap, reachDays, variance }: { d: RowDisplay; rules: string; cap: number; reachDays: number[]; variance: boolean }) {
  const foot = footModel(d, { rules, cap, reachDays });
  return (
    <div className="pg-why">
      {foot.kind === 'cites' ? (
        <>
          <span className="pg-cites">
            <span className="pg-cites__l">Cited</span>
            <span className="pg-cites__q">
              {foot.quotes.map((q, i) => (
                <span className="pg-cite" key={i}>
                  <Clause>{q}</Clause>
                  {i === foot.quotes.length - 1 ? (
                    <>
                      {' '}
                      <span className="pg-ok">{IN_YOUR_RULES}</span>
                    </>
                  ) : null}
                </span>
              ))}
            </span>
          </span>
          {foot.notes.map((n, i) => (
            <span className="pg-note" key={i}>
              {n}
            </span>
          ))}
        </>
      ) : null}
      {foot.kind === 'note' ? <span className="pg-note">{foot.text}</span> : null}
      {foot.kind === 'code' ? (
        <>
          {foot.missing.length ? (
            <span className="pg-cites">
              <span className="pg-cites__l">Quoted</span>
              <span className="pg-cites__q">
                {foot.missing.map((m, i) => (
                  <span className="pg-cite" key={i}>
                    <Clause missing>{m}</Clause>
                  </span>
                ))}
              </span>
            </span>
          ) : null}
          <span className="pg-note">{foot.note}</span>
          {foot.test ? (
            <span className="pg-note pg-test">
              {TEST_LABEL}{' '}
              <Link className="link" href="/board#b-clause-title">
                {BOARD_CLAUSE_LINK}
              </Link>
            </span>
          ) : null}
        </>
      ) : null}
      {variance ? <span className="pg-note pg-test">{MODEL_VARIANCE}</span> : null}
    </div>
  );
}

function Detail({ ask, d, cap }: { ask: SampleAsk; d: RowDisplay; cap: number }) {
  const resolved = isResolved(d.display);
  const items: FactItem[] = [];
  if (resolved) {
    items.push(['Why', whyText(d)]);
    items.push(['Decided by', decidedByText(d, cap)]);
  }
  items.push(['Arrived', arrivedText(ask)]);
  const latency = resolved ? latencyText(d) : null;
  if (latency) items.push(['Latency', latency]);
  const out = resolved && d.gate ? gateOutput(d.gate) : null;
  return (
    <>
      <Facts items={items} plain />
      {out ? (
        <Disclosure className="pg-gate" summary={out.summary}>
          <pre className="trace">{out.json}</pre>
          <p className="help">{out.note}</p>
        </Disclosure>
      ) : null}
    </>
  );
}

/**
 * One ask (ux-spec S1 “Rows”): line 1 and the ask together are a <button aria-expanded> named by the company, the
 * verdict and “Details”, described by the ask. The citation, the decided-by chain and Disagree follow; Details
 * opens the facts (one row open at a time).
 */
export const PgRow = memo(function PgRow(p: PgRowProps) {
  const { ask, d } = p;
  const v = d.display;
  const id = ask.id;
  const ref = useRef<HTMLDivElement>(null);

  // A row that resolves while the run streams flashes white for 260 ms (none under reduced motion).
  useEffect(() => {
    const el = ref.current;
    if (!p.flash || !el || reducedMotion()) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    const t = setTimeout(() => el.classList.remove('is-flash'), 320);
    return () => clearTimeout(t);
  }, [p.flash]);

  const resolved = isResolved(v);
  const stale = p.stale && resolved;
  const chain = chainText(d, p.cap);
  const markable = MARKABLE.includes(v);
  const failed = v === 'failed';
  const days = p.reachDays ? p.reachDays.split(',').map(Number) : [];

  return (
    <div
      ref={ref}
      className={cx('row is-interactive pg-row', v === 'notrun' && 'is-notrun', ask.trap && 'is-trap', p.open && 'is-open', stale && 'is-stale', p.changedWas && 'is-changed')}
      id={`pg-row-${id}`}
      data-ask={id}
      hidden={p.hidden}
      onMouseEnter={() => p.actions.setActive(id)}
      onMouseLeave={() => p.actions.setActive(null)}
      onFocus={() => p.actions.setActive(id)}
      onBlur={() => p.actions.setActive(null)}
    >
      <button
        className="row__toggle"
        type="button"
        aria-expanded={p.open}
        aria-controls={`pg-det-${id}`}
        aria-labelledby={`pg-n-${id} pg-v-${id} pg-x-${id}`}
        aria-describedby={`pg-b-${id}`}
        onClick={() => p.actions.toggleRow(id)}
      >
        <span className="row__line1">
          <span className={`verdict verdict--${v}`} id={`pg-v-${id}`}>
            {LABEL[v]}
          </span>
          {p.changedWas ? <span className="pg-changed">Changed · was {LABEL[p.changedWas]}</span> : null}
          <span className="row__name" id={`pg-n-${id}`}>
            {ask.company}
          </span>
          <span className="row__loc">{ask.city}</span>
          {ask.trap ? <span className="tag tag--trap">Trap · {ask.trap}</span> : null}
          {stale ? <span className="tag tag--outline">Out of date</span> : null}
          <span className="row__aside is-desk">{asideText(d)}</span>
          <span className="pg-more" id={`pg-x-${id}`}>
            <span className="pg-more__t">Details</span>
            <span className="pg-chev" aria-hidden="true">
              ›
            </span>
          </span>
        </span>
        <span className="row__body" id={`pg-b-${id}`}>
          <AskBody ask={ask} />
        </span>
      </button>
      <div className="row__foot pg-foot">
        <Foot d={d} rules={p.rules} cap={p.cap} reachDays={days} variance={p.variance && resolved} />
      </div>
      {chain || failed || markable ? (
        <div className="pg-end">
          {chain ? <p className="pg-chain">{chain}</p> : null}
          {failed ? (
            <button className="btn btn--sm pg-retry" type="button" aria-describedby={`pg-n-${id}`} aria-disabled={p.busy} onClick={() => !p.busy && p.actions.retry(id)}>
              Retry
            </button>
          ) : null}
          {markable ? (
            <button className="btn btn--ghost btn--sm pg-disagree" type="button" aria-pressed={p.marked} aria-describedby={`pg-n-${id}`} onClick={() => p.actions.toggleMark(id)}>
              {p.marked ? 'You’d decide differently' : 'Disagree'}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="row__detail pg-detail" id={`pg-det-${id}`} hidden={!p.open}>
        {p.open ? <Detail ask={ask} d={d} cap={p.cap} /> : null}
      </div>
    </div>
  );
});
