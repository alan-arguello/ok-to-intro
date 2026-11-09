'use client';

/**
 * Small hydration-safe hooks for the S2 islands. Each returns the server value while hydrating (so the HTML the
 * server sent matches the first client render) and the browser's value right after.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { readStore, type PlaygroundStore } from '@/lib/oti/storage';
import { NETWORK_TZ } from '@/lib/oti/time';

const never = () => () => undefined;

/** False on the server and while hydrating, true after. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

function mediaStore(query: string) {
  return {
    subscribe(onChange: () => void) {
      try {
        const m = window.matchMedia(query);
        m.addEventListener('change', onChange);
        return () => m.removeEventListener('change', onChange);
      } catch {
        return () => undefined;
      }
    },
    get() {
      try {
        return window.matchMedia(query).matches;
      } catch {
        return false;
      }
    },
  };
}

const PHONE = mediaStore('(max-width: 760px)');
const REDUCED = mediaStore('(prefers-reduced-motion: reduce)');

/** At 760 px and below (the phone layout: sticky bar, stacked rows). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(PHONE.subscribe, PHONE.get, () => false);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(REDUCED.subscribe, REDUCED.get, () => false);
}

export function isPhoneNow(): boolean {
  return PHONE.get();
}

export function reducedMotionNow(): boolean {
  return REDUCED.get();
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** navigator.onLine, kept current by the online/offline events. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
}

/**
 * The zone times render in: Mexico City on the server and while hydrating (the server can't know the viewer's
 * zone), then the viewer's own zone (`undefined` = the browser's), per docs/CONTRACT.md §time.
 */
export function useViewerTz(): string | undefined {
  return useSyncExternalStore(
    never,
    () => undefined,
    () => NETWORK_TZ,
  );
}

/**
 * Keeps the tab's title on `title` (an ask's subject: the server only knows a generic name for an ask that lives in
 * this tab). Next streams the metadata <title> into <head> after hydration, which would put the generic name back,
 * so the title is re-applied whenever <head> changes while this page shows.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}

/** Scrolls an element into view, smoothly unless reduced motion is on. */
export function reveal(el: Element | null, block: ScrollLogicalPosition = 'start'): void {
  if (!el) return;
  try {
    el.scrollIntoView({ block, behavior: reducedMotionNow() ? 'auto' : 'smooth' });
  } catch {
    el.scrollIntoView();
  }
}

/* ---------- the playground's rules, read from this tab (S1 writes oti.playground) ---------- */


let playgroundCache: { raw: string | null; value: PlaygroundStore | null } = { raw: null, value: null };

function readPlaygroundSnapshot(): PlaygroundStore | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem('oti.playground');
  } catch {
    raw = null;
  }
  if (raw !== playgroundCache.raw) playgroundCache = { raw, value: raw ? readStore('playground') : null };
  return playgroundCache.value;
}

function subscribeReturn(onChange: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') onChange();
  };
  window.addEventListener('focus', onChange);
  window.addEventListener('pageshow', onChange);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('pageshow', onChange);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** The visitor's playground rules and cap (null before hydration and when they never ran the playground). */
export function usePlayground(): PlaygroundStore | null {
  return useSyncExternalStore(subscribeReturn, readPlaygroundSnapshot, () => null);
}

/** Subscribes `onChange` to the visitor coming back to this tab (focus, bfcache restore, tab shown). */
export { subscribeReturn };
