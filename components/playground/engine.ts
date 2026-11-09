/**
 * S1 playground engine: the state machine behind `/`, ported from prototype/a.js `Playground()`.
 *
 * Framework-free on purpose: React subscribes with useSyncExternalStore (playground.tsx) and renders `getState()`;
 * tests drive it directly with a fake `/api/try` (tests/playground). Every mutation replaces the state object.
 *
 * What it guarantees (ux-spec S1, §8; docs/CONTRACT.md §e):
 * - Run on an unedited preset renders the preset's recorded file at once, with no request, labelled by the file's
 *   real source. Edits, “Run live”, Retry and the add-line edit call POST /api/try and render only what the stream
 *   returns. When live checks can't run, they show the designed notice and keep the last real result.
 * - Any number of events may arrive in one chunk; each is applied in order, so the final state is the same.
 * - A lost stream keeps what arrived and re-requests only the missing ask ids. A failed gate is never an accept.
 * - The cap is recomputed here with `applyCap` (no model call); the quote test swaps one row for a labelled fake
 *   output run through the real clause finder.
 */

import type { DisplayVerdict } from '@/lib/oti/cap';
import type { PlaygroundStore } from '@/lib/oti/storage';
import { hex4, joinAnd, plural, RULES_MAX } from '@/lib/oti/text';
import { fmtClock, fmtDay } from '@/lib/oti/time';
import type { QaState } from '@/lib/qa';
import { isAuthored, PRESET_RECORDINGS, recordedDateLabel, recordedGateEvent } from '@/lib/recorded';
import { ONE_TAP_EDITS } from '@/lib/sample/edits';
import { isPresetId, presetById } from '@/lib/sample/presets';
import type { OneTapEditAdd, OneTapEditCap } from '@/lib/sample/types';
import { CLAUSE_CHECK_TEST_OUTPUT } from '@/lib/sample/verdicts';
import type { PostSseResult } from '@/lib/sse';
import type { BannerKind, GateErrorKind, LiveState, PresetId, SampleAskKey, TryEvent, TryRequest } from '@/lib/types';
import { capNote, liveBlockCopy, lostNote, QA_FIXTURE, retryOther, RULES_REJECTED, START_FAILED_NETWORK, startFailedStatus, type LiveBlock } from './copy';
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
  runDiff,
  snapshotOf,
  sortOrder,
  summaryAnnounce,
  TOTAL,
  type Displays,
  type Run,
  type RowError,
  type RowGate,
  type Snapshot,
} from './model';
import type { PlaygroundStorage } from './store';

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export type Phase = 'idle' | 'running' | 'done';

export type Applied = { kind: 'add'; line: string; prevRules: string } | { kind: 'cap'; from: number; to: number } | { kind: 'test'; real: RowGate };

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
  /** A preset the visitor picked while their rules were edited: “Replace your rules with …?” */
  pendingPreset: PresetId | null;
  view: 'edit' | 'read';
  phase: Phase;
  run: Run | null;
  /** Ask ids the running request checks. */
  plan: SampleAskKey[] | null;
  /** Ask ids still checking. */
  pending: SampleAskKey[];
  liveOnly: boolean;
  /** Run diff: what each flipped row was. */
  changed: Partial<Record<SampleAskKey, DisplayVerdict>>;
  variance: SampleAskKey[];
  diff: string | null;
  capNote: string | null;
  marks: SampleAskKey[];
  stale: boolean;
  applied: Applied | null;
  traceOn: boolean;
  open: SampleAskKey | null;
  everDone: boolean;
  /** Desktop CTA: Run again is the black pill (stale results) instead of Keep these rules. */
  ctaBlack: boolean;
  slowNote: boolean;
  order: SampleAskKey[];
  grouped: boolean;
  orderVersion: number;
  animateOrder: boolean;
  notes: Note[];
  /** Bumped when a row resolves while streaming (260 ms white flash). */
  flash: Partial<Record<SampleAskKey, number>>;
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
    pendingPreset: null,
    view: 'edit',
    phase: 'idle',
    run: null,
    plan: null,
    pending: [],
    liveOnly: false,
    changed: {},
    variance: [],
    diff: null,
    capNote: null,
    marks: [],
    stale: false,
    applied: null,
    traceOn: false,
    open: null,
    everDone: false,
    ctaBlack: true,
    slowNote: false,
    order: [...ASK_IDS],
    grouped: false,
    orderVersion: 0,
    animateOrder: false,
    notes: [],
    flash: {},
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

export function editOf(preset: PresetId, kind: 'add'): OneTapEditAdd | null;
export function editOf(preset: PresetId, kind: 'cap'): OneTapEditCap | null;
export function editOf(preset: PresetId, kind: 'add' | 'cap'): OneTapEditAdd | OneTapEditCap | null {
  return ONE_TAP_EDITS[preset].find((e) => e.kind === kind) ?? null;
}

/** “Test the quote check” runs only on a finished recorded or example run: never inside a live run. */
export function canTestQuote(s: Pick<PgState, 'phase' | 'run'>): boolean {
  const g = s.run?.gates.a11;
  return s.phase === 'done' && !!s.run && s.run.source !== 'live' && !!g && g.decided_by !== 'clause_check' && g.source !== 'test';
}

function withRules(s: PgState, text: string): PgState {
  const next: PgState = { ...s, rules: text };
  if (s.run && s.phase === 'done') {
    const stale = text !== s.run.rules;
    if (stale !== s.stale) {
      next.stale = stale;
      next.ctaBlack = stale;
      if (stale) next.view = 'edit';
    }
  }
  return next;
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
  const id = `r_${hex4(`recorded:${preset}`)}`;
  const run: Run = {
    id,
    mode: 'recorded',
    source: authored ? 'authored' : 'recorded',
    rules,
    preset,
    gates: {},
    errors: {},
    events: [
      {
        kind: 'plan',
        t: authored ? null : 0,
        text: authored
          ? `example verdicts, written by hand · not a model run · ${TOTAL} asks · rules ${rules.length} chars`
          : `run ${id} · recorded ${recordedDateLabel(file.recorded_at)} · ${TOTAL} gates · rules ${rules.length} chars`,
      },
    ],
    wall_ms: authored ? null : pr.wall_ms,
    cost_usd: authored ? null : pr.cost_usd,
    ran_at: new Date(now).toISOString(),
  };
  pr.gates.forEach((g, i) => {
    const ev = checkGate({ ...recordedGateEvent(g, i, file) }, rules);
    run.gates[g.ask_id] = ev;
    run.events.push({ kind: 'gate', t: ev.ms, ev });
  });
  run.events.push({ kind: 'done', t: run.wall_ms, cost_usd: run.cost_usd });
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
    events: [],
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

export interface UiHooks {
  /** Called right before a new state replaces the old one (the view captures row positions and focus here). */
  beforeChange?: (prev: PgState, next: PgState) => void;
}

interface Revert {
  state: Pick<PgState, 'run' | 'phase' | 'plan' | 'pending' | 'liveOnly' | 'changed' | 'variance' | 'diff' | 'capNote' | 'grouped' | 'slowNote' | 'notes' | 'view' | 'ctaBlack'>;
  /** The add-line edit is undone too when its live run can't start. */
  edit: { rules: string; applied: Applied | null } | null;
}

interface LiveRequest {
  seq: number;
  ctrl: AbortController;
  only: SampleAskKey[] | null;
  ids: SampleAskKey[];
  prev: Snapshot | null;
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
  hooks: UiHooks = {};
  private readonly listeners = new Set<() => void>();
  private readonly activeListeners = new Set<() => void>();
  private active: SampleAskKey | null = null;
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

  /** The row being hovered or focused: its quoted words get `.is-active` in the read view. */
  subscribeActive = (fn: () => void): (() => void) => {
    this.activeListeners.add(fn);
    return () => {
      this.activeListeners.delete(fn);
    };
  };
  getActive = (): SampleAskKey | null => this.active;
  setActive = (id: SampleAskKey | null): void => {
    if (this.active === id) return;
    this.active = id;
    for (const fn of [...this.activeListeners]) fn();
  };

  setHooks(hooks: UiHooks): void {
    this.hooks = hooks;
  }

  private commit(next: PgState): void {
    if (next === this.s) return;
    this.hooks.beforeChange?.(this.s, next);
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

  /** The presets radiogroup: replaces the rules, or asks first when they were edited. */
  selectPreset(id: PresetId): void {
    if (isEdited(this.s)) {
      this.commit({ ...this.s, pendingPreset: id });
      return;
    }
    this.usePreset(id);
  }

  usePreset(id: PresetId): void {
    const p = presetById(id);
    this.commit(withRules({ ...this.s, preset: p.id, applied: null, pendingPreset: null, cap: p.cap }, p.rules));
    this.scheduleSave();
  }

  /** “Replace” in the confirmation. Returns the preset now selected. */
  replace(): PresetId | null {
    const v = this.s.pendingPreset;
    if (!v) return null;
    this.usePreset(v);
    return v;
  }

  /** “Keep mine”. */
  keepMine(): void {
    this.commit({ ...this.s, pendingPreset: null });
  }

  setRules(text: string): void {
    this.commit(withRules(this.s, text));
    this.scheduleSave();
  }

  editRules(): void {
    if (this.s.view !== 'edit') this.commit({ ...this.s, view: 'edit' });
  }

  /* ----- cap ----- */

  setCap(n: number, user: boolean): void {
    const s = this.s;
    if (!Number.isInteger(n) || n < 1 || n > 5) return;
    if (user && n === s.cap) return;
    const applied = user && s.applied?.kind === 'cap' && n !== s.applied.to ? null : s.applied;
    if (s.run && s.phase === 'done') {
      const before = displaysOf(s).map;
      const after = computeDisplays(s.run, [], n, false).map;
      const changed: Partial<Record<SampleAskKey, DisplayVerdict>> = {};
      const names: string[] = [];
      for (const a of ASKS) {
        if (before[a.id].display !== after[a.id].display) {
          changed[a.id] = before[a.id].display;
          names.push(a.company);
        }
      }
      const note = capNote(n);
      this.commit({
        ...s,
        cap: n,
        applied,
        changed,
        variance: [],
        capNote: note,
        diff: names.length ? `${names.length} changed since your last run: ${joinAnd(names)}.` : 'No verdict changed.',
      });
      this.deps.announce(`${note} ${names.length ? `${names.length} ${names.length === 1 ? 'verdict changed.' : 'verdicts changed.'}` : 'No verdict changed.'}`);
    } else {
      this.commit({ ...s, cap: n, applied });
    }
    this.scheduleSave();
  }

  /* ----- runs ----- */

  /**
   * Run (the button, the phone bar, ⌘↵). Unedited preset: the recorded run at once. Edited rules: a live run.
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
    const prev = s.run && s.phase === 'done' ? snapshotOf(s.run, displaysOf(s).map) : null;
    this.finish(recordedRunFor(s.preset, s.rules, this.deps.now()), prev, {});
  }

  /** “Run live” in the meta line: a live run on the same, unedited rules. */
  runLive(): boolean {
    if (this.s.phase === 'running') return false;
    return this.liveRun();
  }

  /**
   * Starts POST /api/try. Rows turn CHECKING at once (placeholders before any network call); if the request is
   * refused before the first event, the screen goes back to the last real result and the notice says why.
   */
  liveRun(opts: { only?: SampleAskKey[]; edit?: Revert['edit'] } = {}): boolean {
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
    const prev = !only && s.run && s.phase === 'done' ? snapshotOf(s.run, displaysOf(s).map) : null;
    const base = only ? (s.run?.wall_ms ?? 0) : 0;
    const run = only ? cloneRun(s.run as Run) : newLiveRun(rules, s.preset, now, seq);
    for (const id of ids) {
      delete run.gates[id];
      delete run.errors[id];
    }
    const revert: Revert = {
      state: {
        run: s.run,
        phase: s.phase,
        plan: s.plan,
        pending: s.pending,
        liveOnly: s.liveOnly,
        changed: s.changed,
        variance: s.variance,
        diff: s.diff,
        capNote: s.capNote,
        grouped: s.grouped,
        slowNote: s.slowNote,
        notes: s.notes,
        view: s.view,
        ctaBlack: s.ctaBlack,
      },
      edit: opts.edit ?? null,
    };
    this.commit({
      ...s,
      phase: 'running',
      run,
      plan: ids,
      pending: ids,
      liveOnly: !!only,
      changed: only ? s.changed : {},
      variance: only ? s.variance : [],
      diff: only ? s.diff : null,
      capNote: only ? s.capNote : null,
      stale: false,
      grouped: false,
      slowNote: false,
      notes: dropNotes(s.notes, ['lost', 'degraded', 'error']),
    });
    this.deps.announce(checkingAnnounce(ids.length));
    const ctrl = new AbortController();
    this.req = { seq, ctrl, only, ids, prev, base, startedAt: now, revert, gotEvent: false, watchdog: false };
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
        const next = cloneRun(run);
        if (!req.only && typeof data.run_id === 'string' && /^[\w-]{1,40}$/.test(data.run_id)) next.id = data.run_id;
        const chars = typeof data.rules_chars === 'number' ? data.rules_chars : next.rules.length;
        next.events.push({
          kind: 'plan',
          t: req.base,
          text: req.only ? `retry ${plural(req.ids.length, 'gate')} in run ${next.id}` : `run ${next.id} · live · ${req.ids.length} gates · rules ${chars} chars`,
        });
        this.commit({ ...s, run: next });
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
        next.events.push({ kind: 'gate', t: gate.ms === null ? this.elapsed(req) : req.base + gate.ms, ev: gate });
        this.commitResolved(s, next, [id]);
        return;
      }
      case 'error': {
        const kind = ERROR_KINDS.includes(data.kind as GateErrorKind) ? (data.kind as GateErrorKind) : 'overloaded';
        const err: RowError = { kind, ...(typeof data.retry_after_s === 'number' ? { retry_after_s: data.retry_after_s } : {}) };
        const id = isAskId(data.ask_id) ? data.ask_id : typeof data.i === 'number' ? ASK_IDS[data.i] : undefined;
        const next = cloneRun(run);
        const t = this.elapsed(req);
        if (id) {
          if (!s.pending.includes(id)) return;
          next.errors[id] = err;
          next.events.push({ kind: 'error', t, id, err });
          this.commitResolved(s, next, [id]);
          return;
        }
        // A run-level error (budget, a rate limit before any gate ran): the gates still waiting are not checked.
        next.events.push({ kind: 'runerror', t, err });
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
        next.events.push({ kind: 'done', t: next.wall_ms, cost_usd: next.cost_usd });
        this.endRequest();
        const missing = s.pending.length > 0;
        if (missing) next.events.push({ kind: 'lost', t: next.wall_ms, n: TOTAL - ASK_IDS.filter((x) => !next.gates[x] && !next.errors[x]).length });
        this.finish(next, req.prev, { lost: missing });
        return;
      }
      default:
        return;
    }
  }

  /** Applies a run where `ids` just resolved, flashing rows that left CHECKING. */
  private commitResolved(s: PgState, next: Run, ids: SampleAskKey[]): void {
    const pending = s.pending.filter((x) => !ids.includes(x));
    const before = displaysOf(s).map;
    const after = computeDisplays(next, pending, s.cap, true).map;
    const flash = { ...s.flash };
    for (const id of ASK_IDS) if (before[id].display === 'checking' && after[id].display !== 'checking') flash[id] = (flash[id] ?? 0) + 1;
    this.commit({ ...s, run: next, pending, flash });
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
    const s = this.s;
    let next: PgState = { ...s, ...req.revert.state };
    if (req.revert.edit) next = { ...next, rules: req.revert.edit.rules, applied: req.revert.edit.applied };
    const stale = !!next.run && next.phase === 'done' && next.rules !== next.run.rules;
    this.commit({ ...next, stale, ctaBlack: next.phase === 'done' ? stale : next.ctaBlack });
  }

  private finishLost(req: LiveRequest): void {
    const run = this.s.run;
    if (!run || this.s.phase !== 'running') return;
    const next = cloneRun(run);
    const missing = ASK_IDS.filter((id) => !next.gates[id] && !next.errors[id]).length;
    const t = this.elapsed(req);
    if (missing) next.events.push({ kind: 'lost', t, n: TOTAL - missing });
    if (next.wall_ms === null || req.only) next.wall_ms = t;
    this.finish(next, req.prev, { lost: missing > 0 });
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

  /** A run is done: re-sort once, diff with the previous run, switch to the read view, announce once, save. */
  private finish(run: Run, prev: Snapshot | null, opts: { lost?: boolean; quiet?: boolean }): void {
    const s = this.s;
    const applied = s.applied?.kind === 'test' ? null : s.applied;
    const stale = s.rules !== run.rules;
    const { map } = computeDisplays(run, [], s.cap, false);
    const d = runDiff(prev, run, map);
    const marks = (prev && prev.preset !== run.preset ? [] : s.marks).filter((id) => !d.changed[id]);
    const missing = ASK_IDS.filter((id) => !run.gates[id] && !run.errors[id]).length;
    let notes = dropNotes(s.notes, ['lost']);
    if (opts.lost && missing) notes = setNote(notes, { key: 'lost', kind: 'warn', text: lostNote(TOTAL - missing, TOTAL), action: 'retry-lost', actionLabel: retryOther(missing) });
    this.commit({
      ...s,
      run,
      phase: 'done',
      pending: [],
      plan: null,
      liveOnly: false,
      everDone: true,
      stale,
      applied,
      changed: d.changed,
      variance: d.variance,
      diff: d.diff,
      capNote: null,
      marks,
      ctaBlack: stale,
      order: sortOrder(map),
      grouped: true,
      orderVersion: s.orderVersion + 1,
      animateOrder: !opts.quiet && !this.noSave,
      view: stale ? 'edit' : 'read',
      slowNote: false,
      notes,
    });
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

  /** “Try the Engineer preset” in the all-declined notice. */
  tryEngineer(): ReturnType<PlaygroundEngine['run']> {
    this.commit({ ...this.s, pendingPreset: null });
    this.usePreset('engineer');
    return this.run();
  }

  /* ----- one-tap edits ----- */

  /** “+ No asks from health companies.”: appends the line and reruns live. */
  applyAdd(): boolean {
    const s = this.s;
    const add = editOf(s.preset, 'add');
    if (!add || s.phase === 'running') return false;
    if (this.blockLive()) return false;
    const rules = `${s.rules.replace(/\s+$/, '')}\n${add.line}`;
    if (rules.length > RULES_MAX) return false;
    const edit = { rules: s.rules, applied: s.applied };
    this.commit(withRules({ ...s, applied: { kind: 'add', line: add.line, prevRules: s.rules } }, rules));
    if (this.liveRun({ edit })) return true;
    this.commit(withRules({ ...this.s, applied: edit.applied }, edit.rules));
    return false;
  }

  /** “Cap 2 → 1”: recomputed here, no model call. */
  applyCapEdit(): boolean {
    const s = this.s;
    const e = editOf(s.preset, 'cap');
    if (!e || s.phase === 'running') return false;
    this.commit({ ...s, applied: { kind: 'cap', from: s.cap, to: e.to } });
    this.setCap(e.to, false);
    return true;
  }

  /**
   * “Test the quote check”: Mezquite Health's output is swapped for a labelled fake that quotes “Happy to take any
   * intro”, which isn't in the rules; the real clause finder declines it. Undo restores the real verdict.
   */
  applyQuoteTest(): boolean {
    const s = this.s;
    const run = s.run;
    if (!run || !canTestQuote(s)) return false;
    const real = run.gates.a11 as RowGate;
    const t = CLAUSE_CHECK_TEST_OUTPUT;
    const ev = checkGate(
      {
        i: indexOf(t.ask_id),
        ask_id: t.ask_id,
        verdict: t.verdict,
        model_verdict: t.verdict,
        cited: t.cited.map((text) => ({ text, found: false })),
        decided_by: 'gate',
        reason_code: t.reason_code,
        reason: t.reason,
        question: null,
        flags: [],
        confidence: t.confidence,
        ms: null,
        source: 'test',
      },
      run.rules,
    );
    const next = cloneRun(run);
    next.gates[t.ask_id] = ev;
    const before = displaysOf(s).map;
    const after = computeDisplays(next, [], s.cap, false).map;
    const changed: Partial<Record<SampleAskKey, DisplayVerdict>> = {};
    for (const id of ASK_IDS) if (before[id].display !== after[id].display) changed[id] = before[id].display;
    this.commit({
      ...s,
      run: next,
      applied: { kind: 'test', real },
      capNote: null,
      changed,
      variance: [],
      diff: null,
      order: sortOrder(after),
      grouped: true,
      orderVersion: s.orderVersion + 1,
      animateOrder: !this.noSave,
    });
    this.deps.announce('Test of the quote check: Mezquite Health is declined by code.');
    return true;
  }

  undoApplied(): void {
    const s = this.s;
    if (s.phase === 'running' || !s.applied) return;
    const ap = s.applied;
    if (ap.kind === 'add') {
      this.commit(withRules({ ...s, applied: null }, ap.prevRules));
      this.scheduleSave();
    } else if (ap.kind === 'test') {
      if (!s.run) return;
      const next = cloneRun(s.run);
      next.gates.a11 = ap.real;
      const map = computeDisplays(next, [], s.cap, false).map;
      this.commit({ ...s, run: next, applied: null, changed: {}, variance: [], diff: null, order: sortOrder(map), grouped: true, orderVersion: s.orderVersion + 1, animateOrder: true });
    } else {
      this.commit({ ...s, applied: null });
      this.setCap(ap.from, false);
    }
  }

  /* ----- rows ----- */

  /** One row open at a time. */
  toggleRow(id: SampleAskKey): void {
    this.commit({ ...this.s, open: this.s.open === id ? null : id });
  }

  toggleMark(id: SampleAskKey): void {
    const s = this.s;
    this.commit({ ...s, marks: s.marks.includes(id) ? s.marks.filter((x) => x !== id) : [...s.marks, id] });
    this.save();
  }

  setTrace(on: boolean): void {
    this.commit({ ...this.s, traceOn: on });
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
    let run = s.run && s.phase === 'done' && s.run.source !== 'fixture' ? s.run : null;
    // The quote test is a labelled fake: never store it as a result.
    if (run && s.applied?.kind === 'test') {
      run = cloneRun(run);
      run.gates.a11 = s.applied.real;
    }
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
      marks: run ? [...s.marks] : [],
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
      this.commit({ ...this.s, preset, cap, pendingPreset: null });
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
        this.finish(restored, null, { quiet: true });
        const marks = Array.isArray(sv.marks) && sv.run_id === restored.id ? sv.marks.filter((id): id is SampleAskKey => isAskId(id)) : [];
        this.commit({ ...this.s, marks });
      }
      this.commit(withRules(this.s, typeof sv.rules === 'string' ? sv.rules : this.s.rules));
    } finally {
      this.noSave = false;
    }
    return true;
  }

  /* ----- QA states (prototype ?state= names; only when QA is enabled) ----- */

  /** Runs `fn` once with saving and animation off. */
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

  qaSetMarks(ids: SampleAskKey[]): void {
    this.commit({ ...this.s, marks: ids });
  }

  /** A finished QA fixture run: example verdicts in the live layout, labelled as a fixture (never stored). */
  qaInstant(gates: Record<SampleAskKey, RowGate>, o: { fail?: SampleAskKey[]; lostAfter?: number } = {}): void {
    this.cancelLive();
    const s = this.s;
    const prev = s.run && s.phase === 'done' ? snapshotOf(s.run, displaysOf(s).map) : null;
    const run = this.fixtureRun(s);
    const keep = o.lostAfter ? ASK_IDS.slice(0, o.lostAfter) : ASK_IDS;
    for (const id of keep) {
      if (o.fail?.includes(id)) {
        const err: RowError = { kind: 'timeout' };
        run.errors[id] = err;
        run.events.push({ kind: 'error', t: null, id, err });
        continue;
      }
      const g = checkGate({ ...gates[id], i: indexOf(id), ask_id: id, source: 'fixture', ms: null, confidence: null }, s.rules);
      run.gates[id] = g;
      run.events.push({ kind: 'gate', t: null, ev: g });
    }
    if (o.lostAfter) run.events.push({ kind: 'lost', t: null, n: keep.length });
    else run.events.push({ kind: 'done', t: null, cost_usd: null });
    this.finish(run, prev, { lost: !!o.lostAfter });
  }

  /** A QA fixture frozen mid-stream: `resolved` rows answered, the rest CHECKING. */
  qaFrozen(gates: Record<SampleAskKey, RowGate>, resolved: readonly SampleAskKey[]): void {
    const s = this.s;
    const run = this.fixtureRun(s);
    for (const id of resolved) {
      const g = checkGate({ ...gates[id], i: indexOf(id), ask_id: id, source: 'fixture', ms: null, confidence: null }, s.rules);
      run.gates[id] = g;
      run.events.push({ kind: 'gate', t: null, ev: g });
    }
    this.commit({
      ...s,
      phase: 'running',
      run,
      plan: [...ASK_IDS],
      pending: ASK_IDS.filter((id) => !resolved.includes(id)),
      liveOnly: false,
      changed: {},
      variance: [],
      diff: null,
      capNote: null,
      stale: false,
      grouped: false,
    });
  }

  /** The add-line edit applied to the rules (the QA fixture then supplies the run). */
  qaAppendAddLine(): void {
    const s = this.s;
    const add = editOf(s.preset, 'add');
    if (!add) return;
    this.commit(withRules({ ...s, applied: { kind: 'add', line: add.line, prevRules: s.rules } }, `${s.rules.replace(/\s+$/, '')}\n${add.line}`));
  }

  private fixtureRun(s: PgState): Run {
    return {
      id: `r_${hex4(`fixture:${s.rules}:${s.orderVersion}`)}`,
      mode: 'live',
      source: 'fixture',
      rules: s.rules,
      preset: s.preset,
      gates: {},
      errors: {},
      events: [{ kind: 'plan', t: null, text: `${QA_FIXTURE} · ${TOTAL} asks · rules ${s.rules.length} chars` }],
      wall_ms: null,
      cost_usd: null,
      ran_at: new Date(this.deps.now()).toISOString(),
    };
  }
}
