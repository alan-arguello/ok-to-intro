'use client';

import { cx } from '@/components/kit/cx';
import { SampleTag } from '@/components/kit/pills';
import { fmtMs, fmtUsd } from '@/lib/oti/text';
import { PRESET_RECORDINGS, recordedLabel } from '@/lib/recorded';
import { LIST_IDLE, LIST_STALE, QA_FIXTURE, STEP_ASKS } from './copy';
import type { PgState } from './engine';
import { ASKS, checkingLabel, computeDisplays, countDisplays, summaryLine, TOTAL, type Run } from './model';
import { PgRow, type RowActions } from './row';

export interface ListActions extends RowActions {
  retryLost(): void;
}

/** The one quiet line saying where these answers came from: a recording, a live model call, or a QA fixture. */
export function sourceLine(run: Run): string {
  if (run.source === 'fixture') return QA_FIXTURE;
  if (run.source === 'authored' || run.source === 'recorded') return recordedLabel(PRESET_RECORDINGS, { gates: TOTAL, wall_ms: run.wall_ms, cost_usd: run.cost_usd });
  const n = ASKS.filter((a) => run.gates[a.id]).length;
  const time = run.wall_ms !== null ? ` in ${fmtMs(run.wall_ms)}` : '';
  const cost = run.cost_usd !== null ? ` · ${fmtUsd(run.cost_usd)}` : '';
  return `Live check · ${n} of ${TOTAL} answered${time}${cost}`;
}

/**
 * Step 2, “12 asks from other founders”: one summary sentence, the source line, any notice, then the rows. When
 * the rules changed since the run, the rows go back to unchecked (an answer for other rules would mislead).
 */
export function ListSection({ s, actions }: { s: PgState; actions: ListActions }) {
  const running = s.phase === 'running';
  const run = s.stale ? null : s.run;
  const done = !!run && s.phase === 'done';
  const { map } = computeDisplays(run, s.pending, s.cap, running);
  const progress = s.run && s.plan ? s.plan.filter((id) => s.run?.gates[id] || s.run?.errors[id]).length : 0;
  const total = s.plan?.length ?? TOTAL;
  const summary = running
    ? s.slowNote
      ? `Still checking. ${progress} of ${total} answered.`
      : checkingLabel(progress, total)
    : done
      ? summaryLine(countDisplays(map))
      : s.stale
        ? LIST_STALE
        : LIST_IDLE;

  return (
    <section className="pg-main" aria-labelledby="pg-list-title">
      <div className="split pg-main__head">
        <h2 className="h2 pg-step" id="pg-list-title" tabIndex={-1}>
          {STEP_ASKS}
        </h2>
        <SampleTag />
      </div>
      <p className={cx('pg-summary', done && 'is-done')} id="pg-stat">
        {summary}
      </p>
      {done ? (
        <p className="meta pg-source" id="pg-meta">
          {sourceLine(run)}
        </p>
      ) : null}
      {s.notes.length ? (
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
        </div>
      ) : null}
      <div className="list pg-list" id="pg-list" aria-busy={running}>
        {(run ? s.order : ASKS.map((a) => a.id)).map((id) => {
          const ask = ASKS.find((a) => a.id === id);
          return ask ? <PgRow key={id} ask={ask} d={map[id]} rules={run?.rules ?? ''} cap={s.cap} busy={running} actions={actions} /> : null;
        })}
      </div>
    </section>
  );
}
