import type { Metadata } from 'next';
import { SiteShell } from '@/components/site/site-shell';
import { NOT_FOUND_COPY } from '@/components/static/error-copy';
import { NotFoundView } from '@/components/static/not-found-view';
import { qaEnabled } from '@/lib/qa';

/**
 * S8 · 404 (ux-spec S8) for every unmatched URL and every notFound(). It sits outside the route groups, so it
 * renders the site chrome itself (header, banner, main) inside the root layout. Next adds `noindex` and the 404 status.
 */
export const metadata: Metadata = {
  title: NOT_FOUND_COPY.title,
  description: NOT_FOUND_COPY.description,
};

export default function NotFound() {
  return (
    <SiteShell qa={qaEnabled()}>
      <NotFoundView />
    </SiteShell>
  );
}
