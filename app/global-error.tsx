'use client';

import { ERROR_COPY, errorRef } from '@/components/static/error-copy';
import { ERR_ACTIONS, ERR_HEAD, ERR_LEDE } from '@/components/static/err-layout';
import { FOOTER_LINE, PRODUCT_NAME } from '@/lib/site';
import './tokens.css';
import './globals.css';

/**
 * S8 · the last-resort boundary, for an error in the root layout itself (ux-spec S8). It replaces the whole document,
 * so it renders its own <html> and <body>, imports the tokens (the same stylesheet the root layout loads), and
 * depends on no other component: whatever broke the layout can't break this page too. Fonts fall back to the system
 * stack in tokens.css, on purpose. Links are plain <a>: the app's own router may be what failed.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const ref = errorRef(error);
  return (
    <html lang="en">
      <body>
        <title>{`${ERROR_COPY.title} · ${PRODUCT_NAME}`}</title>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="site-header__in">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load, on purpose */}
            <a className="wordmark" href="/">
              {PRODUCT_NAME}
            </a>
          </div>
        </header>
        <main id="main">
          <div className="container container--col">
            <header className="page-head" style={ERR_HEAD}>
              <h1 className="h1">{ERROR_COPY.h1}</h1>
              <p className="lede" style={ERR_LEDE}>
                {ERROR_COPY.nothingSent}
                {ref ? ` Ref ${ref}.` : null}
              </p>
              <div className="btn-row" style={ERR_ACTIONS}>
                <button className="btn btn--primary btn--lg" type="button" data-primary="" onClick={() => retry()}>
                  {ERROR_COPY.retry}
                </button>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load, on purpose */}
                <a className="btn btn--lg" href="/">
                  {ERROR_COPY.home}
                </a>
              </div>
            </header>
          </div>
        </main>
        <footer className="site-footer">
          <div className="site-footer__in">
            <p>{FOOTER_LINE}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
