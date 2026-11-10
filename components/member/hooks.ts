'use client';

/**
 * Small client hooks for S3's pages. Values that only exist in the browser (sessionStorage, the viewer's clock and
 * zone) render after hydration: the server snapshot is null/false, so the static HTML never mismatches.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { CAP_CHOICES } from '@/lib/oti/cap';
import { STORAGE_KEYS } from '@/lib/oti/storage';
import { isPresetId, presetForRules } from '@/lib/sample/presets';
import type { PresetId } from '@/lib/types';

const never = () => () => undefined;

/** False during the server render and hydration, true after. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

const STORE_EVENT = 'oti:member-store';

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(STORE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(STORE_EVENT, onChange);
  };
}

/** Tells useSessionItem readers in this tab that a value changed (sessionStorage fires no event in its own tab). */
export function notifyStoreChange(): void {
  try {
    window.dispatchEvent(new Event(STORE_EVENT));
  } catch {
    /* ignore */
  }
}

/** The raw sessionStorage string for `key` (a stable snapshot), or null on the server, before hydration, or when blocked. */
export function useSessionItem(key: string): string | null {
  return useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
}

/** Rules carried from the playground (`oti.playground`), as the join card and /me?carried=1 read them. */
export interface CarriedRules {
  rules: string;
  cap: number;
  preset: PresetId;
  /** “Engineer”, “Sales operator”, “Founder”, or “Custom” once the text differs from every preset. */
  label: string;
}

export function parseCarried(raw: string | null): CarriedRules | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: unknown; rules?: unknown; cap?: unknown; preset?: unknown } | null;
    if (!v || v.v !== 1 || typeof v.rules !== 'string' || !v.rules.trim()) return null;
    const cap = typeof v.cap === 'number' && (CAP_CHOICES as readonly number[]).includes(v.cap) ? v.cap : 2;
    const preset = isPresetId(v.preset) ? v.preset : 'engineer';
    return { rules: v.rules, cap, preset, label: presetForRules(v.rules)?.label ?? 'Custom' };
  } catch {
    return null;
  }
}

/** The playground's rules in this tab (null on the server and before hydration). */
export function useCarriedRules(): CarriedRules | null {
  const raw = useSessionItem(STORAGE_KEYS.playground);
  return useMemo(() => parseCarried(raw), [raw]);
}

/**
 * Sets document.title while `title` is not null (a page whose state changes its name: “Join with your rules”,
 * “Deleted”). Next streams the metadata <title> into <head> after hydration, so the title is re-applied whenever
 * <head> changes while the state lasts.
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

/**
 * Focus that waits for React's commit: `focusAfter('#me-resume')` in an event handler focuses the first element
 * matching that selector once it is in the DOM and visible (a requestAnimationFrame can run before a commit
 * scheduled from an async handler, and a hidden element can't take focus).
 */
export function useFocusAfterCommit(): (selector: string) => void {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const selector = pending.current;
    if (!selector) return;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el || !el.getClientRects().length) return;
    pending.current = null;
    try {
      el.focus({ preventScroll: false });
    } catch {
      el.focus();
    }
  });
  return useCallback((selector: string) => {
    pending.current = selector;
  }, []);
}
