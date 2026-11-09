'use client';

import { SiteShell } from '@/components/site/site-shell';
import { ERROR_COPY, errorRef } from '@/components/static/error-copy';
import { ErrorView } from '@/components/static/error-view';
import { PRODUCT_NAME } from '@/lib/site';

/**
 * S8 · the error boundary for every page under the root layout (ux-spec S8). It replaces the route groups' layouts,
 * so it renders the site chrome itself. `retry()` re-fetches and re-renders the segment that failed. The ref is the
 * digest Next writes to the server log with the error, never the error's message.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <SiteShell>
      <title>{`${ERROR_COPY.title} · ${PRODUCT_NAME}`}</title>
      <ErrorView refCode={errorRef(error)} onRetry={retry} />
    </SiteShell>
  );
}
