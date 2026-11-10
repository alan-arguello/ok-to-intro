import type { ReactNode } from 'react';
import { Banner } from '@/components/site/banner';
import { SlimHeader } from '@/components/site/slim-page';
import { qaEnabled } from '@/lib/qa';
import '@/styles/gates.css';

/**
 * The /g pages: the slim header, then a line that says this page is real (not the demo line), the banner slot,
 * then <main>. Personal gates store real asks, so “nothing is sent to anyone” must not appear here.
 */
export function GateChrome({ name, children }: { name?: string | null; children: ReactNode }) {
  return (
    <>
      <SlimHeader />
      <p className="demo-line">{name ? `Personal gate · asks are stored for ${name}` : 'Personal gate'}</p>
      <Banner qa={qaEnabled()} />
      <main id="main" className="container container--narrow gate-main">
        {children}
      </main>
    </>
  );
}

export const NOT_SET_UP_TITLE = 'Personal gates aren’t set up on this instance';
export const NOT_SET_UP_BODY = 'This copy of the app has no database for personal gates. Nothing was stored or sent.';
