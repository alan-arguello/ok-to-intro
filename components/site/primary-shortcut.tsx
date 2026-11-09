'use client';

import { useEffect } from 'react';

/**
 * ⌘↵ / Ctrl+↵ presses the page's one primary action: the first visible, enabled `[data-primary]`
 * (port of prototype/shared.js). Mounted once in the root layout; renders nothing.
 */

function visible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
}

export function PrimaryShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-primary]')).find(
        (el) => visible(el) && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && el.getAttribute('aria-busy') !== 'true',
      );
      if (target) {
        e.preventDefault();
        target.click();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
