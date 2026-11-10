'use client';

/**
 * `/rules` (“Be asked”): one stacked column. On top, your rules and a monthly limit; below, 12 asks from other founders and
 * whether each would reach you. A client island over a static page: the server renders the default state (the
 * first example's rules, 12 unchecked asks); after hydration the engine restores the tab's rules, applies a QA
 * state, reads /api/health and takes over.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { announce } from '@/components/site/live-region';
import { resolveDegraded, resolveQaState } from '@/lib/qa';
import { postSse } from '@/lib/sse';
import type { TryEvent } from '@/lib/types';
import { BACK_TO_ASK, H1, LEDE } from './copy';
import { isPhone, scrollToId } from './dom';
import { PlaygroundEngine, type EngineDeps } from './engine';
import { MakeGate, SavedGateLink } from '@/components/gates/make-gate';
import { ListSection } from './list';
import { Rail } from './rail';
import { browserStorage } from './store';

const DEPS: EngineDeps = {
  postTry: (body, onEvent, signal) => postSse<TryEvent>('/api/try', body, (event) => onEvent(event), { signal }),
  announce,
  storage: browserStorage,
  now: () => Date.now(),
};

export interface PlaygroundProps {
  /** qaEnabled() from the server: whether `?state=` and `?degraded=` are honoured. */
  qa: boolean;
  /** Whether this instance has a model key (lib/env). Without one the first paint already knows live checks are off. */
  liveConfigured: boolean;
  /** Whether personal gates can be saved on this instance (service-role database configured). */
  gatesConfigured?: boolean;
}

export function Playground({ qa, liveConfigured, gatesConfigured = false }: PlaygroundProps) {
  const [engine] = useState(() => new PlaygroundEngine(DEPS, { health: liveConfigured ? 'unknown' : 'off' }));
  const s = useSyncExternalStore(engine.subscribe, engine.getState, engine.getInitial);

  // Boot once after hydration: QA state and degraded mode, ?preset=, the tab's saved rules; then health and network.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qaState = resolveQaState('playground', params.get('state'), qa);
    const degraded = resolveDegraded(params.get('degraded'), qa);
    engine.boot({ qaState, degraded, preset: params.get('preset'), offline: navigator.onLine === false });
    let cancelled = false;
    if (qaState && qaState !== 'not-run') {
      import('./qa-fixtures')
        .then((m) => {
          if (!cancelled) m.applyQaState(engine, qaState);
        })
        .catch(() => undefined);
    }
    const ctrl = new AbortController();
    if (!degraded) {
      fetch('/api/health', { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<{ live?: unknown; live_paused_until?: unknown }>) : null))
        .then((h) => {
          if (h && !cancelled) engine.setHealth(h.live, h.live_paused_until);
        })
        .catch(() => undefined);
    }
    const onOnline = () => engine.setOffline(false);
    const onOffline = () => engine.setOffline(true);
    const onHide = () => engine.save();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onHide);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onHide);
      engine.dispose();
    };
  }, [engine, qa]);

  const actions = useMemo(
    () => ({
      run: () => {
        // Phones: the asks sit under the rules, so bring them into view.
        if (engine.run() && isPhone()) scrollToId('pg-list-title');
      },
      retry: engine.retryOne.bind(engine),
      retryLost: engine.retryLost.bind(engine),
      usePreset: engine.usePreset.bind(engine),
      setRules: engine.setRules.bind(engine),
      setCap: (v: string) => engine.setCap(Number(v)),
    }),
    [engine],
  );

  return (
    <div className="container container--col">
      <header className="page-head pg-head">
        <h1 className="h1">{H1}</h1>
        <p className="lede pg-lede">{LEDE}</p>
      </header>

      <div className="pg-grid">
        <Rail s={s} actions={actions} />
        <ListSection s={s} actions={actions} />
      </div>

      {s.run && s.phase === 'done' ? <MakeGate rules={s.rules} cap={s.cap} configured={gatesConfigured} /> : null}

      <SavedGateLink />

      <p className="small pg-back">
        <Link className="link" href="/" onClick={() => engine.save()}>
          {BACK_TO_ASK}
        </Link>
      </p>
    </div>
  );
}
