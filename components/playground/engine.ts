/**
 * The engine behind `/rules` (“Be asked”): rules, a monthly limit, and the 12 sample asks checked against them.
 *
 * Framework-free on purpose: React subscribes with useSyncExternalStore (playground.tsx) and renders `getState()`;
 * tests drive it directly with a fake `/api/try` (tests/playground). Every mutation replaces the state object.
 *
 * What it guarantees (docs/CONTRACT.md §e):
 * - The button on an unedited preset renders the preset's recorded file at once, with no request, labelled by the
 *   file's real source. Edited rules and Retry call POST /api/try and render only what the stream returns. When
 *   live checks can't run, a short notice says why and the last real result stays.
 * - Any number of events may arrive in one chunk; each is applied in order, so the final state is the same.
 * - A lost stream keeps what arrived and re-requests only the missing ask ids. A failed gate is never an accept.
 * - The limit is recomputed here with `applyCap` (no model call).
 */

import type { PlaygroundStore } from '@/lib/oti/storage';
import { hex4, RULES_MAX } from '@/lib/oti/text';
import { fmtClock, fmtDay } from '@/lib/oti/time';
import type { QaState } from '@/lib/qa';
import { isAuthored, PRESET_RECORDINGS, recordedDateLabel, recordedGateEvent } from '@/lib/recorded';
import { isPresetId, presetById } from '@/lib/sample/presets';
import type { PostSseResult } from '@/lib/sse';
import type { BannerKind, GateErrorKind, LiveState, PresetId, SampleAskKey, TryEvent, TryRequest } from '@/lib/types';
import { liveBlockCopy, lostNote, retryOther, RULES_REJECTED, START_FAILED_NETWORK, startFailedStatus, type LiveBlock } from './copy';
import {
  ASK_IDS,
  ASKS,
  checkGate,
  checkingAnnounce,
  cloneRun,
  computeDisplays,
  countDisplays,
  indexOf,
  isAskId,
  isModelSource,
  normalizeLiveGate,
  ownQuotes,
  sortOrder,
  summaryAnnounce,
  TOTAL,
  type Displays,
  type Run,
  type RowError,
  type RowGate,
} from './model';
import type { PlaygroundStorage } from './store';

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export type Phase = 'idle' | 'running' | 'done';

export type NoteKey = 'degraded' | 'lost' | 'error';
export interface Note {
  key: NoteKey;
  kind: 'plain' | 'warn' | 'error';
  text: string;
  /** The one action a notice may carry. */
  action: 'retry-lost' | null;
  actionLabel: string | null;
}

/** What decides whether live checks can run (health, the browser, a 429, QA). */
export interface LiveEnv {
  /** From GET /api/health or a 503 from /api/try; `unknown` until either answers (then a live run just tries). */
  health: LiveState | 'unknown';
  /** End of a budget pause (epoch ms). */
  pausedUntil: number | null;
  /** End of this visitor's rate limit, from a 429's `retry_at` (epoch ms). */
  limitedUntil: number | null;
  offline: boolean;
  /** QA only: `?degraded=` or a QA state's degraded mode, shown with the prototype's example values. */
  qa: BannerKind | null;
}

export interface PgState {
  preset: PresetId;
  rules: string;
  cap: number;
  phase: Phase;
  run: Run | null;
  /** Ask ids the running request checks. */
  plan: SampleAskKey[] | null;
  /** Ask ids still checking. */
  pending: SampleAskKey[];
  /** The rules changed since the run on screen. */
  stale: boolean;
  slowNote: boolean;
  order: SampleAskKey[];
  notes: Note[];
  env: LiveEnv;
  qaState: QaState<'playground'> | null;
}

/** `health` seeds what the server knew when it rendered the page (`off` on an instance without a model key). */
export function initialState(health: LiveEnv['health'] = 'unknown'): PgState {
  const p = presetById('engineer');
  return {
    preset: p.id,
    rules: p.rules,
    cap: p.cap,
    phase: 'idle',
    run: null,
    plan: null,
    pending: [],
    stale: false,
    slowNote: false,
    order: [...ASK_IDS],
    notes: [],
    env: { health, pausedUntil: null, limitedUntil: null, offline: false, qa: null },
    qaState: null,
  };
}

/* ------------------------------------------------------------------ *
 * Derived values (pure)
 * ------------------------------------------------------------------ */

export function isEdited(s: Pick<PgState, 'rules' | 'preset'>): boolean {
  return s.rules !== presetById(s.preset).rules;
}

export function isEmpty(s: Pick<PgState, 'rules'>): boolean {
  return !s.rules.trim();
}

export function isOver(s: Pick<PgState, 'rules'>): boolean {
  return s.rules.length > RULES_MAX;
}

export function isInvalid(s: Pick<PgState, 'rules'>): boolean {
  return isEmpty(s) || isOver(s);
}

export function displaysOf(s: Pick<PgState, 'run' | 'pending' | 'cap' | 'phase'>): Displays {
  return computeDisplays(s.run, s.pending, s.cap, s.phase === 'running');
}

export function liveBlockOf(env: LiveEnv): LiveBlock | null {
  if (env.offline) return 'offline';
  if (env.qa) return env.qa === 'slow' ? null : env.qa;
  if (env.limitedUntil !== null) return 'limited';
  if (env.health === 'off' || env.health === 'down' || env.health === 'budget') return env.health;
  return null;
}

export function liveSlowOf(env: LiveEnv): boolean {
  return env.qa ? env.qa === 'slow' : env.health === 'slow';
}

/** The date and time a notice names. QA shows the prototype's example values (Dec 1, 10:42). */
export function blockValues(env: LiveEnv): { date: string; time: string } {
  if (env.qa) return { date: 'Dec 1', time: '10:42' };
  return {
    date: env.pausedUntil !== null ? fmtDay(env.pausedUntil) : 'next month',
    time: env.limitedUntil !== null ? fmtClock(env.limitedUntil) : '',
  };
}

export const RECORDED_FILE_AUTHORED = isAuthored(PRESET_RECORDINGS);
export const RECORDED_DATE = recordedDateLabel(PRESET_RECORDINGS.recorded_at);

function withRules(s: PgState, text: string): PgState {
  return { ...s, rules: text, stale: !!s.run && s.phase === 'done' && text !== s.run.rules };
}

function setNote(notes: readonly Note[], note: Note): Note[] {
  const i = notes.findIndex((n) => n.key === note.key);
  if (i < 0) return [...notes, note];
  const out = [...notes];
  out[i] = note;
  return out;
}

function dropNotes(notes: readonly Note[], keys: readonly NoteKey[]): Note[] {
  return notes.some((n) => keys.includes(n.key)) ? notes.filter((n) => !keys.includes(n.key)) : (notes as Note[]);
}

function blockNote(env: LiveEnv, block: LiveBlock): Note {
  return { key: 'degraded', kind: block === 'off' ? 'plain' : 'warn', text: liveBlockCopy(block, blockValues(env)), action: null, actionLabel: null };
}

/** The recorded run for a preset (no request): the embedded file, labelled by its source, quotes re-checked here. */
export function recordedRunFor(preset: PresetId, rules: string, now: number): Run {
  const file = PRESET_RECORDINGS;
  const pr = file.runs[preset];
  const authored = isAuthored(file);
  const run: Run = {
    id: `r_${hex4(`recorded:${preset}`)}`,
    mode: 'recorded',
    source: authored ? 'authored' : 'recorded',
    rules,
    preset,
    gates: {},
    errors: {},
    wall_ms: authored ? null : pr.wall_ms,
    cost_usd: authored ? null : pr.cost_usd,
    ran_at: new Date(now).toISOString(),
  };
  pr.gates.forEach((g, i) => {
    run.gates[g.ask_id] = checkGate({ ...recordedGateEvent(g, i, file) }, rules);
  });
  return run;
}

function newLiveRun(rules: string, preset: PresetId, now: number, seq: number): Run {
  return {
    id: `r_${hex4(`live:${rules}:${now}:${seq}`)}`,
    mode: 'live',
    source: 'live',
    rules,
    preset,
    gates: {},
    errors: {},
    wall_ms: null,
    cost_usd: null,
    ran_at: new Date(now).toISOString(),
  };
}

const ERROR_KINDS: readonly GateErrorKind[] = ['timeout', 'rate_limited', 'overloaded', 'refused', 'budget', 'parse'];
const LIVE_STATES: readonly LiveState[] = ['ok', 'slow', 'down', 'budget', 'off'];

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export interface EngineDeps {
  /** POST /api/try as SSE (lib/sse.ts postSse). */
  postTry: (body: TryRequest, onEvent: (event: TryEvent) => void, signal: AbortSignal) => Promise<PostSseResult>;
  announce: (message: string) => void;
  storage: PlaygroundStorage;
  now: () => number;
}

/** What a live run goes back to when the request is refused before its first event. */
type Revert = Pick<PgState, 'run' | 'phase' | 'plan' | 'pending' | 'slowNote' | 'notes' | 'order'>;

interface LiveRequest {
  seq: number;
  ctrl: AbortController;
  only: SampleAskKey[] | null;
  ids: SampleAskKey[];
  base: number;
  startedAt: number;
  revert: Revert;
  gotEvent: boolean;
  watchdog: boolean;
}

/** Client-side stop: the server hard-stops a run at 12 s, so a stream silent this long is lost. */
export const WATCHDOG_MS = 25_000;
/** “Still checking. 9 of 12 answered.” after 4 s (ux-spec §8). */
export const SLOW_NOTE_MS = 4_000;
export const AUTOSAVE_MS = 300;

export class PlaygroundEngine {
  private s: PgState;
  readonly initial: PgState;
  private readonly listeners = new Set<() => void>();
  private req: LiveRequest | null = null;
  private seq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private limitedTimer: ReturnType<typeof setTimeout> | null = null;
  private noSave = false;
  private booted = false;
  private qaApplied = false;

  constructor(
    private readonly deps: EngineDeps,
    options: { health?: LiveEnv['health'] } = {},
  ) {
    this.initial = initialState(options.health);
    this.s = this.initial;
  }

  /* ----- store protocol (useSyncExternalStore) ----- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = (): PgState => this.s;
  getInitial = (): PgState => this.initial;

  private commit(next: PgState): void {
    if (next === this.s) return;
    this.s = next;
    for (const fn of [...this.listeners]) fn();
  }

  /* ----- lifecycle ----- */

  /** Runs once after hydration: QA degraded mode, `?preset=`, or the tab's saved rules and last run. */
  boot(o: { qaState: QaState<'playground'> | null; degraded: BannerKind | null; preset: string | null; offline: boolean }): void {
    if (this.booted) return;
    this.booted = true;
    this.commit({ ...this.s, qaState: o.qaState, env: { ...this.s.env, qa: o.degraded, offline: o.offline } });
    if (o.preset && isPresetId(o.preset)) this.usePreset(o.preset);
    else if (!o.qaState) this.restore();
  }

  /** Stops the in-flight request and every timer (unmount). Saves what is pending. */
  dispose(): void {
    this.cancelLive();
    if (this.saveTimer) this.save();
    if (this.limitedTimer) clearTimeout(this.limitedTimer);
    this.limitedTimer = null;
  }

  /* ----- environment ----- */

  setHealth(live: unknown, until: unknown): void {
    if (!LIVE_STATES.includes(live as LiveState)) return;
    const ms = typeof until === 'string' ? Date.parse(until) : NaN;
    this.commit({ ...this.s, env: { ...this.s.env, health: live as LiveState, pausedUntil: Number.isNaN(ms) ? null : ms } });
  }

  setOffline(offline: boolean): void {
    const s = this.s;
    if (s.env.offline === offline) return;
    this.commit({ ...s, env: { ...s.env, offline }, notes: offline ? s.notes : dropNotes(s.notes, ['degraded']) });
  }

  private setLimited(until: number): void {
    const now = this.deps.now();
    const at = Number.isFinite(until) && until > now ? until : now + 10 * 60_000;
    this.commit({ ...this.s, env: { ...this.s.env, limitedUntil: at } });
    if (this.limitedTimer) clearTimeout(this.limitedTimer);
    this.limitedTimer = setTimeout(
      () => {
        this.limitedTimer = null;
        this.commit({ ...this.s, env: { ...this.s.env, limitedUntil: null } });
      },
      Math.min(at - now, 2 ** 31 - 1),
    );
  }

  /** Shows why live checks can't run (the designed notice) and returns true; false when they can. */
  blockLive(): boolean {
    const block = liveBlockOf(this.s.env);
    if (!block) return false;
    const note = blockNote(this.s.env, block);
    this.commit({ ...this.s, notes: setNote(this.s.notes, note) });
    this.deps.announce(note.text);
    return true;
  }

  /* ----- presets and rules ----- */

  /** An example button: replaces the rules and the limit with that preset's. */
  usePreset(id: PresetId): void {
    const p = presetById(id);
    this.commit(withRules({ ...this.s, preset: p.id, cap: p.cap }, p.rules));
    this.scheduleSave();
  }

  setRules(text: string): void {
    this.commit(withRules(this.s, text));
    this.scheduleSave();
  }

  /* ----- cap ----- */

  /** The monthly limit is applied in code: a finished run re-sorts at once, with no model call. */
  setCap(n: number): void {
    const s = this.s;
    if (!Number.isInteger(n) || n < 1 || n > 5 || n === s.cap) return;
    const done = !!s.run && s.phase === 'done';
    this.commit({ ...s, cap: n, order: done ? sortOrder(computeDisplays(s.run, [], n, false).map) : s.order });
    if (done) this.deps.announce(summaryAnnounce(countDisplays(computeDisplays(s.run, [], n, false).map), isModelSource((s.run as Run).source)));
    this.scheduleSave();
  }

  /* ----- runs ----- */

  /**
   * Run (the button, ⌘↵). Unedited preset: the recorded run at once. Edited rules: a live run.
   * Returns what happened: `blocked` means the live-check notice is showing.
   */
  run(): 'recorded' | 'live' | 'blocked' | null {
    const s = this.s;
    if (s.phase === 'running' || isInvalid(s)) return null;
    if (!isEdited(s)) {
      this.recordedRun();
      return 'recorded';
    }
    return this.liveRun() ? 'live' : 'blocked';
  }

  recordedRun(): void {
    this.cancelLive();
    const s = this.s;
    this.finish(recordedRunFor(s.preset, s.rules, this.deps.now()), {});
  }

  /**
   * Starts POST /api/try. Rows turn CHECKING at once (placeholders before any network call); if the request is
   * refused before the first event, the screen goes back to the last real result and the notice says why.
   */
  liveRun(opts: { only?: SampleAskKey[] } = {}): boolean {
    const s = this.s;
    if (s.phase === 'running') return false;
    if (this.blockLive()) return false;
    const only = opts.only && s.run ? opts.only.filter((id) => isAskId(id)) : null;
    if (only && !only.length) return false;
    const rules = only ? (s.run as Run).rules : s.rules;
    if (!only && (!rules.trim() || rules.length > RULES_MAX)) return false;
    this.cancelLive();
    const seq = ++this.seq;
    const now = this.deps.now();
    const ids = only ?? [...ASK_IDS];
    const base = only ? (s.run?.wall_ms ?? 0) : 0;
    const run = only ? cloneRun(s.run as Run) : newLiveRun(rules, s.preset, now, seq);
    for (const id of ids) {
      delete run.gates[id];
      delete run.errors[id];
    }
    const revert: Revert = { run: s.run, phase: s.phase, plan: s.plan, pending: s.pending, slowNote: s.slowNote, notes: s.notes, order: s.order };
    this.commit({
      ...s,
      phase: 'running',
      run,
      plan: ids,
      pending: ids,
      stale: false,
      order: only ? s.order : [...ASK_IDS],
      slowNote: false,
      notes: dropNotes(s.notes, ['lost', 'degraded', 'error']),
    });
    this.deps.announce(checkingAnnounce(ids.length));
    const ctrl = new AbortController();
    this.req = { seq, ctrl, only, ids, base, startedAt: now, revert, gotEvent: false, watchdog: false };
    this.slowTimer = setTimeout(() => this.onSlow(seq), SLOW_NOTE_MS);
    this.watchdogTimer = setTimeout(() => this.onWatchdog(seq), WATCHDOG_MS);
    const body: TryRequest = only ? { rules, ask_ids: ids } : { rules };
    let started: Promise<PostSseResult>;
    try {
      started = this.deps.postTry(body, (event) => this.onEvent(seq, event), ctrl.signal);
    } catch {
      started = Promise.resolve({ ok: false, status: 0, offline: true });
    }
    started.then(
      (res) => this.onResult(seq, res),
      () => this.onResult(seq, { ok: false, status: 0, offline: true }),
    );
    return true;
  }

  private elapsed(req: LiveRequest): number {
    return req.base + Math.max(0, this.deps.now() - req.startedAt);
  }

  private onEvent(seq: number, event: TryEvent): void {
    const req = this.req;
    if (!req || req.seq !== seq) return;
    const s = this.s;
    const run = s.run;
    if (!run || s.phase !== 'running' || !event || typeof event !== 'object') return;
    req.gotEvent = true;
    const data = (event.data ?? {}) as unknown as Record<string, unknown>;
    switch (event.event) {
      case 'plan': {
        if (req.only || typeof data.run_id !== 'string' || !/^[\w-]{1,40}$/.test(data.run_id)) return;
        this.commit({ ...s, run: { ...cloneRun(run), id: data.run_id } });
        return;
      }
      case 'gate': {
        const id = data.ask_id;
        if (!isAskId(id) || !s.pending.includes(id)) return;
        const verdict = data.verdict;
        if (verdict !== 'accept' && verdict !== 'decline' && verdict !== 'ask_back') return;
        const gate = normalizeLiveGate(
          {
            i: indexOf(id),
            ask_id: id,
            verdict,
            model_verdict: data.model_verdict === 'accept' || data.model_verdict === 'decline' || data.model_verdict === 'ask_back' ? data.model_verdict : verdict,
            cited: Array.isArray(data.cited) ? (data.cited as RowGate['cited']).filter((c) => c && typeof c.text === 'string') : [],
            decided_by: data.decided_by === 'clause_check' ? 'clause_check' : 'gate',
            reason_code: (typeof data.reason_code === 'string' ? data.reason_code : 'no_rule') as RowGate['reason_code'],
            reason: typeof data.reason === 'string' ? data.reason : '',
            question: data.question && typeof (data.question as { text?: unknown }).text === 'string' ? (data.question as RowGate['question']) : null,
            flags: Array.isArray(data.flags) ? (data.flags as RowGate['flags']).filter((f) => f === 'asker_not_founder' || f === 'instruction_in_ask') : [],
            confidence: typeof data.confidence === 'number' ? data.confidence : null,
            ms: typeof data.ms === 'number' ? data.ms : null,
            source: 'live',
          },
          run.rules,
        );
        const next = cloneRun(run);
        next.gates[id] = gate;
        this.commitResolved(s, next, [id]);
        return;
      }
      case 'error': {
        const kind = ERROR_KINDS.includes(data.kind as GateErrorKind) ? (data.kind as GateErrorKind) : 'overloaded';
        const err: RowError = { kind, ...(typeof data.retry_after_s === 'number' ? { retry_after_s: data.retry_after_s } : {}) };
        const id = isAskId(data.ask_id) ? data.ask_id : typeof data.i === 'number' ? ASK_IDS[data.i] : undefined;
        const next = cloneRun(run);
        if (id) {
          if (!s.pending.includes(id)) return;
          next.errors[id] = err;
          this.commitResolved(s, next, [id]);
          return;
        }
        // A run-level error (budget, a rate limit before any gate ran): the gates still waiting are not checked.
        for (const pid of s.pending) next.errors[pid] = { kind };
        this.commitResolved(s, next, [...s.pending]);
        if (kind === 'budget') this.commit({ ...this.s, env: { ...this.s.env, health: 'budget' } });
        if (kind === 'rate_limited') this.setLimited(this.deps.now() + (err.retry_after_s ?? 600) * 1000);
        if (kind === 'budget' || kind === 'rate_limited') {
          const note = blockNote(this.s.env, kind === 'budget' ? 'budget' : 'limited');
          this.commit({ ...this.s, notes: setNote(this.s.notes, note) });
        }
        return;
      }
      case 'done': {
        const next = cloneRun(run);
        const wall = typeof data.wall_ms === 'number' ? data.wall_ms : this.elapsed(req) - req.base;
        next.wall_ms = req.base + wall;
        const cost = typeof data.cost_usd === 'number' ? data.cost_usd : null;
        next.cost_usd = req.only ? (run.cost_usd !== null && cost !== null ? run.cost_usd + cost : null) : cost;
        this.endRequest();
        this.finish(next, { lost: s.pending.length > 0 });
        return;
      }
      default:
        return;
    }
  }

  /** Applies a run where `ids` just resolved. */
  private commitResolved(s: PgState, next: Run, ids: SampleAskKey[]): void {
    this.commit({ ...s, run: next, pending: s.pending.filter((x) => !ids.includes(x)) });
  }

  private onResult(seq: number, res: PostSseResult): void {
    const req = this.req;
    if (!req || req.seq !== seq) return;
    this.endRequest();
    if (res.ok) {
      this.finishLost(req);
      return;
    }
    if ('aborted' in res) {
      if (req.watchdog) this.finishLost(req);
      return;
    }
    if (req.gotEvent) {
      this.finishLost(req);
      return;
    }
    this.revert(req);
    if ('offline' in res) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline) {
        this.setOffline(true);
        this.blockLive();
      } else this.addNote({ key: 'error', kind: 'error', text: START_FAILED_NETWORK, action: null, actionLabel: null });
      return;
    }
    const body = (res.body ?? {}) as Record<string, unknown>;
    if (res.status === 429 || body.error === 'rate_limited') {
      const at = typeof body.retry_at === 'string' ? Date.parse(body.retry_at) : NaN;
      this.setLimited(at);
      this.blockLive();
      return;
    }
    if (res.status === 503 || body.error === 'live_unavailable') {
      const live = LIVE_STATES.includes(body.live as LiveState) ? (body.live as LiveState) : 'down';
      this.setHealth(live === 'ok' || live === 'slow' ? 'down' : live, body.until ?? null);
      if (!this.blockLive()) this.addNote({ key: 'error', kind: 'error', text: startFailedStatus(res.status), action: null, actionLabel: null });
      return;
    }
    if (res.status === 400) {
      const msg = typeof body.message === 'string' && body.message.length < 300 ? body.message : RULES_REJECTED;
      this.addNote({ key: 'error', kind: 'error', text: msg, action: null, actionLabel: null });
      return;
    }
    this.addNote({ key: 'error', kind: 'error', text: startFailedStatus(res.status), action: null, actionLabel: null });
  }

  private addNote(note: Note): void {
    this.commit({ ...this.s, notes: setNote(this.s.notes, note) });
    this.deps.announce(note.text);
  }

  private revert(req: LiveRequest): void {
    const next: PgState = { ...this.s, ...req.revert };
    this.commit({ ...next, stale: !!next.run && next.phase === 'done' && next.rules !== next.run.rules });
  }

  private finishLost(req: LiveRequest): void {
    const run = this.s.run;
    if (!run || this.s.phase !== 'running') return;
    const next = cloneRun(run);
    const missing = ASK_IDS.filter((id) => !next.gates[id] && !next.errors[id]).length;
    if (next.wall_ms === null || req.only) next.wall_ms = this.elapsed(req);
    this.finish(next, { lost: missing > 0 });
  }

  private onSlow(seq: number): void {
    if (this.req?.seq !== seq || this.s.phase !== 'running') return;
    this.commit({ ...this.s, slowNote: true });
  }

  private onWatchdog(seq: number): void {
    const req = this.req;
    if (!req || req.seq !== seq) return;
    req.watchdog = true;
    req.ctrl.abort();
  }

  private endRequest(): void {
    if (this.slowTimer) clearTimeout(this.slowTimer);
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.slowTimer = null;
    this.watchdogTimer = null;
    this.req = null;
  }

  /** Aborts the in-flight request without touching the screen (the caller replaces it). */
  private cancelLive(): void {
    const req = this.req;
    this.endRequest();
    if (req) req.ctrl.abort();
  }

  /** A run is done: sort once (what reaches you first), announce once, save. */
  private finish(run: Run, opts: { lost?: boolean; quiet?: boolean }): void {
    const s = this.s;
    const { map } = computeDisplays(run, [], s.cap, false);
    const missing = ASK_IDS.filter((id) => !run.gates[id] && !run.errors[id]).length;
    let notes = dropNotes(s.notes, ['lost']);
    if (opts.lost && missing) notes = setNote(notes, { key: 'lost', kind: 'warn', text: lostNote(TOTAL - missing, TOTAL), action: 'retry-lost', actionLabel: retryOther(missing) });
    this.commit({ ...s, run, phase: 'done', pending: [], plan: null, stale: s.rules !== run.rules, order: sortOrder(map), slowNote: false, notes });
    // One announcement when a run ends (never one per row); a lost stream says so in the same message.
    if (!opts.quiet) {
      const summary = summaryAnnounce(countDisplays(map), isModelSource(run.source));
      this.deps.announce(opts.lost && missing ? `${summary} ${lostNote(TOTAL - missing, TOTAL)}` : summary);
    }
    this.save();
  }

  /** “Retry the other 5” after a lost stream: re-requests only the missing ask ids. */
  retryLost(): boolean {
    const s = this.s;
    if (s.phase === 'running' || !s.run) return false;
    const run = s.run;
    const ids = ASK_IDS.filter((id) => !run.gates[id] && !run.errors[id]);
    if (!ids.length) return false;
    return this.liveRun({ only: ids });
  }

  /** Retry on a NOT CHECKED row. */
  retryOne(id: SampleAskKey): boolean {
    const s = this.s;
    if (s.phase === 'running' || !s.run || !s.run.errors[id]) return false;
    return this.liveRun({ only: [id] });
  }

  /* ----- storage ----- */

  scheduleSave(): void {
    if (this.noSave) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), AUTOSAVE_MS);
  }

  /** Writes oti.playground (rules, cap, preset and the last finished run's rows) and the last live run. */
  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.noSave) return;
    const s = this.s;
    const run = s.run && s.phase === 'done' && s.run.source !== 'fixture' ? s.run : null;
    const map = run ? computeDisplays(run, [], s.cap, false).map : null;
    const value: PlaygroundStore = {
      v: 1,
      preset: s.preset,
      rules: s.rules,
      cap: s.cap,
      edited: isEdited(s),
      run_id: run?.id ?? null,
      ran_at: run?.ran_at ?? null,
      mode: run?.mode ?? null,
      run_rules: run?.rules ?? null,
      results: run && map ? ASKS.map((a) => ({ ask_id: a.id, display: map[a.id].display, cited: ownQuotes(map[a.id].gate?.cited ?? [], (run as Run).rules) })) : [],
      marks: [],
    };
    this.deps.storage.save(value);
    this.deps.storage.saveRun(run && run.source === 'live' ? run : null);
  }

  /** Restores the tab's rules, cap and last run. Restored results are stale only if the rules changed since. */
  private restore(): boolean {
    const sv = this.deps.storage.load();
    if (!sv) return false;
    const preset = isPresetId(sv.preset) ? sv.preset : 'engineer';
    const capN = Math.round(Number(sv.cap));
    const cap = capN >= 1 && capN <= 5 ? capN : presetById(preset).cap;
    this.noSave = true;
    try {
      this.commit({ ...this.s, preset, cap });
      let restored: Run | null = null;
      if (typeof sv.run_rules === 'string' && Array.isArray(sv.results) && sv.results.length) {
        if (sv.mode === 'recorded' && sv.run_rules === presetById(preset).rules) restored = recordedRunFor(preset, sv.run_rules, this.deps.now());
        else {
          const last = this.deps.storage.loadRun();
          if (last && last.id === sv.run_id && last.rules === sv.run_rules && last.source === 'live') restored = last;
        }
      }
      if (restored) {
        this.commit({ ...this.s, rules: restored.rules });
        this.finish(restored, { quiet: true });
      }
      this.commit(withRules(this.s, typeof sv.rules === 'string' ? sv.rules : this.s.rules));
    } finally {
      this.noSave = false;
    }
    return true;
  }

  /* ----- QA states (prototype ?state= names; only when QA is enabled) ----- */

  /** Runs `fn` once with saving off. */
  qa(fn: () => void): void {
    if (this.qaApplied) return;
    this.qaApplied = true;
    this.noSave = true;
    try {
      fn();
    } finally {
      this.noSave = false;
    }
  }

  qaSetDegraded(kind: BannerKind | null): void {
    this.commit({ ...this.s, env: { ...this.s.env, qa: kind } });
  }

  /** A finished QA fixture run: example verdicts in the live layout, labelled as a fixture (never stored). */
  qaInstant(gates: Record<SampleAskKey, RowGate>, o: { fail?: SampleAskKey[]; lostAfter?: number } = {}): void {
    this.cancelLive();
    const s = this.s;
    const run = this.fixtureRun(s);
    const keep = o.lostAfter ? ASK_IDS.slice(0, o.lostAfter) : ASK_IDS;
    for (const id of keep) {
      if (o.fail?.includes(id)) {
        const err: RowError = { kind: 'timeout' };
        run.errors[id] = err;
        continue;
      }
      run.gates[id] = checkGate({ ...gates[id], i: indexOf(id), ask_id: id, source: 'fixture', ms: null, confidence: null }, s.rules);
    }
    this.finish(run, { lost: !!o.lostAfter });
  }

  /** A QA fixture frozen mid-stream: `resolved` rows answered, the rest CHECKING. */
  qaFrozen(gates: Record<SampleAskKey, RowGate>, resolved: readonly SampleAskKey[]): void {
    const s = this.s;
    const run = this.fixtureRun(s);
    for (const id of resolved) {
      run.gates[id] = checkGate({ ...gates[id], i: indexOf(id), ask_id: id, source: 'fixture', ms: null, confidence: null }, s.rules);
    }
    this.commit({
      ...s,
      phase: 'running',
      run,
      plan: [...ASK_IDS],
      pending: ASK_IDS.filter((id) => !resolved.includes(id)),
      stale: false,
      order: [...ASK_IDS],
    });
  }

  private fixtureRun(s: PgState): Run {
    return {
      id: `r_${hex4(`fixture:${s.rules}`)}`,
      mode: 'live',
      source: 'fixture',
      rules: s.rules,
      preset: s.preset,
      gates: {},
      errors: {},
      wall_ms: null,
      cost_usd: null,
      ran_at: new Date(this.deps.now()).toISOString(),
    };
  }
}
