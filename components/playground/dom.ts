/**
 * Small browser helpers for the playground's scroll and motion rules. Every call is guarded, so a missing
 * API (jsdom, old browsers) never throws.
 */

/** Runs after React has committed and the browser is about to paint. */
export function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
}

export function isPhone(): boolean {
  try {
    return window.matchMedia('(max-width: 760px)').matches;
  } catch {
    return false;
  }
}

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Brings an element to the top of the viewport, under the sticky header (html has scroll-padding-top). */
export function scrollToId(id: string): void {
  afterPaint(() => {
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
}
