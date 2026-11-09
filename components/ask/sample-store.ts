/**
 * SAMPLE asks live in the browser tab that sends them (docs/CONTRACT.md §storage): nothing is stored on a server.
 *
 * - `oti.s2.runs` (this surface's own key): every SAMPLE run of this tab, keyed by id, with the whole fan-out as
 *   it streamed, so a reload or a return from /o/sample renders the same result without sending again. Last 6 kept.
 * - `oti.sampleAsk` (the shared SampleAskStore that R reads for /o/sample?ask=…, the sample emails and check-in):
 *   the ask on screen, as sent, kept in sync on every change.
 *
 * Reads never throw (private mode, blocked storage and SSR read as empty); a value of another version is ignored.
 * Components read through `useSampleRun` (useSyncExternalStore): `undefined` until hydrated, then the run or null.
 */

import { useSyncExternalStore } from 'react';
import { readStore, writeStore, type SampleAskStore } from '@/lib/oti/storage';
import type { QaState } from '@/lib/qa';
import { holderCell, pendingQuestions, youCell, type SampleOutcome, type SampleRun } from './fanout-model';

const KEY = 'oti.s2.runs';
const KEEP = 6;

interface RunsFile {
  v: 1;
  runs: Record<string, SampleRun>;
}

let memory: Map<string, SampleRun> | null = null;
const listeners = new Set<() => void>();
let flushScheduled = false;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isRun(v: unknown): v is SampleRun {
  const r = v as SampleRun | null;
  return !!r && typeof r === 'object' && r.v === 1 && typeof r.id === 'string' && Array.isArray(r.cells) && !!r.compiled && typeof r.outcome === 'string';
}

function load(): Map<string, SampleRun> {
  if (memory) return memory;
  memory = new Map();
  const s = storage();
  if (!s) return memory;
  try {
    const raw = s.getItem(KEY);
    const file = raw ? (JSON.parse(raw) as RunsFile | null) : null;
    if (file && file.v === 1 && file.runs && typeof file.runs === 'object') {
      for (const [id, run] of Object.entries(file.runs)) if (isRun(run) && run.id === id) memory.set(id, run);
    }
  } catch {
    /* unreadable: start empty */
  }
  return memory;
}

function persist(): void {
  const s = storage();
  if (!s || !memory) return;
  const runs = [...memory.values()].filter((r) => !r.example).sort((a, b) => b.sent_at - a.sent_at);
  for (let keep = Math.min(KEEP, runs.length); keep >= 1; keep--) {
    try {
      const file: RunsFile = { v: 1, runs: Object.fromEntries(runs.slice(0, keep).map((r) => [r.id, r])) };
      s.setItem(KEY, JSON.stringify(file));
      return;
    } catch {
      /* quota: keep fewer */
    }
  }
}

function flush(): void {
  flushScheduled = false;
  persist();
  for (const l of [...listeners]) l();
}

function schedule(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

export function getRun(id: string): SampleRun | null {
  return load().get(id) ?? null;
}

/** Saves a run (and, for the ask on screen, the shared oti.sampleAsk). Listeners hear about it once per tick. */
export function putRun(run: SampleRun): void {
  if (run.example) return;
  load().set(run.id, run);
  schedule();
}

/** Updates a stored run in place; returns the new value (null when there is no such run). */
export function updateRun(id: string, fn: (run: SampleRun) => SampleRun): SampleRun | null {
  const prev = getRun(id);
  if (!prev) return null;
  const next = fn(prev);
  if (next !== prev) putRun(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The run for `id`: undefined before hydration, null when this tab has none. */
export function useSampleRun(id: string): SampleRun | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => getRun(id),
    () => undefined,
  );
}

/** Test hook: forget the in-memory copy (the next read reloads from sessionStorage). */
export function resetSampleStoreForTests(): void {
  memory = null;
  listeners.clear();
  flushScheduled = false;
}

/* ---------- the shared store R reads ---------- */

/** The QA state name R understands for each outcome (SampleAskStore.state uses the prototype's names). */
export function sharedStateOf(outcome: SampleOutcome): QaState<'askStatus'> {
  switch (outcome) {
    case 'ready':
    case 'streaming':
    case 'refused':
    case 'lost':
    case 'offline':
      return 'streaming';
    case 'question':
      return 'ask-back';
    case 'closed':
      // The member answered in 2 lines and the asker closed the ask (SampleAskStore has no “closed” state yet).
      return 'answered';
    default:
      return outcome;
  }
}

export function sharedStoreOf(run: SampleRun): SampleAskStore {
  const holder = holderCell(run) ?? (run.offered.length ? (run.cells[run.offered[run.offered.length - 1] as number] ?? null) : null);
  const you = youCell(run);
  const q = pendingQuestions(run)[0];
  const last = run.answers[run.answers.length - 1];
  return {
    v: 1,
    id: run.id as SampleAskStore['id'],
    preset: run.preset,
    state: sharedStateOf(run.outcome),
    offered_to: holder ? (holder.you ? 'you' : holder.label) : null,
    question: q ? { type: q.type, text: q.text } : null,
    answered: last ? { type: last.question.type, text: last.text } : null,
    sent_at: run.sent_at,
    offered_at: run.offered_at,
    compiled: run.compiled,
    you_cited: you && you.state === 'accept' && you.cited ? [you.cited] : [],
  };
}

/** Points the shared oti.sampleAsk at this run (the ask on screen), so /o/sample?ask=… shows the ask actually sent. */
export function syncSharedStore(run: SampleRun): void {
  if (run.example) return;
  const next = sharedStoreOf(run);
  const prev = readStore('sampleAsk');
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  writeStore('sampleAsk', next);
}
