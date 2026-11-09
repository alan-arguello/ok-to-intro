/**
 * The page's one polite live region (`#live`, ux-spec §9) and `announce()`, a port of OTI.announce.
 * The root layout renders <LiveRegion/> once. Announce one summary per change (“Checking 12 asks”, then one line
 * when a run ends), never one per row.
 */

export const LIVE_REGION_ID = 'live';

export function LiveRegion() {
  return <div id={LIVE_REGION_ID} className="sr-only" aria-live="polite" />;
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Replaces the live region's text (cleared first, so repeating the same message is announced again). */
export function announce(message: string): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(LIVE_REGION_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = LIVE_REGION_ID;
    el.className = 'sr-only';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  const node = el;
  node.textContent = '';
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    node.textContent = message;
    pending = null;
  }, 30);
}
