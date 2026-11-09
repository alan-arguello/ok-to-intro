'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * `.tabs` (role=tablist): arrow keys, Home and End move between tabs (roving tabindex); each tab controls a
 * tabpanel. Controlled: the parent owns `value` (e.g. synced to `?tab=` on /agents).
 */

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  panel: ReactNode;
}

export function Tabs<K extends string>({ items, value, onChange, label, className }: { items: readonly TabItem<K>[]; value: K; onChange: (key: K) => void; label: string; className?: string }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = items.length;
    const j = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const k = (j + n) % n;
    refs.current[k]?.focus();
    onChange((items[k] as TabItem<K>).key);
  };
  return (
    <div className={className}>
      <div className="tabs" role="tablist" aria-label={label}>
        {items.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="tab"
            type="button"
            role="tab"
            id={`${base}-tab-${t.key}`}
            aria-selected={t.key === value}
            aria-controls={`${base}-panel-${t.key}`}
            tabIndex={t.key === value ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            data-key={t.key}
          >
            {t.label}
          </button>
        ))}
      </div>
      {items.map((t) => (
        <div key={t.key} role="tabpanel" id={`${base}-panel-${t.key}`} aria-labelledby={`${base}-tab-${t.key}`} hidden={t.key !== value} tabIndex={0}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
