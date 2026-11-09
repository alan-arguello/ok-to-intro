import type { ReactNode } from 'react';
import { Banner } from './banner';
import { SiteHeader } from './site-header';

/**
 * The (site) layout's chrome for pages that live outside the route group: app/not-found.tsx and app/error.tsx
 * (S7). Header, banner slot, then <main id="main"> (the skip link's target). Usable from client components too:
 * pass `qa` explicitly there (a client component can't read QA_STATES).
 */
export function SiteShell({ qa = false, mainClassName, children }: { qa?: boolean; mainClassName?: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <Banner qa={qa} />
      <main id="main" className={mainClassName}>
        {children}
      </main>
    </>
  );
}
