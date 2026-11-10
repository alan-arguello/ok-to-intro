import Link from 'next/link';
import { Tag } from '@/components/kit/pills';
import { MAKE_GATE_HREF } from '@/lib/oti/personal-gate';
import { REPO_DISPLAY, REPO_URL, ROUTES } from '@/lib/site';
import { HOW_COPY, HOW_STEPS } from './copy';

/** /how: what the demo does, in five steps (ask → check → each member's gate → monthly limit → one offer at a time). */
export function HowContent() {
  return (
    <div className="container container--col">
      <header className="page-head">
        <h1 className="h1">{HOW_COPY.title}</h1>
        <p className="lede">{HOW_COPY.lede}</p>
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
              <span className="meta">By</span>{' '}
              {s.by.map((b) => (
                <Tag key={b}>{b}</Tag>
              ))}
            </p>
          </li>
        ))}
      </ol>

      <section className="list how-gate" aria-labelledby="how-gate-title">
        <div className="row">
          <h2 className="row__name" id="how-gate-title">
            {HOW_COPY.gateTitle}
          </h2>
          <p className="how-step__line">{HOW_COPY.gateLine}</p>
          <p className="small how-gate__link">
            <Link className="link" href={MAKE_GATE_HREF}>
              {HOW_COPY.gateLink}
            </Link>
          </p>
        </div>
      </section>

      <div className="how-meta">
        <p className="small">
          <Link className="link" href={ROUTES.home}>
            {HOW_COPY.tryAsk} ›
          </Link>{' '}
          ·{' '}
          <Link className="link" href={ROUTES.rules}>
            {HOW_COPY.tryRules}
          </Link>
        </p>
        <p className="meta">
          {HOW_COPY.code}{' '}
          <a className="link" href={REPO_URL} rel="noopener">
            {REPO_DISPLAY}
          </a>
        </p>
      </div>
    </div>
  );
}
