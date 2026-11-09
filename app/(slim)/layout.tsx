import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Slim pages: /o/[token], /c/[token], /pause/[token] and the sample email viewer (/emails/[kind]).
 * Each page renders <SlimPage meta={…}> (components/site/slim-page.tsx): the wordmark plus its own meta,
 * the banner slot, then <main id="main">. The meta comes from the page's data, so it can't live here;
 * see slim-page.tsx for why the header must stay outside <main>.
 * Everything here is reached from an email link: never indexed, never cached (next.config.ts headers too).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SlimLayout({ children }: { children: ReactNode }) {
  return children;
}
