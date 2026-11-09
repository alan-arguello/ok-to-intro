'use client';

/**
 * Query parameters on STATIC pages (/, /ask, /join, /agents, /how, /privacy, /board) without `useSearchParams()`.
 *
 * Why: in a production build, a statically rendered page that calls `useSearchParams()` outside a <Suspense>
 * boundary fails `next build` (“Missing Suspense boundary with useSearchParams”), and `next dev` never shows the
 * error. Reading the server `searchParams` prop instead makes the page dynamic. These hooks read `location.search`
 * after hydration: `null` while prerendering and hydrating, then the real value (same pattern as the banner), so
 * the static HTML stays the default state and nothing mismatches.
 *
 * They track the URL the page loaded with and back/forward (popstate). If a page rewrites its own query with
 * router.replace, keep that value in component state instead.
 */

import { useSyncExternalStore } from 'react';
import { resolveQaState, type QaPage, type QaState } from '@/lib/qa';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

/** One query parameter (first value), or null before hydration and when absent. */
export function useSearchParam(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

/** The `?state=` QA state for a static page; `qa` comes from a server component (`qaEnabled()`), as a prop. */
export function useQaState<P extends QaPage>(page: P, qa: boolean): QaState<P> | null {
  return resolveQaState(page, useSearchParam('state'), qa);
}
