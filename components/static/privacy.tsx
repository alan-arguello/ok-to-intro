import type { ReactNode } from 'react';
import { RULES_TO_ANTHROPIC } from '@/lib/oti/copy';
import { CONTACT_EMAIL, CONTACT_FALLBACK_URL } from '@/lib/site';
import { CodeRefs } from './code-ref';
import { PRIVACY_CODE, PRIVACY_COPY, PRIVACY_ROWS, WHO_SEES } from './copy';

/** ✓ or – with words for screen readers (the symbols are hidden from them). */
function Mark({ yes, lower }: { yes: boolean; lower?: boolean }) {
  return (
    <>
      <span aria-hidden="true">{yes ? '✓' : '–'}</span>
      <span className="sr-only">{yes ? (lower ? 'yes' : 'Yes') : lower ? 'no' : 'No'}</span>
    </>
  );
}

function Row({ id, title, children, code }: { id: string; title: string; children: ReactNode; code?: readonly string[] }) {
  return (
    <section className="row priv-row" aria-labelledby={id}>
      <h2 className="h3" id={id}>
        {title}
      </h2>
      <p>{children}</p>
      {code ? <CodeRefs paths={code} /> : null}
    </section>
  );
}

/** /privacy (prototype privacy.html): who sees what, then what is stored, kept, processed and deleted. */
export function PrivacyContent() {
  return (
    <div className="container container--col">
      <header className="page-head">
        <h1 className="h1">{PRIVACY_COPY.title}</h1>
        <p className="lede">{PRIVACY_COPY.demo}</p>
      </header>

      <section className="priv-sec" aria-labelledby="priv-who">
        <h2 className="h2" id="priv-who">
          {PRIVACY_COPY.whoTitle}
        </h2>
        <div className="list priv-table-wrap">
          <table className="priv-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">What</span>
                </th>
                <th scope="col">You</th>
                <th scope="col">Askers</th>
                <th scope="col">Other members</th>
              </tr>
            </thead>
            <tbody>
              {WHO_SEES.map((r) => (
                <tr key={r.what}>
                  <th scope="row">{r.what}</th>
                  <td>
                    <Mark yes={r.you} />
                  </td>
                  <td>{r.askers === false ? <Mark yes={false} /> : r.askers}</td>
                  <td>
                    <Mark yes={r.others} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list priv-stack" role="list" aria-label={PRIVACY_COPY.whoTitle}>
          {WHO_SEES.map((r) => (
            <li className="row" key={r.what}>
              <p className="row__name">{r.what}</p>
              <p className="small">
                <span className="priv-pair">
                  You <Mark yes={r.you} lower />
                </span>{' '}
                ·{' '}
                {r.askers === false ? (
                  <span className="priv-pair">
                    Askers <Mark yes={false} lower />
                  </span>
                ) : (
                  <span className="priv-pair">Askers: {r.askers}</span>
                )}{' '}
                ·{' '}
                <span className="priv-pair">
                  Other members <Mark yes={r.others} lower />
                </span>
              </p>
            </li>
          ))}
        </ul>
        <p className="small priv-note">{RULES_TO_ANTHROPIC}</p>
        <CodeRefs paths={[...PRIVACY_CODE.who, ...PRIVACY_CODE.rules]} />
      </section>

      <div className="list priv-list">
        <Row id="priv-ask" title="If you ask" code={PRIVACY_CODE.ask}>
          {PRIVACY_ROWS.ask}
        </Row>
        <Row id="priv-store" title="What we store" code={PRIVACY_CODE.store}>
          {PRIVACY_ROWS.store}
        </Row>
        <Row id="priv-nostore" title="What we don’t store" code={PRIVACY_CODE.noStore}>
          {PRIVACY_ROWS.noStore}
        </Row>
        <Row id="priv-proc" title="Processors">
          {PRIVACY_ROWS.processors}
        </Row>
        <Row id="priv-never" title="What we never touch">
          {PRIVACY_ROWS.never}
        </Row>
        <Row id="priv-delete" title="Delete" code={PRIVACY_CODE.delete}>
          {PRIVACY_ROWS.delete}
        </Row>
        <Row id="priv-contact" title="Contact">
          {CONTACT_EMAIL ? (
            <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          ) : (
            <>
              <a className="link" href={CONTACT_FALLBACK_URL} rel="noopener">
                {CONTACT_FALLBACK_URL.replace(/^https:\/\//, '')}
              </a>
              <span className="ink-2">{PRIVACY_ROWS.contactFallback}</span>
            </>
          )}
        </Row>
      </div>
    </div>
  );
}
