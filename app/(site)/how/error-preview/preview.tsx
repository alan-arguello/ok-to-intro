'use client';

import { ErrorView } from '@/components/static/error-view';

/** The QA preview of the error page, with an example ref (the real page shows the error's digest). */
export function ErrorPreview() {
  return <ErrorView refCode="7F2A" onRetry={() => window.location.reload()} />;
}
