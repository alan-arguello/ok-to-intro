'use client';

import { useSyncExternalStore } from 'react';

/**
 * The ⌘↵ hint. Reads “Ctrl ↵” off Apple platforms, is hidden from the accessible name (the button carries
 * aria-keyshortcuts instead) and is hidden on coarse pointers by tokens.css. The server renders “⌘↵”; the client
 * switches after hydration without a mismatch (useSyncExternalStore server snapshot).
 */

export const KBD_APPLE = '⌘↵';
export const KBD_OTHER = 'Ctrl ↵';
/** Put this on any button that shows <Kbd/>. */
export const KBD_SHORTCUTS = 'Meta+Enter Control+Enter';

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return true;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return /mac|iphone|ipad|ipod/i.test(uaData?.platform || navigator.platform || navigator.userAgent || '');
}

const subscribe = () => () => undefined;

export function useKbdText(): string {
  return useSyncExternalStore(
    subscribe,
    () => (isApplePlatform() ? KBD_APPLE : KBD_OTHER),
    () => KBD_APPLE,
  );
}

export function Kbd() {
  const text = useKbdText();
  return (
    <span className="kbd" aria-hidden="true" data-k="">
      {text}
    </span>
  );
}
