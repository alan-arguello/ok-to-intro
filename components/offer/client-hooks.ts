'use client';

import { useSyncExternalStore } from 'react';
import { fmtClock, fmtDay, fmtWeekday, fmtWhen } from '@/lib/oti/time';
import { parseSampleStores, readSampleStoresRaw, type SampleStores } from './sample-loop';

/**
 * Small client hooks for the recipient pages. Each one renders the server's value while prerendering and
 * hydrating (so the markup always matches) and the browser's value right after, without effects.
 */

const noSubscribe = () => () => undefined;

/** False on the server and during hydration, true after: progressive enhancement that changes markup. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** The three SAMPLE stores of this tab (null on the server and during hydration). */
export function useSampleStores(enabled: boolean): SampleStores | null {
  const raw = useSyncExternalStore(
    noSubscribe,
    () => (enabled ? readSampleStoresRaw() : null),
    () => null,
  );
  return raw === null ? null : parseSampleStores(raw);
}

/** “Now” on the client (stable within a render pass: rounded to the minute), null on the server. */
export function useClientNow(): number | null {
  return useSyncExternalStore(
    noSubscribe,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => null,
  );
}

export type LocalTimeFormat = 'weekday-at' | 'weekday' | 'clock' | 'day' | 'when';

function format(ms: number, f: LocalTimeFormat): string {
  switch (f) {
    case 'weekday-at':
      return `${fmtWeekday(ms)} at ${fmtClock(ms)}`;
    case 'weekday':
      return fmtWeekday(ms);
    case 'clock':
      return fmtClock(ms);
    case 'day':
      return fmtDay(ms);
    case 'when':
      return fmtWhen(ms);
  }
}

/** A time in the viewer's own zone; `fallback` (the network time) without JS and while hydrating. */
export function useLocalTime(iso: string | null, f: LocalTimeFormat, fallback: string): string {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      const ms = iso ? Date.parse(iso) : NaN;
      return Number.isNaN(ms) ? fallback : format(ms, f);
    },
    () => fallback,
  );
}
