/**
 * Sends a SAMPLE ask: POST /api/asks/sample (BE2) and records the fan-out in the tab as it streams.
 *
 * The run lives in module scope, not in a component, so it finishes and is saved even if the page re-renders,
 * React mounts the status page twice in development, or the visitor navigates away mid-stream. A reload mid-stream
 * sends again (nothing about a SAMPLE ask is stored on a server, so there is nothing to resume).
 * Rendering must be right even when every event arrives in one chunk (an authored file streams at once).
 */

import { postSse } from '@/lib/sse';
import { OFFER_WINDOW_MS } from '@/lib/oti/time';
import type { FanoutCellEventSample, FanoutEvent, FanoutOfferEvent, FanoutQuestionEvent } from '@/lib/types';
import { NETWORK_TOTAL, outcomeAfterDone, rankAccepts, type SampleRun } from './fanout-model';
import { reducedMotionNow } from './hooks';
import { getRun, updateRun } from './sample-store';

/** The request body BE2's POST /api/asks/sample takes (SampleSendInput in lib/server/dispatch.ts, server-only). */
export function sampleSendBody(run: Pick<SampleRun, 'sample_ask_id' | 'text' | 'compiled' | 'you'>) {
  return { sample_ask_id: run.sample_ask_id, text: run.text, compiled: run.compiled, you: run.you };
}

const active = new Map<string, AbortController>();
/** Asks whose offer arrived while this page was open (the count bumps once, never on a reload). */
const offersSeen = new Set<string>();

export function offerArrivedHere(id: string): boolean {
  return offersSeen.has(id);
}

export function isRunning(id: string): boolean {
  return active.has(id);
}

/** Starts the stream for a run that is waiting to be sent (or was cut off by a reload). Idempotent. */
export function ensureSampleRun(id: string): void {
  if (active.has(id)) return;
  const run = getRun(id);
  if (!run || (run.outcome !== 'ready' && run.outcome !== 'streaming')) return;
  start(id);
}

/**
 * Stops the stream of a run that is about to be replaced (the same sample ask sent again from /ask while its last
 * fan-out is still streaming), so the new run starts its own stream instead of waiting on the old one.
 */
export function stopSampleRun(id: string): void {
  active.get(id)?.abort();
  active.delete(id);
}

/** Sends again from scratch: Retry after a failure, Try again after a refusal, or a send from a fresh tab. */
export function resendSampleRun(id: string): void {
  active.get(id)?.abort();
  active.delete(id);
  const now = Date.now();
  updateRun(id, (r) => ({ ...resetFanout(r), outcome: 'ready', sent_at: now }));
  start(id);
}

function resetFanout(r: SampleRun): SampleRun {
  return {
    ...r,
    plan: null,
    cells: new Array(NETWORK_TOTAL).fill(null),
    questions: [],
    offer: null,
    done: null,
    offered: [],
    offered_at: null,
    answers: [],
    member_answer: null,
    withdrawn_at: null,
    closed_at: null,
    refusal: null,
  };
}

function start(id: string): void {
  const run = getRun(id);
  if (!run) return;
  const ctrl = new AbortController();
  active.set(id, ctrl);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const since = () => Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
  updateRun(id, (r) => ({ ...resetFanout(r), outcome: 'streaming' }));
  // Reduced motion: ask for the whole fan-out at once instead of a replay at recorded speed.
  const url = reducedMotionNow() ? '/api/asks/sample?replay=0' : '/api/asks/sample';
  void postSse<FanoutEvent>(url, sampleSendBody(run), (ev) => onEvent(id, ev, since()), { signal: ctrl.signal })
    .then((res) => {
      if (active.get(id) !== ctrl) return; // superseded by a resend
      if (res.ok) {
        updateRun(id, (r) => (r.outcome === 'streaming' ? { ...r, outcome: 'lost' } : r));
        return;
      }
      if ('aborted' in res) return;
      if ('offline' in res) {
        updateRun(id, (r) => ({ ...r, outcome: 'offline' }));
        return;
      }
      const body = (res.body ?? {}) as { error?: string; message?: string; retry_at?: string };
      updateRun(id, (r) => ({
        ...r,
        outcome: 'refused',
        refusal: { status: res.status, error: typeof body.error === 'string' ? body.error : 'error', message: typeof body.message === 'string' ? body.message : '', retry_at: typeof body.retry_at === 'string' ? body.retry_at : undefined },
      }));
    })
    .catch(() => {
      if (active.get(id) === ctrl) updateRun(id, (r) => (r.outcome === 'streaming' ? { ...r, outcome: 'lost' } : r));
    })
    .finally(() => {
      if (active.get(id) === ctrl) active.delete(id);
    });
}

/** Folds one fan-out event into the run. Exported for tests (the order and chunking of events must not matter). */
export function foldEvent(r: SampleRun, ev: FanoutEvent, at: number | null): SampleRun {
  switch (ev.event) {
    case 'plan': {
      const total = Math.max(1, Math.min(200, Math.round(ev.data.total) || NETWORK_TOTAL));
      const cells = r.cells.length === total ? r.cells : new Array(total).fill(null);
      return { ...r, plan: ev.data, cells };
    }
    case 'cell': {
      const c = ev.data as FanoutCellEventSample;
      if (typeof c.cell !== 'number' || c.cell < 0) return r;
      const cells = r.cells.slice();
      while (cells.length <= c.cell) cells.push(null);
      cells[c.cell] = { ...c, at };
      return { ...r, cells };
    }
    case 'question': {
      const q = ev.data as FanoutQuestionEvent;
      if (r.questions.some((x) => x.qid === q.qid)) return r;
      return { ...r, questions: [...r.questions, { ...q, at }] };
    }
    case 'offer': {
      const o = ev.data as FanoutOfferEvent;
      const pos = typeof o.cell === 'number' ? o.cell : rankAccepts(r.cells)[0];
      const expires = Date.parse(o.expires_at);
      return { ...r, offer: { ...o, at }, offered: pos === undefined ? [] : [pos], offered_at: Number.isNaN(expires) ? Date.now() : expires - OFFER_WINDOW_MS };
    }
    case 'error':
      return { ...r, refusal: { status: 0, error: ev.data.kind, message: ev.data.message } };
    case 'done': {
      const next = { ...r, done: { ...ev.data, at } };
      return { ...next, outcome: outcomeAfterDone(next) };
    }
    default:
      return r;
  }
}

function onEvent(id: string, ev: FanoutEvent, at: number): void {
  if (ev.event === 'offer') offersSeen.add(id);
  updateRun(id, (r) => (r.outcome === 'streaming' ? foldEvent(r, ev, at) : r));
}
