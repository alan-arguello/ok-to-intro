import type { ReactNode } from 'react';
import { Banner } from '@/components/site/banner';
import { SiteHeader } from '@/components/site/site-header';
import { qaEnabled } from '@/lib/qa';

/**
 * Pages with the full header: /, /ask, /ask/[id], /board, /agents, /how, /privacy, /join, /me, /kit.
 * Header (client island), the banner slot directly under it, then <main id="main">. Pages render their own
 * container inside main (e.g. <div className="container">). Never reads cookies, so pages stay static.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <Banner qa={qaEnabled()} />
      <main id="main">{children}</main>
    </>
  );
}
