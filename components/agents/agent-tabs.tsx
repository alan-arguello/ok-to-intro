'use client';

import { useState, type ReactNode } from 'react';
import { Tabs } from '@/components/kit/tabs';
import { useSearchParam } from '@/lib/use-search-param';

/**
 * The kit's tabs (role=tablist, arrow keys, Home/End) with the selection kept in the URL, like the prototype's
 * `?tab=mcp` and `?demo=asked`: a link opens the right tab, and choosing one replaces the query without a reload.
 * The static HTML shows the default tab; the URL's tab applies after hydration (lib/use-search-param.ts).
 */
export interface AgentTabItem<K extends string> {
  key: K;
  label: ReactNode;
  panel: ReactNode;
}

export function AgentTabs<K extends string>({ items, param, fallback, label, className }: { items: readonly AgentTabItem<K>[]; param: string; fallback: K; label: string; className?: string }) {
  const fromUrl = useSearchParam(param);
  const [picked, setPicked] = useState<K | null>(null);
  const valid = (v: string | null): v is K => !!v && items.some((t) => t.key === v);
  const value: K = picked ?? (valid(fromUrl) ? fromUrl : fallback);
  const onChange = (key: K) => {
    setPicked(key);
    try {
      const url = new URL(window.location.href);
      if (key === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, key);
      // Next integrates native replaceState with its router (node_modules/next/dist/docs, “Linking and navigating”).
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // A sandboxed frame: the tab still changes.
    }
  };
  return <Tabs items={items} value={value} onChange={onChange} label={label} className={className} />;
}
