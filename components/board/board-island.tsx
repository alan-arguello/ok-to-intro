'use client';

import { useEffect, useState } from 'react';
import { useQaState } from '@/lib/use-search-param';
import type { HealthSnapshot } from '@/lib/types';
import { BoardContent } from './board-view';
import type { BoardView } from './model';

/**
 * /board's client island. The server renders the real board (or its designed empty state) into the static HTML;
 * this island only:
 * - shows the [stale] notice when /api/health says the database isn't answering, so the counts on this cached page
 *   are labelled with the time they are from (ISR keeps serving the last good page while the database is down);
 * - swaps in a QA example state (?state=default | launch-day | small-n | stale, QA only), loaded on demand so the
 *   example numbers are never in the page's own bundle.
 */
export function BoardIsland({ view, qa }: { view: BoardView; qa: boolean }) {
  const state = useQaState('board', qa);
  const [example, setExample] = useState<{ state: string; view: BoardView } | null>(null);
  const [dbDown, setDbDown] = useState(false);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    import('./qa-examples')
      .then((m) => {
        if (!cancelled) setExample({ state, view: m.exampleBoardView(state) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (state || view.mode !== 'counts') return;
    const ctrl = new AbortController();
    fetch('/api/health', { signal: ctrl.signal, headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<Partial<HealthSnapshot>>) : null))
      .then((h) => {
        if (h?.db === 'down') setDbDown(true);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [state, view.mode]);

  const shown = state && example?.state === state ? example.view : view;
  return <BoardContent view={shown} stale={shown.stale || (!state && dbDown)} />;
}
