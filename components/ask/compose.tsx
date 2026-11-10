'use client';

/**
 * S2 · the compose island on `/` (variant `home`) and `/ask` (variant `page`); port of prototype/ask.html + a.js
 * `Compose`, laid out chat-style since Nov 9 (Alan: “the main window should be like ChatGPT”). One specific ask:
 * the founder's text in one auto-growing composer with its action attached (Enter or ⌘↵ checks, Shift+Enter is a
 * newline), the sample prompts as pills, then the reply below it: a check for the 5 parts (POST /api/compile, or
 * the hand-written example for a sample pill), the subject, the exact card a member gets, then Send. The site is
 * a demo: every send goes to the 40 fictional members, to /ask/<sa_id>, whose state lives in this tab. One
 * component, one reducer: the variants differ only in the heading and the home page's card to the other side
 * (/rules).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useReducer, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { Bar } from '@/components/kit/blocks';
import { Button } from '@/components/kit/button';
import { cx } from '@/components/kit/cx';
import { Counter, Input, Textarea } from '@/components/kit/forms';
import { Kbd } from '@/components/kit/kbd';
import { OfferCard } from '@/components/kit/offer-card';
import { SampleTag, Tag, Verdict } from '@/components/kit/pills';
import { Notice } from '@/components/kit/surfaces';
import { announce } from '@/components/site/live-region';
import { askFacts, isYcApplicationAsk, validateAsk } from '@/lib/oti/ask';
import { publicId } from '@/lib/oti/ids';
import { MAKE_GATE_HREF } from '@/lib/oti/personal-gate';
import { readStore, type PlaygroundStore } from '@/lib/oti/storage';
import { ASK_TEXT_MAX, bareSubject, fmtN, SUBJECT_MAX } from '@/lib/oti/text';
import { fmtClock } from '@/lib/oti/time';
import type { QaState } from '@/lib/qa';
import { PRESET_RECORDINGS } from '@/lib/recorded';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { presetById, isPresetId } from '@/lib/sample/presets';
import { postSse } from '@/lib/sse';
import type { BannerKind, CompileDoneEvent, CompileEvent, CompileRefusedEvent, PresetId } from '@/lib/types';
import {
  checkingRows,
  compiledAskOf,
  composeReducer,
  exampleRows,
  initialCompose,
  isReady,
  isResolved,
  looksVague,
  openSuggestions,
  partsHead,
  partTag,
  rowFromCompiled,
  sampleAnswers,
  sampleKindOf,
  textProblem,
  unresolvedCount,
  withEdit,
  type ComposeState,
  type DownKind,
  type Note,
  type PartRow,
} from './compose-model';
import {
  ACTIONS_NO_SUBJECT,
  ACTIONS_OFFLINE,
  ACTIONS_READY,
  ACTIONS_STALE,
  ASK_LEDE,
  ASK_PLACEHOLDER,
  ASK_TITLE,
  barPartsLeft,
  COMPILE_FAILED,
  COMPILE_OFFLINE,
  COMPILE_SLOW,
  compileLimitedCopy,
  COMPOSER_LABEL,
  compilerDownCopy,
  EXAMPLE_PARTS_LABEL,
  HOME_LEDE,
  HOME_TITLE,
  liveBlockedCopy,
  GATE_LINK_CARD,
  GATE_LINK_NOTE,
  OTHER_SIDE_LINK,
  OTHER_SIDE_NOTE,
  PART_LABEL,
  partsLeftCopy,
  QUEUED_COPY,
  REFUSAL,
  SEND_LABEL,
} from './copy';
import { emptyRun } from './fanout-model';
import { reveal, isPhoneNow, useOnline, usePlayground } from './hooks';
import { stopSampleRun } from './sample-runner';
import { putRun } from './sample-store';
import { liveCanRun, type LiveInfo } from './types';

const DRAFT_KEY = 'oti.s2.draft';
const YC_SAMPLE_TEXT = 'Need 20 minutes with a YC alum to review our YC application before the batch deadline. We tried the online guides.';
/** The compiler should answer in about 3 s (ux-spec S2): a note at 8 s, the manual form at 15 s. */
const SLOW_MS = 8_000;
const GIVE_UP_MS = 15_000;

export interface AskComposeProps {
  qaState: QaState<'ask'> | null;
  degraded: BannerKind | null;
  live: LiveInfo;
  preset: PresetId | null;
  from: 'playground' | null;
  edit: boolean;
  /** `?new=1` (the status page's “‹ New ask”): start empty instead of from the draft kept in this tab. */
  fresh?: boolean;
  /** `home` on `/` (display H1, the card to /rules); `page` on /ask. Default `page`. */
  variant?: 'home' | 'page';
}

/* ---------- client-only start (sessionStorage), after hydration ---------- */

function readDraft(): string | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    const v = raw ? (JSON.parse(raw) as { v?: number; text?: unknown }) : null;
    return v && v.v === 1 && typeof v.text === 'string' ? v.text : null;
  } catch {
    return null;
  }
}

function writeDraft(text: string): void {
  try {
    if (text.trim()) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, text }));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked: the text just isn't kept */
  }
}

function startState(props: AskComposeProps, preset: PresetId): ComposeState {
  const sa = SAMPLE_NETWORK_ASKS[preset];
  const example = (text: string, kind: 'partial' | 'complete', base = initialCompose('sample', text)) =>
    composeReducer(base, { type: 'checkExample', text, rows: exampleRows(sa, kind), subject: sa.subject, topic: null });
  switch (props.qaState) {
    case 'empty':
      return initialCompose('sample');
    case 'filled':
      return initialCompose('sample', sa.partial);
    case 'compiling': {
      const s = composeReducer(initialCompose('sample', sa.partial), { type: 'checkStart', text: sa.partial });
      const rows = exampleRows(sa, 'partial');
      // Two hand-written parts already in, three still checking (labelled as example parts).
      return { ...s, source: 'example', parts: [...rows.slice(0, 2), ...checkingRows().slice(2)] };
    }
    case 'compiled':
      return example(sa.partial, 'partial');
    case 'ready':
      return composeReducer(example(sa.partial, 'partial'), { type: 'useAll' });
    case 'refused-vague':
      return composeReducer(initialCompose('sample', sa.vague), { type: 'checkRefused', kind: 'vague', text: sa.vague });
    case 'refused-yc':
      return composeReducer(initialCompose('sample', YC_SAMPLE_TEXT), { type: 'checkRefused', kind: 'yc_application', text: YC_SAMPLE_TEXT });
    case 'compiler-slow':
      return composeReducer(composeReducer(initialCompose('sample', sa.partial), { type: 'checkStart', text: sa.partial }), { type: 'checkSlow' });
    case 'compiler-down':
      return composeReducer(initialCompose('sample', sa.partial), { type: 'checkDown', kind: 'down', until: null, samples: sampleAnswers(sa), subject: sa.subject, text: sa.partial });
    default:
      break;
  }
  if (props.edit) return initialCompose('sample', withEdit(sa.complete, sa.noMatchEdit));
  if (props.from === 'playground') return initialCompose('sample', sa.partial);
  if (props.fresh) {
    writeDraft('');
    return initialCompose('sample');
  }
  return initialCompose('sample', readDraft() ?? '');
}

/** The rule a member would see quoted, for the preview: the visitor's own words from their playground run when it
 *  matched this sample ask, else the preset's hand-written verdict. Only for a sample text. */
function previewClause(preset: PresetId, pg: PlaygroundStore | null): string | null {
  const sa = SAMPLE_NETWORK_ASKS[preset];
  if (pg && pg.preset === preset && Array.isArray(pg.results)) {
    const hit = pg.results.find((r) => r.display === 'reach' && r.cited?.length);
    if (hit) return hit.cited[0] ?? null;
  }
  const gate = PRESET_RECORDINGS.runs[preset]?.gates.find((g) => g.ask_id === sa.based_on);
  const c = gate?.cited[0];
  if (!c || !c.found || typeof c.start !== 'number' || typeof c.end !== 'number') return null;
  return presetById(preset).rules.slice(c.start, c.end);
}

function downKindOf(live: unknown): DownKind {
  return live === 'off' ? 'off' : live === 'budget' ? 'budget' : 'down';
}

function untilLabel(iso: unknown): string | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

/* ---------- the island ---------- */

export function AskCompose(props: AskComposeProps) {
  const router = useRouter();
  const online = useOnline();
  const pg = usePlayground();
  const [st, dispatch] = useReducer(composeReducer, undefined, () => initialCompose('sample'));
  const booted = useRef(false);
  const compile = useRef<{ ctrl: AbortController; timers: ReturnType<typeof setTimeout>[] } | null>(null);
  const afterRender = useRef<(() => void) | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const preset: PresetId = props.preset ?? (pg && isPresetId(pg.preset) ? pg.preset : 'engineer');
  const sa = SAMPLE_NETWORK_ASKS[preset];
  const degraded = props.degraded;
  const offline = !online || degraded === 'offline';
  const live: LiveInfo =
    degraded === 'down' || degraded === 'budget' || degraded === 'off'
      ? { state: degraded, until: degraded === 'budget' ? 'Dec 1' : null }
      : degraded === 'slow'
        ? { state: 'slow', until: null }
        : props.live;

  // Start from the URL and this tab (playground preset, draft) once hydrated.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const pgNow = readStore('playground');
    const presetNow: PresetId = props.preset ?? (pgNow && isPresetId(pgNow.preset) ? pgNow.preset : 'engineer');
    dispatch({ type: 'boot', state: startState(props, presetNow) });
    if (props.fresh) {
      // Started empty once; a reload from here should bring back what gets typed next, so drop `?new=1`.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('new');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      } catch {
        /* the URL keeps ?new=1; nothing else depends on it */
      }
    }
  }, [props]);

  // Keep what the founder typed in this tab (“Your text is saved in this tab”).
  useEffect(() => {
    if (!booted.current || props.qaState) return;
    const t = setTimeout(() => writeDraft(st.text), 300);
    return () => clearTimeout(t);
  }, [st.text, props.qaState]);

  // Focus and scroll after the DOM shows the new state (phones: bring results into view).
  useEffect(() => {
    const fn = afterRender.current;
    afterRender.current = null;
    fn?.();
  });

  // The composer grows with its text (CSS caps it at half the viewport, then it scrolls).
  useLayoutEffect(() => {
    const t = textRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  }, [st.text]);

  // Abort a running check when leaving the page.
  useEffect(
    () => () => {
      const c = compile.current;
      if (c) {
        c.ctrl.abort();
        c.timers.forEach(clearTimeout);
      }
    },
    [],
  );

  const left = unresolvedCount(st.parts);
  const ready = isReady(st);
  const compiled = st.phase === 'compiled' && !st.stale;
  const problem = textProblem(st.text);
  const subjectOk = st.subject.trim().length > 0 && st.subject.length <= SUBJECT_MAX;
  // A send of the founder's own text needs live gates; a sample pill's text has hand-written verdicts.
  const liveBlocked = !liveCanRun(live) && !sampleKindOf(st.checked ?? st.text, sa);
  const canSend = ready && subjectOk && !st.sending && !offline && !liveBlocked;
  const canCheck = st.phase !== 'compiling' && !problem && !offline;
  const showResults = st.phase === 'compiled' && ready;

  /** The control of the first part that still needs the founder (rows carry data-open until resolved). */
  function firstOpenControl(): HTMLElement | null {
    return formRef.current?.querySelector<HTMLElement>('.ask-part[data-open] [data-input], .ask-part[data-open] [data-use], .ask-part[data-open] [data-sample-answer]') ?? null;
  }

  /** Phones: results render under the fold, so bring them into view (and focus the first part that needs you). */
  function onPhoneShow(selector: string, focusPart: boolean) {
    afterRender.current = () => {
      if (!isPhoneNow()) return;
      reveal(formRef.current?.querySelector(selector) ?? null);
      if (focusPart) firstOpenControl()?.focus({ preventScroll: true });
    };
  }

  /* ----- check ----- */

  function stopCompile() {
    const c = compile.current;
    if (!c) return;
    c.ctrl.abort();
    c.timers.forEach(clearTimeout);
    compile.current = null;
  }

  function announceParts(rows: readonly PartRow[]) {
    const c = rows.reduce(
      (a, r) => {
        if (r.state === 'found') a.found++;
        else if (r.state === 'suggested') a.suggested++;
        else if (r.state === 'missing') a.missing++;
        return a;
      },
      { found: 0, suggested: 0, missing: 0 },
    );
    announce(`5 parts: ${c.found} found, ${c.suggested} suggested, ${c.missing} missing.`);
  }

  async function check() {
    if (!canCheck) return;
    const text = st.text.trim();
    stopCompile();
    if (isYcApplicationAsk(text)) {
      // The same code check the server runs on every send: refused before any model call.
      dispatch({ type: 'checkRefused', kind: 'yc_application', text });
      announce(REFUSAL.yc_application.title);
      onPhoneShow('[data-note="refused"]', false);
      return;
    }
    const kind = sampleKindOf(text, sa);
    if (kind === 'partial' || kind === 'complete') {
      // A sample chip's text: its hand-written parts render at once, labelled (no compiler run, no request).
      const rows = exampleRows(sa, kind);
      dispatch({ type: 'checkExample', text, rows, subject: sa.subject, topic: null });
      announceParts(rows);
      onPhoneShow('#ask-parts', true);
      return;
    }
    if (degraded === 'limited') {
      dispatch({ type: 'checkLimited', retryAt: null });
      announce('Rate limited until 10:42.');
      return;
    }
    // Live checks off (no key) or paused for the budget, by the server's word or QA's ?degraded=: no request that
    // could only answer 503. Code still refuses a vague ask (the compiler's own rule); anything else gets the
    // manual 5-part form. While the API is merely down, the request below is still tried: it may be back.
    const known = degraded === 'down' || degraded === 'budget' || degraded === 'off' ? degraded : live.state === 'off' || live.state === 'budget' ? live.state : null;
    if (known) {
      if (looksVague(text)) {
        dispatch({ type: 'checkRefused', kind: 'vague', text });
        announce(REFUSAL.vague.title);
        onPhoneShow('[data-note="refused"]', false);
        return;
      }
      const k = downKindOf(known);
      dispatch({ type: 'checkDown', kind: k, until: live.until, samples: null, subject: null, text });
      announce(compilerDownCopy(k, live.until));
      onPhoneShow('#ask-parts', true);
      return;
    }
    const ctrl = new AbortController();
    const run = { ctrl, timers: [] as ReturnType<typeof setTimeout>[] };
    compile.current = run;
    let gaveUp = false;
    run.timers.push(setTimeout(() => dispatch({ type: 'checkSlow' }), SLOW_MS));
    run.timers.push(
      setTimeout(() => {
        gaveUp = true;
        ctrl.abort();
        dispatch({ type: 'checkDown', kind: 'down', until: null, samples: null, subject: null, text });
        announce(compilerDownCopy('down', null));
        onPhoneShow('#ask-parts', true);
      }, degraded === 'slow' ? GIVE_UP_MS + SLOW_MS : GIVE_UP_MS),
    );
    dispatch({ type: 'checkStart', text });
    announce('Checking your ask');
    let done: CompileDoneEvent | null = null;
    let refused: CompileRefusedEvent | null = null;
    let error: { kind: string } | null = null;
    const res = await postSse<CompileEvent>(
      '/api/compile',
      { text, network: 'sample' },
      (ev) => {
        if (ctrl.signal.aborted) return;
        if (ev.event === 'part' && ev.data && typeof ev.data.i === 'number' && ev.data.part) dispatch({ type: 'checkPart', i: ev.data.i, row: rowFromCompiled(ev.data.part, text) });
        else if (ev.event === 'done') done = ev.data;
        else if (ev.event === 'refused') refused = ev.data;
        else if (ev.event === 'error') error = ev.data;
      },
      { signal: ctrl.signal },
    );
    run.timers.forEach(clearTimeout);
    if (compile.current === run) compile.current = null;
    if (gaveUp || ('aborted' in res && res.aborted)) return;
    if (!res.ok) {
      if ('offline' in res) {
        dispatch({ type: 'checkOffline' });
        announce(COMPILE_OFFLINE);
        return;
      }
      const body = ('body' in res ? res.body : null) as { error?: string; live?: string; until?: string | null; retry_at?: string } | null;
      if (res.status === 429) {
        dispatch({ type: 'checkLimited', retryAt: body?.retry_at ?? null });
        announce('Rate limited.');
        return;
      }
      if (res.status === 503 || res.status >= 500) {
        const k = downKindOf(body?.live);
        dispatch({ type: 'checkDown', kind: k, until: untilLabel(body?.until), samples: null, subject: null, text });
        announce(compilerDownCopy(k, untilLabel(body?.until)));
        onPhoneShow('#ask-parts', true);
        return;
      }
      dispatch({ type: 'checkFailed' });
      announce(COMPILE_FAILED);
      return;
    }
    const r = refused as CompileRefusedEvent | null;
    const d = done as CompileDoneEvent | null;
    const e = error as { kind: string } | null;
    if (r) {
      const kindR = r.kind === 'yc_application' ? 'yc_application' : 'vague';
      dispatch({ type: 'checkRefused', kind: kindR, text });
      announce(REFUSAL[kindR].title);
      onPhoneShow('[data-note="refused"]', false);
    } else if (d && Array.isArray(d.parts) && d.parts.length === 5) {
      const rows = d.parts.map((p) => rowFromCompiled(p, text));
      dispatch({ type: 'checkDone', rows, subject: String(d.subject ?? '').slice(0, SUBJECT_MAX), topic: d.topic ?? null, draftId: d.draft_id ?? null });
      announceParts(rows);
      onPhoneShow('#ask-parts', true);
    } else {
      const k: DownKind = e?.kind === 'budget' ? 'budget' : 'down';
      dispatch({ type: 'checkDown', kind: k, until: null, samples: null, subject: null, text });
      announce(compilerDownCopy(k, null));
      onPhoneShow('#ask-parts', true);
    }
  }

  /* ----- send ----- */

  async function send() {
    if (!canSend) return;
    const ask = compiledAskOf(st);
    const text = st.text.trim();
    const valid = validateAsk(text, ask);
    if (!ask || !valid.ok) {
      dispatch({ type: 'sendFailed', note: { key: 'send', tone: 'error', title: null, body: valid.ok ? 'Check your ask first: all 5 parts are needed.' : valid.message, action: null } });
      return;
    }
    dispatch({ type: 'sendStart' });
    const kind = sampleKindOf(text, sa);
    const sampleId = kind ? sa.id : null;
    const id = sampleId ?? publicId('sampleAsk');
    const pgNow = readStore('playground');
    const you = pgNow && typeof pgNow.rules === 'string' && pgNow.rules.trim() ? { rules: pgNow.rules, cap: Math.max(1, Math.min(5, Math.round(pgNow.cap) || 2)) } : null;
    stopSampleRun(id);
    putRun(emptyRun({ id, preset, sample_ask_id: sampleId, text, compiled: ask, you, sent_at: Date.now() }));
    announce('Sending to 40 sample members.');
    router.push(`/ask/${id}`);
  }

  /* ----- events ----- */

  function onText(e: ChangeEvent<HTMLTextAreaElement>) {
    dispatch({ type: 'text', text: e.target.value });
  }
  /**
   * Chat-style keys: Enter checks the ask, Shift+Enter is a newline. ⌘↵ / Ctrl+↵ is left to the global shortcut,
   * which presses the page's primary (Check, or Send once the parts are in). On touch keyboards Enter stays a
   * newline (the composer's own button is right there), and IME composition is never interrupted.
   */
  function onTextKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    if (!compiled) void check();
  }
  function fill(kind: 'vague' | 'partial' | 'complete') {
    stopCompile();
    dispatch({ type: 'fill', text: sa[kind] });
  }
  function onUse(i: number) {
    dispatch({ type: 'partUse', i });
    afterRender.current = () => firstOpenControl()?.focus();
  }
  function onEdit(i: number) {
    dispatch({ type: 'partEdit', i });
    afterRender.current = () => formRef.current?.querySelector<HTMLElement>(`.ask-part[data-i="${i}"] [data-input]`)?.focus();
  }
  function onSampleAnswer(i: number) {
    dispatch({ type: 'partSample', i });
    afterRender.current = () => (formRef.current?.querySelector<HTMLElement>('[data-sample-answer], [data-use]') ?? formRef.current?.querySelector<HTMLElement>(`.ask-part[data-i="${i}"] [data-input]`))?.focus();
  }
  function onUseAll() {
    dispatch({ type: 'useAll' });
    announce('Used the sample suggestions.');
    afterRender.current = () => (firstOpenControl() ?? formRef.current?.querySelector<HTMLElement>('#ask-subject'))?.focus();
  }
  function jumpToNext() {
    const f = firstOpenControl();
    if (!f) return;
    reveal(f, 'center');
    f.focus({ preventScroll: true });
  }

  /* ----- render ----- */

  const showUseAll = st.phase === 'compiled' && !st.stale && openSuggestions(st.parts) > 1;
  const exampleLabel = st.source === 'example' || (st.source === 'manual' && st.parts?.some((p) => !!p.sample));
  const cap = pg && pg.rules?.trim() ? Math.max(1, Math.min(5, Math.round(pg.cap) || 2)) : 2;
  const clause = sampleKindOf(st.checked ?? '', sa) ? previewClause(preset, pg) : null;
  const facts = st.parts ? askFacts(compiledAskOf(st)?.parts ?? { challenge: '', tried: '', needs: '', by: '', offers: '' }) : [];
  const fromLine = [sa.as.name, sa.as.company, sa.as.stage, sa.as.city].join(' · ');
  const counterOver = st.text.length > ASK_TEXT_MAX;

  const checkLabel = st.phase === 'compiling' ? 'Checking…' : compiled ? 'Check again' : st.stale ? 'Check again' : 'Check my ask';
  const actionsMeta = st.stale
    ? ACTIONS_STALE
    : offline
      ? ACTIONS_OFFLINE
      : liveBlocked
        ? liveBlockedCopy(live.state, 'sample', live.until)
        : ready && !subjectOk
          ? ACTIONS_NO_SUBJECT
          : ready
            ? ACTIONS_READY
            : partsLeftCopy(left);
  // Phones: the bar already counts the parts left, so the meta shows only once the ask is ready.
  const metaPhoneHidden = !ready;

  const barSend = st.phase === 'compiled' && !st.stale;
  const barLeft = barSend && left > 0;
  const home = props.variant === 'home';

  return (
    <>
      <div className={cx('container container--col ask-chat', home && 'ask-chat--home')}>
        <header className={cx('page-head page-head--left ask-head', home && 'ask-head--home')}>
          {home ? <h1 className="h1">{HOME_TITLE}</h1> : <h1 className="title">{ASK_TITLE}</h1>}
          <p className="lede">{home ? HOME_LEDE : ASK_LEDE}</p>
        </header>

        <div className="ask-form" id="ask-form" ref={formRef}>
          <div className={cx('ask-composer', counterOver && 'is-invalid')}>
            <label className="sr-only" htmlFor="ask-text">
              {COMPOSER_LABEL}
            </label>
            <Textarea
              ref={textRef}
              className="ask-textarea"
              id="ask-text"
              rows={3}
              aria-describedby="ask-count"
              placeholder={ASK_PLACEHOLDER}
              value={st.text}
              onChange={onText}
              onKeyDown={onTextKey}
              invalid={counterOver}
              spellCheck
            />
            <div className="ask-composer__foot">
              <Counter id="ask-count" over={counterOver}>
                {fmtN(st.text.length)} / {fmtN(ASK_TEXT_MAX)}
              </Counter>
              <Button
                variant={compiled ? 'outline' : 'primary'}
                className="ask-composer__go"
                primary={!compiled}
                kbd={!compiled && st.phase !== 'compiling'}
                busy={st.phase === 'compiling'}
                aria-disabled={!canCheck}
                id="ask-check"
                onClick={() => void check()}
              >
                {checkLabel}
              </Button>
            </div>
          </div>
          <div className="ask-samples" id="ask-samples">
            <span className="meta" id="ask-samples-lbl">
              Try a sample:
            </span>
            <button className="chip" type="button" data-sample="vague" aria-describedby="ask-samples-lbl" onClick={() => fill('vague')}>
              Vague
            </button>
            <button className="chip" type="button" data-sample="partial" aria-describedby="ask-samples-lbl" onClick={() => fill('partial')}>
              Missing 2 parts
            </button>
            <button className="chip" type="button" data-sample="complete" aria-describedby="ask-samples-lbl" onClick={() => fill('complete')}>
              Complete
            </button>
          </div>
          <noscript>
            <div className="notice">
              <p>Checking and sending an ask needs JavaScript. Nothing was sent to anyone.</p>
            </div>
          </noscript>

          <div className="stack ask-notes" id="ask-notes">
            {st.notes.map((n) => (
              <NoteView key={n.key} note={n} />
            ))}
          </div>

          <section className={cx('list ask-parts', st.stale && 'is-stale')} id="ask-parts" aria-labelledby="ask-parts-head" aria-busy={st.phase === 'compiling' ? true : undefined} hidden={!st.parts}>
            <div className="list__head">
              <p className="small" id="ask-parts-head">
                {partsHead(st.parts)}
              </p>
              <span className="cluster ask-parts-acts">
                {showUseAll ? (
                  <Button size="sm" onClick={onUseAll}>
                    Use all {openSuggestions(st.parts)} suggestions
                  </Button>
                ) : null}
                <SampleTag />
              </span>
              {exampleLabel ? <p className="meta ask-parts-src">{EXAMPLE_PARTS_LABEL}</p> : null}
            </div>
            {(st.parts ?? []).map((p, i) => (
              <PartRowView
                key={`${p.key}-${st.flash[i] ?? 0}`}
                row={p}
                i={i}
                flash={(st.flash[i] ?? 0) > 0}
                onInput={(value) => dispatch({ type: 'partInput', i, value })}
                onUse={() => onUse(i)}
                onEdit={() => onEdit(i)}
                onSample={() => onSampleAnswer(i)}
              />
            ))}
          </section>

          <div className="field ask-subject" id="ask-subject-field" hidden={!showResults}>
            <div className="label-row">
              <label className="label" htmlFor="ask-subject">
                Subject, as members see it in their inbox
              </label>
              <Counter id="ask-subject-count" over={st.subject.length > SUBJECT_MAX}>
                {st.subject.length}/{SUBJECT_MAX}
              </Counter>
            </div>
            <Input id="ask-subject" type="text" maxLength={SUBJECT_MAX} autoComplete="off" aria-describedby="ask-subject-count" value={st.subject} onChange={(e) => dispatch({ type: 'subject', value: e.target.value })} invalid={showResults && !subjectOk} />
          </div>

          <section className="ask-preview" id="ask-preview" aria-labelledby="ask-preview-title" hidden={!showResults}>
            <div className="split ask-preview__head">
              <h2 className="h2" id="ask-preview-title">
                What a member sees
              </h2>
              <SampleTag />
            </div>
            <OfferCard
              titleId="ask-card-title"
              kicker={
                <>
                  <Tag kind="attn">Ask for you</Tag>
                  <span>1 of your {cap} this month</span>
                  <SampleTag />
                </>
              }
              title={bareSubject(st.subject) || ' '}
              from={fromLine}
              match={
                clause ? (
                  <>
                    Matched your rule: <mark className="mark">“{clause}”</mark>
                  </>
                ) : (
                  <>
                    Matched your rule: <span className="ink-2">the line from their own rules, quoted to them</span>
                  </>
                )
              }
              fine={`The founder sees your name only if you choose OK. A No is private. This counts as 1 of your ${cap} whatever you answer.`}
              facts={facts}
            />
          </section>

          <div className={cx('ask-actions', st.phase === 'compiled' && 'is-sticky')} id="ask-actions" hidden={st.phase !== 'compiled'}>
            <div className="btn-row">
              {st.phase === 'compiled' ? (
                <Button variant="primary" size="lg" className="hide-phone" primary={compiled} kbd={compiled && !st.sending} busy={st.sending} aria-disabled={!canSend} id="ask-send" onClick={() => void send()}>
                  {st.sending ? 'Sending…' : SEND_LABEL}
                </Button>
              ) : null}
              {st.phase === 'compiled' ? (
                <p className={cx('meta ask-actions__meta', metaPhoneHidden && 'hide-phone')} id="ask-actions-meta">
                  {actionsMeta}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {home ? <OtherSide /> : null}
      </div>

      {barSend ? (
        <Bar>
          {barLeft ? (
            <button className="bar__text ask-bar-left" type="button" id="ask-bar-text" onClick={jumpToNext}>
              {barPartsLeft(left)}
            </button>
          ) : null}
          <Button
            variant="primary"
            className={cx('ask-bar-btn', !barLeft && 'ask-bar-full')}
            primary
            busy={st.sending}
            aria-disabled={!canSend}
            id="ask-bar-btn"
            onClick={() => {
              if (canSend) void send();
            }}
          >
            {st.sending ? 'Sending…' : SEND_LABEL}
          </Button>
        </Bar>
      ) : null}
    </>
  );
}

/* ---------- the other side (home only) ---------- */

/** Under the composer on `/`: one card to the member's side (/rules), one to your own gate link (/rules#make-gate). */
function OtherSide() {
  return (
    <section className="ask-other" id="ask-other" aria-label="The other side">
      <Link className="ask-other__card" href="/rules">
        <span className="ask-other__link">{OTHER_SIDE_LINK}</span>
        <span className="meta">{OTHER_SIDE_NOTE}</span>
      </Link>
      <Link className="ask-other__card" href={MAKE_GATE_HREF}>
        <span className="ask-other__link">{GATE_LINK_CARD}</span>
        <span className="meta">{GATE_LINK_NOTE}</span>
      </Link>
    </section>
  );
}

/* ---------- parts ---------- */

function PartRowView({
  row,
  i,
  flash,
  onInput,
  onUse,
  onEdit,
  onSample,
}: {
  row: PartRow;
  i: number;
  flash: boolean;
  onInput: (v: string) => void;
  onUse: () => void;
  onEdit: () => void;
  onSample: () => void;
}) {
  const tag = partTag(row);
  const id = `ask-p-${row.key}`;
  return (
    <div className={cx('row ask-part', flash && 'is-flash')} data-i={i} data-open={isResolved(row) ? undefined : ''}>
      <p className="ask-part__label">{PART_LABEL[row.key]}</p>
      <p className="ask-part__tag" data-tag="">
        {tag.kind === 'checking' ? <Verdict kind="checking">Checking</Verdict> : <Tag kind={tag.outline ? 'outline' : 'plain'}>{tag.text}</Tag>}
      </p>
      <div className="ask-part__body">
        {row.state === 'found' ? (
          <>
            <p className="ask-part__text">“{row.text}”</p>
            <p className="meta">{row.note}</p>
          </>
        ) : row.state === 'suggested' || row.state === 'approved' ? (
          <>
            <p className="ask-part__text">{row.text}</p>
            <p className="meta">{row.note}</p>
            {row.state === 'suggested' ? (
              <div className="btn-row ask-part__acts">
                <Button size="sm" data-use="" onClick={onUse}>
                  Use
                </Button>
                <Button variant="ghost" size="sm" data-edit="" onClick={onEdit}>
                  Edit
                </Button>
              </div>
            ) : null}
          </>
        ) : row.state === 'missing' || row.state === 'editing' ? (
          <>
            <div className="field ask-part__field">
              <label className="label" htmlFor={id}>
                {row.question}
              </label>
              <input className="input" id={id} type="text" autoComplete="off" value={row.value} onChange={(e) => onInput(e.target.value)} data-input="" maxLength={200} />
            </div>
            {row.sample && row.value !== row.sample ? (
              <Button variant="ghost" size="sm" className="ask-part__sample" data-sample-answer="" onClick={onSample}>
                Use sample answer
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- notices ---------- */

function NoteView({ note }: { note: Note }) {
  switch (note.key) {
    case 'refused': {
      const r = REFUSAL[note.kind];
      return (
        <div data-note="refused">
          <Notice title={r.title}>{r.body}</Notice>
        </div>
      );
    }
    case 'slow':
      return (
        <div data-note="slow">
          <Notice>{COMPILE_SLOW}</Notice>
        </div>
      );
    case 'down':
      return (
        <div data-note="down">
          <Notice kind={note.kind === 'off' ? 'plain' : 'warn'}>{compilerDownCopy(note.kind, note.until)}</Notice>
        </div>
      );
    case 'limited':
      return (
        <div data-note="limited">
          <Notice kind="warn">{compileLimitedCopy(note.retryAt && !Number.isNaN(Date.parse(note.retryAt)) ? fmtClock(Date.parse(note.retryAt)) : '10:42')}</Notice>
        </div>
      );
    case 'offline':
      return (
        <div data-note="offline">
          <Notice>{COMPILE_OFFLINE}</Notice>
        </div>
      );
    case 'failed':
      return (
        <div data-note="failed">
          <Notice kind="error">{COMPILE_FAILED}</Notice>
        </div>
      );
    case 'stale':
      return (
        <div data-note="stale">
          <Notice>
            Your text changed. Check again <Kbd /> to update the 5 parts.
          </Notice>
        </div>
      );
    case 'queued':
      return (
        <div data-note="queued">
          <Notice>{QUEUED_COPY}</Notice>
        </div>
      );
    case 'send':
      return (
        <div data-note="send">
          <Notice kind={note.tone} title={note.title ?? undefined}>
            {note.body}
          </Notice>
        </div>
      );
  }
}
