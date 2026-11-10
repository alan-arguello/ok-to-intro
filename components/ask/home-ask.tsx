'use client';

/**
 * `/`, the ask-first home: the /ask composer (components/ask/compose.tsx, variant `home`) on a static page. A static
 * page can't read the live state or `?degraded=` on the server, so this island fills them in after hydration:
 * `?degraded=` (QA only) and the live state from /api/health. The first paint is the full composer, so LCP is the H1
 * and the textarea.
 */

import { useEffect, useState } from 'react';
import { resolveDegraded } from '@/lib/qa';
import type { BannerKind, LiveState } from '@/lib/types';
import { AskCompose } from './compose';
import type { LiveInfo } from './types';

export interface HomeAskProps {
  /** Whether this instance has a model key (lib/env), so the first paint already knows live checks are off. */
  liveConfigured: boolean;
  /** qaEnabled() from the server: whether `?degraded=` is honoured. */
  qa: boolean;
}

const LIVE_STATES: readonly LiveState[] = ['ok', 'slow', 'down', 'budget', 'off'];

function untilLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

export function HomeAsk({ liveConfigured, qa }: HomeAskProps) {
  const [degraded, setDegraded] = useState<BannerKind | null>(null);
  const [live, setLive] = useState<LiveInfo>({ state: liveConfigured ? 'ok' : 'off', until: null });

  useEffect(() => {
    const d = resolveDegraded(new URLSearchParams(window.location.search).get('degraded'), qa);
    let cancelled = false;
    // One microtask later, so the boot render (and its hydration) is never re-rendered synchronously.
    queueMicrotask(() => {
      if (!cancelled && d) setDegraded(d);
    });
    const ctrl = new AbortController();
    if (!d && liveConfigured) {
      fetch('/api/health', { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<{ live?: unknown; live_paused_until?: unknown }>) : null))
        .then((h) => {
          if (cancelled || !h || !LIVE_STATES.includes(h.live as LiveState)) return;
          setLive({ state: h.live as LiveState, until: untilLabel(h.live_paused_until) });
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [qa, liveConfigured]);

  return <AskCompose variant="home" qaState={null} degraded={degraded} live={live} preset={null} from={null} edit={false} />;
}
