'use client';

/**
 * S1 · the playground (`/`), the page every reviewer sees first (ux-spec S1). A client island over a static page:
 * the server renders the default state (Engineer rules, 12 Not run rows) and the dated REAL line; after hydration
 * the engine restores the tab's rules, applies a QA state, reads /api/health and takes over.
 */

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bar } from '@/components/kit/blocks';
import { cx } from '@/components/kit/cx';
import { Kbd, KBD_SHORTCUTS } from '@/components/kit/kbd';
import { RealTag } from '@/components/kit/pills';
import { announce } from '@/components/site/live-region';
import { PROTOTYPE_NUMBERS_NOTE } from '@/lib/oti/copy';
import { resolveDegraded, resolveQaState } from '@/lib/qa';
import { postSse } from '@/lib/sse';
import type { PresetId, SampleAskKey, TryEvent } from '@/lib/types';
import { H1, KEEP, LEDE, OFFER_LINK, RUN_AGAIN, RUN_FIRST, runNote } from './copy';
import { afterPaint, focusId, focusSelector, isPhone, reducedMotion, scrollToId } from './dom';
import { blockValues, isEdited, isInvalid, liveBlockOf, liveSlowOf, PlaygroundEngine, RECORDED_DATE, RECORDED_FILE_AUTHORED, type EngineDeps } from './engine';
import { ListSection, type ListActions } from './list';
import { ASK_IDS, checkingLabel, computeDisplays, countDisplays, TOTAL } from './model';
import { Rail, type RailActions } from './rail';
import { browserStorage } from './store';

const DEPS: EngineDeps = {
  postTry: (body, onEvent, signal) => postSse<TryEvent>('/api/try', body, (event) => onEvent(event), { signal }),
  announce,
  storage: browserStorage,
  now: () => Date.now(),
};

export interface PlaygroundProps {
  /** The dated REAL line, already worded on the server (getRealLine); null renders none (database down). */
  realLine: string | null;
  /** The prototype's example REAL line, for QA states only (null when QA is off). */
  qaRealLine: string | null;
  /** qaEnabled() from the server: whether `?state=` and `?degraded=` are honoured. */
  qa: boolean;
  /** Whether this instance has a model key (lib/env). Without one the static HTML already says live checks are off. */
  liveConfigured: boolean;
}

export function Playground({ realLine, qaRealLine, qa, liveConfigured }: PlaygroundProps) {
  const [engine] = useState(() => new PlaygroundEngine(DEPS, { health: liveConfigured ? 'unknown' : 'off' }));
  const s = useSyncExternalStore(engine.subscribe, engine.getState, engine.getInitial);
  const { run, pending, cap, phase } = s;
  const disp = useMemo(() => computeDisplays(run, pending, cap, phase === 'running'), [run, pending, cap, phase]);
  const c = useMemo(() => countDisplays(disp.map), [disp]);
  const flip = useRef<Map<string, number> | null>(null);
  const refocus = useRef<string | null>(null);

  // Boot once after hydration: QA state and degraded mode, ?preset=, the tab's saved rules; then health and network.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qaState = resolveQaState('playground', params.get('state'), qa);
    const degraded = resolveDegraded(params.get('degraded'), qa);
    engine.boot({ qaState, degraded, preset: params.get('preset'), offline: navigator.onLine === false });
    let cancelled = false;
    if (qaState && qaState !== 'not-run') {
      import('./qa-fixtures')
        .then((m) => {
          if (!cancelled) m.applyQaState(engine, qaState);
        })
        .catch(() => undefined);
    }
    const ctrl = new AbortController();
    if (!degraded) {
      fetch('/api/health', { signal: ctrl.signal, headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<{ live?: unknown; live_paused_until?: unknown }>) : null))
        .then((h) => {
          if (h && !cancelled) engine.setHealth(h.live, h.live_paused_until);
        })
        .catch(() => undefined);
    }
    const onOnline = () => engine.setOffline(false);
    const onOffline = () => engine.setOffline(true);
    const onHide = () => engine.save();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onHide);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onHide);
      engine.dispose();
    };
  }, [engine, qa]);

  // Row positions before a re-sort (FLIP), and focus that would be lost when the textarea becomes the read view.
  useEffect(() => {
    engine.setHooks({
      beforeChange(prev, next) {
        if (next.orderVersion !== prev.orderVersion && next.animateOrder && !reducedMotion()) {
          const tops = new Map<string, number>();
          for (const id of ASK_IDS) {
            const el = document.getElementById(`pg-row-${id}`);
            if (el && !el.hidden) tops.set(id, el.getBoundingClientRect().top);
          }
          flip.current = tops;
        }
        if (prev.view === 'edit' && next.view === 'read' && document.activeElement?.id === 'pg-rules') refocus.current = 'pg-rules-list';
      },
    });
    return () => engine.setHooks({});
  }, [engine]);

  // Re-sort at done: rows move with a 200 ms FLIP transform (instant under reduced motion).
  useLayoutEffect(() => {
    const tops = flip.current;
    flip.current = null;
    if (!tops) return;
    const moved: HTMLElement[] = [];
    for (const [id, top] of tops) {
      const el = document.getElementById(`pg-row-${id}`);
      if (!el) continue;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      moved.push(el);
    }
    if (!moved.length) return;
    afterPaint(() =>
      afterPaint(() => {
        for (const el of moved) {
          el.style.transition = 'transform 200ms cubic-bezier(.2,0,0,1)';
          el.style.transform = '';
        }
      }),
    );
    const reset = () => {
      for (const el of moved) {
        el.style.transition = '';
        el.style.transform = '';
      }
    };
    const t = setTimeout(reset, 260);
    return () => {
      clearTimeout(t);
      reset();
    };
  }, [s.orderVersion]);

  useLayoutEffect(() => {
    const id = refocus.current;
    refocus.current = null;
    if (id) document.getElementById(id)?.focus();
  }, [s.view]);

  const actions = useMemo(() => {
    const runFrom = (fromBar: boolean) => {
      const r = engine.run();
      if (!fromBar || !r) return;
      // Phones: bring the statline into view under the header (or the notice, when live checks can't run).
      scrollToId(r === 'blocked' ? 'pg-notes' : 'pg-lhead');
    };
    const focusUndo = () => focusSelector('#pg-try [data-act="undo"]');
    const list: ListActions & { run(fromBar: boolean): void } = {
      run: runFrom,
      toggleRow: (id: SampleAskKey) => engine.toggleRow(id),
      toggleMark: (id: SampleAskKey) => engine.toggleMark(id),
      retry: (id: SampleAskKey) => {
        if (engine.retryOne(id)) focusSelector(`#pg-row-${id} .row__toggle`);
      },
      setActive: (id: SampleAskKey | null) => engine.setActive(id),
      runLive: () => {
        if (engine.runLive()) focusId('pg-lhead', { preventScroll: true });
      },
      setTrace: (on: boolean) => engine.setTrace(on),
      applyAdd: () => {
        if (engine.applyAdd()) focusUndo();
      },
      applyCapEdit: () => {
        if (engine.applyCapEdit()) focusUndo();
      },
      applyQuoteTest: () => {
        if (engine.applyQuoteTest()) focusUndo();
      },
      undo: () => {
        engine.undoApplied();
        afterPaint(() => {
          const band = document.getElementById('pg-try');
          const first = band && !band.hidden ? band.querySelector<HTMLElement>('button') : null;
          if (first) first.focus();
          else document.getElementById('pg-lhead')?.focus({ preventScroll: true });
        });
      },
      retryLost: () => {
        if (engine.retryLost()) focusId('pg-lhead', { preventScroll: true });
      },
      tryEngineer: () => {
        const phone = isPhone();
        const r = engine.tryEngineer();
        if (phone && r) scrollToId('pg-lhead');
        focusId('pg-lhead', { preventScroll: phone });
      },
      save: () => engine.save(),
    };
    const rail: RailActions = {
      selectPreset: (id: PresetId) => engine.selectPreset(id),
      replace: () => {
        const v = engine.replace();
        if (v) focusSelector(`#pg-presets [data-value="${v}"]`);
      },
      keepMine: () => {
        engine.keepMine();
        afterPaint(() => {
          const ta = document.getElementById('pg-rules');
          if (ta && !ta.hidden) ta.focus();
          else document.getElementById('pg-rules-list')?.focus();
        });
      },
      setRules: (text: string) => engine.setRules(text),
      editRules: () => {
        engine.editRules();
        afterPaint(() => {
          const ta = document.getElementById('pg-rules') as HTMLTextAreaElement | null;
          if (!ta) return;
          ta.focus();
          try {
            ta.setSelectionRange(ta.value.length, ta.value.length);
          } catch {
            /* ignore */
          }
        });
      },
      setCap: (v: string) => engine.setCap(Number(v), true),
      runFromRail: () => runFrom(isPhone()),
    };
    return { list, rail };
  }, [engine]);

  const block = liveBlockOf(s.env);
  const running = s.phase === 'running';
  const fresh = !!s.run && s.phase === 'done' && !s.stale;
  const staleDone = !!s.run && s.phase === 'done' && s.stale;
  const invalid = isInvalid(s);
  const progress = s.run && s.plan ? s.plan.filter((id) => s.run?.gates[id] || s.run?.errors[id]).length : 0;
  const checking = checkingLabel(progress, s.plan?.length ?? TOTAL);
  // Before a run: Run (black). After: Keep these rules (black), Run again (outline, still the ⌘↵ target).
  // Stale: Run again is black again and comes first.
  const black = !s.everDone || s.ctaBlack || running;
  const note = runNote({ edited: isEdited(s), block, slow: liveSlowOf(s.env), authored: RECORDED_FILE_AUTHORED, recordedDate: RECORDED_DATE, values: blockValues(s.env) });
  const qaExample = !!s.qaState && qaRealLine !== null;
  const real = qaExample ? qaRealLine : realLine;
  const barText = fresh ? `${c.reach} of ${TOTAL} reach you` : staleDone ? 'Rules changed' : null;

  return (
    <>
      <div className="container">
        <header className="page-head pg-head">
          <h1 className="h1">{H1}</h1>
          <p className="lede pg-lede">{LEDE}</p>
          {real !== null ? (
            <p className="meta pg-real">
              <RealTag /> <span id="pg-real-text">{real}</span>{' '}
              <Link className="link" href="/board">
                Board
              </Link>
            </p>
          ) : null}
          {qaExample ? (
            <p className="pg-proto">
              <span className="proto-note">{PROTOTYPE_NUMBERS_NOTE}</span>
            </p>
          ) : null}
          <div className={cx('btn-row pg-cta hide-phone', staleDone && 'is-stale')} id="pg-cta">
            {fresh || staleDone ? (
              <Link className={cx('btn btn--lg', fresh && 'btn--primary')} id="pg-cta-keep" href="/join" onClick={actions.list.save}>
                {KEEP}
              </Link>
            ) : null}
            <button
              className={cx('btn btn--lg', black && 'btn--primary')}
              id="pg-run"
              type="button"
              data-primary=""
              aria-disabled={running || invalid}
              aria-busy={running ? true : undefined}
              aria-keyshortcuts={running ? undefined : KBD_SHORTCUTS}
              onClick={() => {
                if (!running && !invalid) actions.list.run(false);
              }}
            >
              {running ? (
                checking
              ) : (
                <>
                  {s.everDone ? RUN_AGAIN : RUN_FIRST} <Kbd />
                </>
              )}
            </button>
            {!fresh && !staleDone && !running ? (
              <span className="meta" id="pg-run-note">
                {note}
              </span>
            ) : null}
            {fresh && c.reach > 0 ? (
              <Link className="link pg-offer-link" id="pg-cta-offer" href="/o/sample?from=playground" prefetch={false} onClick={actions.list.save}>
                {OFFER_LINK}
              </Link>
            ) : null}
          </div>
        </header>

        <div className="grid-rail pg-grid">
          <Rail s={s} map={disp.map} reach={c.reach} engine={engine} actions={actions.rail} />
          <ListSection s={s} map={disp.map} reachDays={disp.reachDays} c={c} block={block} actions={actions.list} />
        </div>
      </div>

      <Bar id="pg-bar">
        <p className="bar__text" id="pg-bar-text" hidden={!barText}>
          {barText}
        </p>
        {fresh ? (
          <Link className="btn btn--primary" id="pg-bar-keep" href="/join" data-primary="" onClick={actions.list.save}>
            {KEEP}
          </Link>
        ) : (
          <button
            className={cx('btn btn--primary pg-bar-run', !barText && 'pg-bar-full')}
            id="pg-bar-run"
            type="button"
            data-primary=""
            aria-disabled={running || invalid}
            aria-busy={running ? true : undefined}
            onClick={() => {
              if (!running && !invalid) actions.list.run(true);
            }}
          >
            {running ? checking : s.everDone ? RUN_AGAIN : RUN_FIRST}
          </button>
        )}
      </Bar>
    </>
  );
}
