'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { Button } from '@/components/kit/button';
import { cx } from '@/components/kit/cx';
import { SampleTag } from '@/components/kit/pills';
import { fmtMs, fmtUsd } from '@/lib/oti/text';
import { PRESET_RECORDINGS, recordedLabel } from '@/lib/recorded';
import type { SampleAskKey } from '@/lib/types';
import {
  AGREE_EMPTY,
  agreeLine,
  ALL_DECLINED,
  allAccepted,
  ASK_LINK,
  bridgeHelp,
  KEEP,
  LIST_IDLE,
  marksLine,
  OFFER_LINK,
  QA_FIXTURE,
  RAW_TRACE,
  RUN_LIVE,
  TRY_ENGINEER,
  WRITE_ASK,
  type LiveBlock,
} from './copy';
import { canTestQuote, editOf, isEdited, type PgState } from './engine';
import { answered, ASKS, dividers, quoteCheck, quoteLine, TOTAL, traceRows, trapsCaught, TRAPS, type Counts, type DisplayMap } from './model';
import { PgRow, type RowActions } from './row';

export interface ListActions extends RowActions {
  runLive(): void;
  setTrace(on: boolean): void;
  applyAdd(): void;
  applyCapEdit(): void;
  applyQuoteTest(): void;
  undo(): void;
  retryLost(): void;
  tryEngineer(): void;
  save(): void;
}

/** The meta line under the statline: where these verdicts came from, by the run's real source. */
export function metaText(s: PgState, map: DisplayMap): string {
  const run = s.run;
  if (!run) return '';
  if (s.capNote) return s.capNote;
  if (run.source === 'authored' || run.source === 'recorded') {
    const label = recordedLabel(PRESET_RECORDINGS, { gates: TOTAL, wall_ms: run.wall_ms, cost_usd: run.cost_usd });
    return `${label}${s.applied?.kind === 'test' ? ' · plus a test of the quote check' : ''} ·`;
  }
  const n = answered(run);
  const ql = quoteLine(quoteCheck(map));
  if (run.source === 'fixture') return `${QA_FIXTURE} · ${n < TOTAL ? `${n} of ${TOTAL} asks` : `${TOTAL} asks`} · ${ql}`;
  const gates = n < TOTAL ? `${n} of ${TOTAL} gates` : `${TOTAL} gates`;
  const time = run.wall_ms !== null ? ` in ${fmtMs(run.wall_ms)}` : '';
  const cost = run.cost_usd !== null ? ` · ${fmtUsd(run.cost_usd)}` : '';
  return `Live · ${gates}${time}${cost} · ${ql}`;
}

function Statline({ s, c, map, progress }: { s: PgState; c: Counts; map: DisplayMap; progress: number }) {
  if (!s.run) return <>{LIST_IDLE(TRAPS)}</>;
  if (s.phase === 'running') {
    const total = s.plan?.length ?? TOTAL;
    return s.slowNote ? (
      <>
        Still checking. <b>{progress}</b> of {total} answered.
      </>
    ) : (
      <>
        Checking <b>{progress}</b> of {total}
      </>
    );
  }
  if (c.notChecked) {
    return (
      <>
        <b>{c.checked}</b> of {TOTAL} checked · <b>{c.notChecked}</b> not checked
      </>
    );
  }
  return <Buckets c={c} map={map} />;
}

/** “2 reach you · 1 over your cap · 1 question first · 8 declined, 4 of them traps”. Zero buckets are left out, except reach. */
function Buckets({ c, map }: { c: Counts; map: DisplayMap }) {
  const caught = trapsCaught(map);
  return (
    <>
      <b className={c.reach ? 'orange-text' : undefined}>{c.reach}</b> reach you
      {c.held ? (
        <>
          {' · '}
          <b>{c.held}</b> over your cap
        </>
      ) : null}
      {c.ask ? (
        <>
          {' · '}
          <b>{c.ask}</b> question first
        </>
      ) : null}
      {c.declined ? (
        <>
          {' · '}
          <b>{c.declined}</b> declined
          {caught ? (
            <>
              ,{' '}
              <a className="link" href="#pg-g-traps">
                {caught} of them traps
              </a>
            </>
          ) : null}
          {c.code ? ` (${c.code} by code)` : null}
        </>
      ) : null}
    </>
  );
}

function TryBand({ s, c, block, actions }: { s: PgState; c: Counts; block: LiveBlock | null; actions: ListActions }) {
  const run = s.run;
  const running = s.phase === 'running';
  const edited = isEdited(s);
  const add = editOf(s.preset, 'add');
  const capE = editOf(s.preset, 'cap');
  let show = !!run && !s.traceOn && ((s.phase === 'done' && (!!s.applied || (!edited && !s.stale))) || (running && !!s.applied));
  const showAdd = !!add;
  // The cap edit shows only when it would change a verdict (more accepts than the lower cap allows).
  const showCap = !!capE && s.cap === capE.from && c.reach + c.held > capE.to;
  const showTest = canTestQuote(s);
  if (show && !s.applied && !showAdd && !showCap && !showTest) show = false;
  const ap = s.applied;
  const what = !ap ? '' : ap.kind === 'add' ? `+ ${ap.line}` : ap.kind === 'test' ? 'a test of the quote check (fake model output)' : `Cap ${ap.from} → ${ap.to}`;
  return (
    <div className="card pg-try" id="pg-try" hidden={!show}>
      {show ? (
        <>
          <p className="label pg-try__label">Try a change</p>
          {ap ? (
            <p className="small pg-applied">
              Applied: {what} ·{' '}
              <button className="btn btn--ghost btn--sm" type="button" data-act="undo" aria-disabled={running} onClick={() => !running && actions.undo()}>
                Undo
              </button>
            </p>
          ) : (
            <div className="btn-row pg-try__btns">
              {showAdd && add ? (
                <button className="btn btn--sm" type="button" data-act="add" aria-disabled={!!block} onClick={actions.applyAdd}>
                  + {add.line}
                </button>
              ) : null}
              {showCap && capE ? (
                <button className="btn btn--sm" type="button" data-act="cap" onClick={actions.applyCapEdit}>
                  Cap {capE.from} → {capE.to}
                </button>
              ) : null}
              {showTest ? (
                <button className="btn btn--sm" type="button" data-act="test" onClick={actions.applyQuoteTest}>
                  Test the quote check
                </button>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function TraceView({ s, map, reachDays }: { s: PgState; map: DisplayMap; reachDays: readonly number[] }) {
  const rows = s.traceOn && s.run ? traceRows(s.run, map, s.cap, reachDays) : [];
  return (
    <pre className="trace pg-trace" id="pg-trace" aria-label="Raw trace of the run’s events" hidden={!s.traceOn}>
      {rows.map((r, i) => (
        <span className="ln" key={i}>
          {r.time !== null ? <span className="t-dim">{r.time}</span> : null}
          {r.segs.map((seg, j) =>
            seg.tone ? (
              <span key={j} className={`t-${seg.tone}`}>
                {seg.text}
              </span>
            ) : (
              <Fragment key={j}>{seg.text}</Fragment>
            ),
          )}
        </span>
      ))}
    </pre>
  );
}

function Notes({ s, c, actions }: { s: PgState; c: Counts; actions: ListActions }) {
  const running = s.phase === 'running';
  const done = !!s.run && s.phase === 'done';
  const everyDeclined = done && !c.notChecked && c.declined === TOTAL;
  const everyAccepted = done && !c.notChecked && !everyDeclined && c.reach + c.held === TOTAL;
  return (
    <div className="pg-notes stack" id="pg-notes">
      {s.notes.map((n) => (
        <div key={n.key} className={cx('notice', n.kind !== 'plain' && `notice--${n.kind}`)} data-note={n.key}>
          <p>{n.text}</p>
          {n.action === 'retry-lost' ? (
            <button className="btn btn--sm" type="button" aria-disabled={running} onClick={() => !running && actions.retryLost()}>
              {n.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
      {everyDeclined ? (
        <div className="notice" data-note="all">
          <p>{ALL_DECLINED}</p>
          <div className="btn-row pg-all-acts">
            <button className="btn btn--sm" type="button" onClick={actions.tryEngineer}>
              {TRY_ENGINEER}
            </button>
            <Link className="btn btn--sm" href="/ask?from=playground" onClick={actions.save}>
              {WRITE_ASK}
            </Link>
          </div>
        </div>
      ) : null}
      {everyAccepted ? (
        <div className="notice" data-note="all">
          <p>{allAccepted(s.cap)}</p>
        </div>
      ) : null}
    </div>
  );
}

export interface ListSectionProps {
  s: PgState;
  map: DisplayMap;
  reachDays: readonly number[];
  c: Counts;
  block: LiveBlock | null;
  actions: ListActions;
}

/** The 12 asks: notices, the list head (statline, meta, Run live, Raw trace), Try a change, the rows, the bridge. */
export function ListSection({ s, map, reachDays, c, block, actions }: ListSectionProps) {
  const run = s.run;
  const running = s.phase === 'running';
  const done = !!run && s.phase === 'done';
  const progress = run && s.plan ? s.plan.filter((id) => run.gates[id] || run.errors[id]).length : 0;
  const meta = run && !running ? metaText(s, map) : '';
  const divs = s.grouped && !running ? dividers(s.order, map) : [];
  const days = reachDays.join(',');
  return (
    <section className="pg-main" aria-labelledby="pg-list-title">
      <h2 className="sr-only" id="pg-list-title">
        12 sample asks
      </h2>
      <Notes s={s} c={c} actions={actions} />
      <div className="list pg-list" id="pg-list" aria-busy={running}>
        <div className="list__head pg-lhead" id="pg-lhead" tabIndex={-1}>
          <p className="small pg-stat" id="pg-stat">
            <Statline s={s} c={c} map={map} progress={progress} />
          </p>
          <SampleTag className="pg-lhead__tag" />
          {done && c.notChecked ? (
            <p className="small pg-line" id="pg-checked">
              <Buckets c={c} map={map} />
            </p>
          ) : null}
          {done && !s.stale ? (
            <p className="small pg-line" id="pg-next">
              <Link className="link" href="/ask?from=playground" id="pg-next-ask" onClick={actions.save}>
                {ASK_LINK}
              </Link>
            </p>
          ) : null}
          {run && !running && s.diff ? (
            <p className="small pg-line" id="pg-diff">
              {s.diff}
            </p>
          ) : null}
          {run && !running && s.marks.length ? (
            <p className="small pg-line" id="pg-marks">
              {marksLine(s.marks.length)}
            </p>
          ) : null}
          {meta ? (
            <p className="meta pg-line pg-meta" id="pg-meta">
              <span className="pg-meta__text" id="pg-meta-text">
                {meta}
              </span>
              {run?.mode === 'recorded' && !s.capNote ? (
                <Button size="sm" className="pg-live" id="pg-live" aria-disabled={!!block} onClick={actions.runLive}>
                  {RUN_LIVE}
                </Button>
              ) : null}
              {done ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="pg-trace-btn"
                  id="pg-trace-btn"
                  aria-pressed={s.traceOn}
                  aria-controls="pg-trace"
                  onClick={() => actions.setTrace(!s.traceOn)}
                >
                  {RAW_TRACE}
                </Button>
              ) : null}
            </p>
          ) : null}
        </div>
        <TraceView s={s} map={map} reachDays={reachDays} />
        <TryBand s={s} c={c} block={block} actions={actions} />
        {s.order.map((id: SampleAskKey) => {
          const div = divs.find((d) => d.before === id);
          const ask = ASKS.find((a) => a.id === id);
          if (!ask) return null;
          return (
            <Fragment key={id}>
              {div ? (
                <p className="list__head pg-group small" id={div.id} tabIndex={-1} hidden={s.traceOn}>
                  {div.text}
                </p>
              ) : null}
              <PgRow
                ask={ask}
                d={map[id]}
                rules={run?.rules ?? ''}
                cap={s.cap}
                reachDays={days}
                open={s.open === id}
                marked={s.marks.includes(id)}
                stale={s.stale}
                changedWas={s.changed[id] ?? null}
                variance={s.variance.includes(id)}
                hidden={s.traceOn}
                busy={running}
                flash={s.flash[id] ?? 0}
                actions={actions}
              />
            </Fragment>
          );
        })}
      </div>
      {s.everDone ? (
        <div className="pg-after" id="pg-after">
          <p className="small pg-agree" id="pg-agree">
            {s.marks.length ? agreeLine(s.marks.length) : AGREE_EMPTY}
          </p>
          <div className="card pg-bridge">
            <div className="btn-row">
              <Link className="btn btn--primary hide-phone" id="pg-keep" href="/join" onClick={actions.save}>
                {KEEP}
              </Link>
              <Link className="btn" id="pg-ask" href="/ask?from=playground" onClick={actions.save}>
                {ASK_LINK}
              </Link>
              {c.reach ? (
                <Link className="link pg-offer-link" id="pg-offer" href="/o/sample?from=playground" prefetch={false} onClick={actions.save}>
                  {OFFER_LINK}
                </Link>
              ) : null}
            </div>
            <p className="help" id="pg-bridge-help">
              {bridgeHelp(s.cap)}
            </p>
          </div>
          <p className="meta pg-next">
            Next: <Link className="link" href="/ask">Ask the sample network</Link> · <Link className="link" href="/agents">Use it from Claude Code</Link> ·{' '}
            <Link className="link" href="/board">
              Real counts and the held-out eval
            </Link>{' '}
            · <Link className="link" href="/how">How it works</Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}
