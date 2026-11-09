import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ERROR_COPY } from '@/components/static/error-copy';
import { qaEnabled } from '@/lib/qa';
import { ErrorPreview } from './preview';

/**
 * QA only: the error page's view, rendered without throwing, so audits and screenshots can reach it
 * (scripts/audit-sweep.mjs). A 404 in production unless QA_STATES=1, like /kit. The real boundary is app/error.tsx,
 * which renders the same ErrorView inside the site chrome.
 */
export const metadata: Metadata = { title: ERROR_COPY.title, robots: { index: false, follow: false } };

export default function ErrorPreviewPage() {
  if (!qaEnabled()) notFound();
  return <ErrorPreview />;
}
