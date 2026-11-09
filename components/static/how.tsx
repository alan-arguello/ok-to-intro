import { Tag } from '@/components/kit/pills';
import { REPO_DISPLAY, REPO_URL } from '@/lib/site';
import type { EvalSummary } from '@/lib/types';
import { HOW_COPY, HOW_STEPS, howCostLine, howGuarantees } from './copy';

/** /how (prototype how.html): five steps, each with what enforces it, then the guarantees, the cost and the code. */
export function HowContent({ evalSummary }: { evalSummary: EvalSummary }) {
  return (
    <div className="container container--col">
      <header className="page-head">
        <h1 className="h1">{HOW_COPY.title}</h1>
      </header>

      <ol className="list how-steps" role="list" aria-label={HOW_COPY.stepsLabel}>
        {HOW_STEPS.map((s, i) => (
          <li className="row how-step" key={s.name}>
            <span className="how-num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="how-step__text">
              <p className="row__name">{s.name}</p>
              <p className="how-step__line">{s.line}</p>
            </div>
            <p className="how-by">
              <span className="meta">Enforced by</span>{' '}
              {s.by.map((b) => (
                <Tag key={b}>{b}</Tag>
              ))}
            </p>
          </li>
        ))}
      </ol>

      <section className="section how-sec" aria-labelledby="how-g-title">
        <h2 className="h2" id="how-g-title">
          {HOW_COPY.guaranteesTitle}
        </h2>
        <ul className="list how-guarantees" role="list">
          {howGuarantees(evalSummary).map((g) => (
            <li className="row" key={g.lead}>
              <p>
                <b>{g.lead}</b> {g.text}
              </p>
            </li>
          ))}
        </ul>
        <div className="how-meta">
          <p className="meta" id="how-cost">
            {howCostLine()}
          </p>
          <p className="meta">
            {HOW_COPY.codeAndEval}{' '}
            <a className="link" href={REPO_URL} rel="noopener">
              {REPO_DISPLAY}
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
