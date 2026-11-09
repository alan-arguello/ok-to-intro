/**
 * Browser storage for the playground (docs/CONTRACT.md §storage). Every access is wrapped: private windows, blocked
 * storage and server rendering all read as “nothing stored”, and nothing here ever throws.
 *
 * - `oti.playground` (the shared PlaygroundStore, lib/oti/storage.ts): rules, cap, preset and the last run's rows.
 *   S2, S3 and R read it, so its shape is the contract's. sessionStorage: it stays in this tab (“Your rules stay in
 *   this tab”), survives a refresh, and is gone when the tab closes.
 * - `oti.s1.lastRun` (S1's own convenience): the full last live run, so a refresh shows exactly what the model
 *   returned in this tab instead of re-running it. QA fixture runs are never stored.
 */

import { readStore, writeStore, type PlaygroundStore } from '@/lib/oti/storage';
import { ASK_IDS, isAskId, type Run } from './model';

const LAST_RUN_KEY = 'oti.s1.lastRun';

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export interface PlaygroundStorage {
  load(): PlaygroundStore | null;
  save(value: PlaygroundStore): void;
  loadRun(): Run | null;
  saveRun(run: Run | null): void;
}

function validRun(v: unknown): v is Run {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<Run>;
  if (typeof r.id !== 'string' || typeof r.rules !== 'string' || (r.mode !== 'live' && r.mode !== 'recorded')) return false;
  if (r.source !== 'live' && r.source !== 'recorded' && r.source !== 'authored') return false;
  if (!r.gates || typeof r.gates !== 'object' || !r.errors || typeof r.errors !== 'object' || !Array.isArray(r.events)) return false;
  for (const key of Object.keys(r.gates)) {
    if (!isAskId(key)) return false;
    const g = (r.gates as Record<string, unknown>)[key] as { verdict?: unknown; cited?: unknown } | undefined;
    if (!g || typeof g !== 'object' || typeof g.verdict !== 'string' || !Array.isArray(g.cited)) return false;
  }
  for (const key of Object.keys(r.errors)) if (!isAskId(key)) return false;
  return ASK_IDS.length === 12;
}

export const browserStorage: PlaygroundStorage = {
  load() {
    const v = readStore('playground');
    return v && typeof v.rules === 'string' ? v : null;
  },
  save(value) {
    writeStore('playground', value);
  },
  loadRun() {
    const s = session();
    if (!s) return null;
    try {
      const raw = s.getItem(LAST_RUN_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { v?: number; run?: unknown };
      return v && v.v === 1 && validRun(v.run) ? v.run : null;
    } catch {
      return null;
    }
  },
  saveRun(run) {
    const s = session();
    if (!s) return;
    try {
      if (run) s.setItem(LAST_RUN_KEY, JSON.stringify({ v: 1, run }));
      else s.removeItem(LAST_RUN_KEY);
    } catch {
      /* full or blocked: the tab simply won't restore the run */
    }
  },
};

/** Storage that keeps nothing (tests, and the server). */
export const noStorage: PlaygroundStorage = {
  load: () => null,
  save: () => undefined,
  loadRun: () => null,
  saveRun: () => undefined,
};
