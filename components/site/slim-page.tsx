import Link from 'next/link';
import type { ReactNode } from 'react';
import { qaEnabled } from '@/lib/qa';
import { PRODUCT_NAME } from '@/lib/site';
import { Banner } from './banner';

/**
 * Slim pages (/o, /c, /pause, the sample email viewer): the wordmark plus one right-aligned meta such as
 * “1 of 2 this month ■□ · 71 h left”, then the banner slot, then <main id="main">.
 *
 * Why pages render this instead of app/(slim)/layout.tsx: the meta comes from the page's own data (the offer
 * behind the token), and landmarks must read header → banner → main. A layout can't receive page data, and a
 * header rendered inside <main> would not be the page's banner landmark.
 */
export function SlimHeader({ meta }: { meta?: ReactNode }) {
  return (
    <header className="site-header">
      <div className="site-header__in">
        <Link className="wordmark" href="/">
          {PRODUCT_NAME}
        </Link>
        {meta ? <span className="site-header__aside">{meta}</span> : null}
      </div>
    </header>
  );
}

export function SlimPage({ meta, mainClassName, children }: { meta?: ReactNode; mainClassName?: string; children: ReactNode }) {
  return (
    <>
      <SlimHeader meta={meta} />
      <Banner qa={qaEnabled()} />
      <main id="main" className={mainClassName}>
        {children}
      </main>
    </>
  );
}
