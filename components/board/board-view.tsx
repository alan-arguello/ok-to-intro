import type { ReactNode } from 'react';
import { RealTag, SampleTag, Tag } from '@/components/kit/pills';
import { PROTOTYPE_NUMBERS_NOTE } from '@/lib/oti/copy';
import { BOARD_COPY } from './copy';
import type { BoardView, EvalView, Line, StatRow } from './model';

/**
 * The /board markup (prototype board.html), rendered from a BoardView. No hooks and no data access: the server page
 * renders it with real counts, and the client island re-renders it for QA example states and the stale notice.
 */

function LineText({ line }: { line: Line }) {
  return (
    <>
      {line.map((seg, i) => {
        if (typeof seg === 'string') return <span key={i}>{seg}</span>;
        const text = seg.strong ? <b>{seg.text}</b> : seg.text;
        return seg.title ? (
          <span key={i} title={seg.title}>
            {text}
          </span>
        ) : (
          <span key={i}>{text}</span>
        );
      })}
    </>
  );
}

function SectionHead({ id, title, tag }: { id: string; title: string; tag: ReactNode }) {
  return (
    <div className="split board-sec__head">
      <h2 className="h2" id={id}>
        {title}
      </h2>
      {tag}
    </div>
  );
}

function Stats({ rows }: { rows: readonly StatRow[] }) {
  return (
    <div className="list board-list">
      <dl className="stats">
        {rows.map((r) => (
          <div className="stat" key={r.label}>
            <dt>{r.label}</dt>
            <dd>
              <span title={r.def}>{r.value}</span>
              {r.note ? <small>{r.note}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** “How this is counted”: every number's SQL, at every width (the titles only help on desktop). */
function HowCounted({ view }: { view: BoardView }) {
  if (!view.defs.length) return null;
  return (
    <details className="disclosure board-how">
      <summary>How this is counted</summary>
      <div className="board-how__body">
        <ul className="board-defs" role="list">
          {view.defs.map((d) => (
            <li key={d.label}>
              <p className="small">
                <b>{d.label}</b>
              </p>
              <p className="mono board-sql">{d.def}</p>
            </li>
          ))}
        </ul>
        {view.defsNotes.map((n) => (
          <p className="help" key={n}>
            {n}
          </p>
        ))}
      </div>
    </details>
  );
}

function EvalTable({ ev }: { ev: EvalView }) {
  return (
    <div className="list board-list board-eval-wrap">
      <table className="board-table hide-phone">
        <caption className="sr-only">{BOARD_COPY.evalCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Case type</th>
            <th scope="col">n</th>
            {ev.runLabels.map((l) => (
              <th scope="col" key={l}>
                {l}
              </th>
            ))}
            <th scope="col">Keyword baseline</th>
          </tr>
        </thead>
        <tbody>
          {ev.rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>
                <span title="number of held-out cases of this type">{r.n}</span>
              </td>
              {r.runs.map((x, i) => (
                <td key={i}>
                  <span title={`cases of this type the gate decided as labelled in run ${i + 1}`}>{x}</span>
                </td>
              ))}
              <td>
                <span title="cases of this type a keyword match decided as labelled">{r.baseline}</span>
              </td>
            </tr>
          ))}
        </tbody>
        {ev.totals ? (
          <tfoot>
            <tr>
              <th scope="row">All cases</th>
              <td>{ev.totals.n}</td>
              {ev.totals.runs.map((x, i) => (
                <td key={i}>{x}</td>
              ))}
              <td>{ev.totals.baseline}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      <ul className="board-stack hide-desk" role="list">
        {ev.rows.map((r) => (
          <li className="row" key={r.label}>
            <p className="board-stack__name">{r.label}</p>
            <p className="small tnum">
              {r.n} {r.n === 1 ? 'case' : 'cases'} · runs {r.runs.join(' / ')} · baseline {r.baseline}
            </p>
          </li>
        ))}
        {ev.totals ? (
          <li className="row board-stack__total">
            <p className="board-stack__name">All cases</p>
            <p className="small tnum">
              {ev.totals.n} cases · runs {ev.totals.runs.join(' / ')} · baseline {ev.totals.baseline}
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function EvalSection({ ev, example }: { ev: EvalView; example: boolean }) {
  return (
    <section className="board-sec" aria-labelledby="b-eval-title">
      <SectionHead id="b-eval-title" title="Held-out eval" tag={<Tag>Eval</Tag>} />
      {ev.state === 'none' ? (
        <div className="panel board-headline">
          <p className="board-empty">{ev.header}</p>
          {ev.note ? <p className="small board-def">{ev.note}</p> : null}
        </div>
      ) : (
        <>
          <p className="meta board-eval-header">{ev.header}</p>
          <EvalTable ev={ev} />
          {ev.errors ? <p className="small board-eval-errors">{ev.errors}</p> : null}
          {ev.missesSummary ? (
            <details className="disclosure board-misses">
              <summary>{ev.missesSummary}</summary>
              <div className="board-misses__body">
                {example ? (
                  <p className="board-misses__note">
                    <span className="proto-note">Prototype: example numbers for layout.</span>
                  </p>
                ) : null}
                <ul className="list board-misses__list" role="list">
                  {ev.misses.map((m, i) => (
                    <li className="row" key={i}>
                      <p className="board-miss__head">
                        <b>{m.caseType}</b> <span className="meta">· missed in {m.where}</span>
                      </p>
                      <p className="small">Ask: “{m.ask}”</p>
                      <p className="small">Rules: “{m.rules}”</p>
                      <p className="small">
                        Expected <b>{m.expected}</b> · got <b>{m.got}</b>
                      </p>
                      <p className="small ink-2">{m.cited.length ? `Cited ${m.cited.map((c) => `“${c}”`).join(' · ')}` : 'Cited no line'}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

export function BoardContent({ view, stale }: { view: BoardView; stale: boolean }) {
  const h = view.headline;
  return (
    <div className="container board-wrap">
      <header className="page-head board-head">
        <h1 className="h1">{BOARD_COPY.title}</h1>
        <p className="lede" id="board-lede">
          {view.lede}
        </p>
        {view.example ? (
          <p className="board-proto">
            <span className="proto-note">{PROTOTYPE_NUMBERS_NOTE}</span>
          </p>
        ) : null}
      </header>

      {stale && view.updated ? (
        <div className="notice notice--warn board-stale" role="status">
          <p>{BOARD_COPY.staleNotice(view.updated)}</p>
        </div>
      ) : null}
      {view.notice ? (
        <div className="notice notice--warn board-stale">
          <p>{view.notice}</p>
        </div>
      ) : null}

      {h ? (
        <section className="board-sec" aria-labelledby="b-head-title">
          <SectionHead id="b-head-title" title={BOARD_COPY.headlineTitle} tag={<RealTag />} />
          <div className="panel board-headline">
            {h.kind === 'ratio' ? (
              <div className="board-metric">
                <span className="metric metric--attn" title={h.ratioTitle}>
                  {h.ratio}
                </span>
                <p className="board-metric__def">
                  <LineText line={h.line} />
                </p>
              </div>
            ) : (
              <p className="board-empty">
                <LineText line={h.line} />
              </p>
            )}
            <p className="small board-def">{view.headlineDef}</p>
          </div>
          {view.sections ? null : <HowCounted view={view} />}
        </section>
      ) : null}

      {view.sections ? (
        <>
          <div className="board-pair">
            <section className="board-sec" aria-labelledby="b-funnel-title">
              <SectionHead id="b-funnel-title" title="Funnel" tag={<RealTag />} />
              {view.funnelSmall ? <p className="meta board-small">{BOARD_COPY.smallSamples}</p> : null}
              <Stats rows={view.funnel} />
              <HowCounted view={view} />
            </section>

            <section className="board-sec" aria-labelledby="b-prot-title">
              <SectionHead id="b-prot-title" title="Recipient protection" tag={<RealTag />} />
              {view.protectionSmall ? <p className="meta board-small">{BOARD_COPY.smallSamples}</p> : null}
              <Stats rows={view.protection} />
            </section>
          </div>

          <section className="board-sec" aria-labelledby="b-demand-title">
            <SectionHead id="b-demand-title" title="Unanswered demand" tag={<RealTag />} />
            <div className="list board-list">
              {view.demand.rows.map((d) => (
                <div className="row board-demand" key={d.topic}>
                  <div className="split">
                    <p className="board-demand__topic">{d.topic}</p>
                    <p className="small tnum">
                      <LineText line={d.line} />
                    </p>
                  </div>
                </div>
              ))}
              {view.demand.empty ? (
                <div className="row">
                  <p className="small ink-2">{view.demand.empty}</p>
                </div>
              ) : null}
              {view.demand.other ? (
                <div className="row">
                  <p className="small ink-2">
                    <LineText line={view.demand.other} />
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      <EvalSection ev={view.eval} example={view.example} />

      {view.sections ? (
        <>
          <section className="board-sec" aria-labelledby="b-clause-title">
            <SectionHead id="b-clause-title" title="Clause check" tag={<RealTag />} />
            <p className="small board-clause">
              <LineText line={view.clause.line} />
            </p>
            <details className="disclosure board-clause-d">
              <summary>{BOARD_COPY.clauseExampleSummary}</summary>
              <div className="board-clause__body">
                <p className="board-misses__note">
                  <SampleTag /> <span className="small ink-2">{BOARD_COPY.clauseExampleLabel}</span>
                </p>
                <ul className="list" role="list">
                  <li className="row">
                    <p className="small">
                      <b>{view.clauseExample.company}</b> · {view.clauseExample.what}
                    </p>
                    <p className="small">
                      Quoted{' '}
                      {view.clauseExample.quoted.map((q, i) => (
                        <span key={i} className={q.found ? 'clause' : 'clause clause--missing'}>
                          “{q.text}”
                        </span>
                      ))}{' '}
                      · {view.clauseExample.found} of {view.clauseExample.total} {view.clauseExample.total === 1 ? 'quote' : 'quotes'} found ·{' '}
                      {view.clauseExample.change}
                    </p>
                  </li>
                </ul>
                <p className="help">{BOARD_COPY.clauseExamplePrivacy}</p>
              </div>
            </details>
          </section>

          <section className="board-sec" aria-labelledby="b-play-title">
            <SectionHead id="b-play-title" title="Playground" tag={<SampleTag />} />
            <p className="small board-play">
              <LineText line={view.playground} />
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
