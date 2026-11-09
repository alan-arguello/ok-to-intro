'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { BANNER_COPY, bannerForLive, fillCopy } from '@/lib/oti/copy';
import { fmtDay } from '@/lib/oti/time';
import { resolveDegraded } from '@/lib/qa';
import type { BannerKind, HealthSnapshot } from '@/lib/types';

/**
 * The banner slot, directly under the header: `<div data-banner role="status">`, one line (ux-spec §3, §8).
 * - QA (`qa` prop from the server): `?degraded=slow|down|budget|limited|offline|off` shows that banner, with the
 *   prototype's example values (Dec 1, 10:42).
 * - Otherwise it reads GET /api/health once and shows slow / down / budget / off; nothing when live is ok.
 * - The browser's offline event shows the offline banner until the connection is back.
 * The slot stays empty and hidden until there is something to say, so a healthy page never shifts.
 */

const QA_VALUES = { date: 'Dec 1', time: '10:42' };

const noSubscribe = () => () => undefined;

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const PLAYGROUND_STATE_BANNER: Record<string, string> = { 'api-down': 'down', budget: 'budget', offline: 'offline', 'rate-limited': 'limited' };

export function Banner({ qa }: { qa: boolean }) {
  const forced = useSyncExternalStore(
    noSubscribe,
    () => {
      const sp = new URLSearchParams(window.location.search);
      // On `/rules`, the playground's degraded QA states imply their banner, as in the prototype's degrade().
      const implied = window.location.pathname === '/rules' ? PLAYGROUND_STATE_BANNER[sp.get('state') ?? ''] : undefined;
      return resolveDegraded(sp.get('degraded') ?? implied, qa);
    },
    () => null,
  );
  const offline = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine === false,
    () => false,
  );
  const [fromServer, setFromServer] = useState<{ kind: BannerKind; values: Record<string, string> } | null>(null);

  useEffect(() => {
    if (forced) return;
    const ctrl = new AbortController();
    fetch('/api/health', { signal: ctrl.signal, headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<HealthSnapshot>) : null))
      .then((h) => {
        const kind = h ? bannerForLive(h.live) : null;
        if (!h || !kind) return;
        const until = h.live_paused_until ? Date.parse(h.live_paused_until) : NaN;
        setFromServer({ kind, values: { date: Number.isNaN(until) ? 'next month' : fmtDay(until) } });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [forced]);

  const kind: BannerKind | null = offline ? 'offline' : (forced ?? fromServer?.kind ?? null);
  const copy = kind ? BANNER_COPY[kind] : null;
  const values = forced && kind === forced ? QA_VALUES : (fromServer?.values ?? {});

  return (
    <div data-banner="" role="status" className={copy ? `banner banner--${copy.tone}` : undefined} hidden={!copy}>
      {copy ? (
        <div className="banner__in">
          <p>{fillCopy(copy.text, values)}</p>
        </div>
      ) : null}
    </div>
  );
}
