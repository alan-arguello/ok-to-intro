'use client';

import { Fragment, useSyncExternalStore } from 'react';
import { cx } from '@/components/kit/cx';
import { Counter, Textarea } from '@/components/kit/forms';
import { Cap } from '@/components/kit/pills';
import { RadioGroup, type RadioOption } from '@/components/kit/radio-group';
import { CAP_CHOICES } from '@/lib/oti/cap';
import { PLAYGROUND_RULES_HELP } from '@/lib/oti/copy';
import { counterText, RULES_MAX } from '@/lib/oti/text';
import { PRESETS, presetById } from '@/lib/sample/presets';
import type { PresetId } from '@/lib/types';
import { CAP_HELP, capUsed, HELP_EMPTY, HELP_OVER, READ_HINT, RUN_AGAIN, STALE_NOTE } from './copy';
import { isEdited, isEmpty, isOver, type PgState, type PlaygroundEngine } from './engine';
import { missingText, nomatchText, readView, type DisplayMap } from './model';

const PRESET_OPTIONS: readonly RadioOption<PresetId>[] = PRESETS.map((p) => ({ value: p.id, label: p.label }));
const CAP_OPTIONS: readonly RadioOption<string>[] = CAP_CHOICES.map((n) => ({ value: String(n), label: String(n) }));

export interface RailActions {
  selectPreset(id: PresetId): void;
  replace(): void;
  keepMine(): void;
  setRules(text: string): void;
  editRules(): void;
  setCap(value: string): void;
  runFromRail(): void;
}

/** The rules rail's read view: your words, the quoted spans marked at the offsets code found, a tally per line. */
function ReadRules({ s, map, engine, onEdit }: { s: PgState; map: DisplayMap; engine: PlaygroundEngine; onEdit: () => void }) {
  const active = useSyncExternalStore(engine.subscribeActive, engine.getActive, () => null);
  const run = s.run;
  if (!run) return null;
  const view = readView(run, map, s.phase === 'running');
  return (
    <>
      <ol
        className="rules"
        id="pg-rules-list"
        tabIndex={0}
        aria-labelledby="pg-rules-lbl"
        aria-describedby="pg-read-hint"
        onClick={onEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEdit();
          }
        }}
      >
        {view.lines.map((line) => (
          <li key={line.index} className={line.unused ? 'is-unused' : undefined}>
            {line.segments.map((seg, i) =>
              seg.mark ? (
                <mark key={i} className={cx('mark', active !== null && seg.keys.includes(active) && 'is-active')} data-rows={seg.keys.join(' ')}>
                  {seg.text}
                </mark>
              ) : (
                <Fragment key={i}>{seg.text}</Fragment>
              ),
            )}
            <span className="tally">{line.tally}</span>
          </li>
        ))}
      </ol>
      <span className="sr-only" id="pg-read-hint">
        {READ_HINT}
      </span>
      {view.nomatch ? (
        <p className="help pg-nomatch" id="pg-nomatch">
          {nomatchText(view.nomatch)}
        </p>
      ) : null}
      {view.missing.length ? (
        <p className="rules__missing" id="pg-missing">
          {missingText(view.missing)}
        </p>
      ) : null}
    </>
  );
}

/** “Your rules and cap”: presets, the rules (textarea or read view), the stale notice and the monthly cap. */
export function Rail({ s, map, reach, engine, actions }: { s: PgState; map: DisplayMap; reach: number; engine: PlaygroundEngine; actions: RailActions }) {
  const edited = isEdited(s);
  const empty = isEmpty(s);
  const over = isOver(s);
  // The read view after a run; while a live run streams from it, its tallies read “checking…”.
  const read = s.view === 'read' && !!s.run && (s.phase === 'running' || (s.phase === 'done' && !s.stale));
  // Editing unselects the presets and shows “Edited”; a pending replace shows the preset being asked about.
  const presetValue: PresetId | null = s.pendingPreset ?? (edited ? null : s.preset);
  const done = !!s.run && s.phase === 'done';
  const used = done ? reach : 0;
  const help = empty ? HELP_EMPTY : over ? HELP_OVER : PLAYGROUND_RULES_HELP;

  return (
    <section className="panel is-sticky pg-rail" aria-labelledby="pg-rail-title">
      <h2 className="sr-only" id="pg-rail-title">
        Your rules and cap
      </h2>
      <div className="field">
        <p className="label-row pg-start">
          <span className="label" id="pg-start-lbl">
            Start from
          </span>{' '}
          <span className="meta" id="pg-edited" hidden={!edited}>
            Edited
          </span>
        </p>
        <div className="pg-presets" id="pg-presets">
          <RadioGroup variant="chips" options={PRESET_OPTIONS} value={presetValue} onChange={actions.selectPreset} labelledBy="pg-start-lbl" />
        </div>
        {s.pendingPreset ? (
          <div className="notice pg-confirm" id="pg-confirm" role="group" aria-labelledby="pg-confirm-text">
            <p id="pg-confirm-text">Replace your rules with {presetById(s.pendingPreset).label}?</p>
            <div className="btn-row">
              <button className="btn btn--sm" type="button" id="pg-replace" onClick={actions.replace}>
                Replace
              </button>
              <button className="btn btn--ghost btn--sm" type="button" id="pg-keep-mine" onClick={actions.keepMine}>
                Keep mine
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="field">
        <div className="label-row">
          <label className="label" htmlFor="pg-rules" id="pg-rules-lbl">
            Your rules
          </label>
          <Counter id="pg-count" over={over}>
            {counterText(s.rules.length, RULES_MAX)}
          </Counter>
        </div>
        <Textarea
          className="pg-textarea"
          id="pg-rules"
          rows={7}
          spellCheck={false}
          aria-describedby="pg-count pg-rules-help"
          placeholder="Happy to talk to founders about…"
          value={s.rules}
          invalid={over}
          hidden={read}
          onChange={(e) => actions.setRules(e.target.value)}
        />
        <div className="pg-read" id="pg-read" hidden={!read}>
          {read ? <ReadRules s={s} map={map} engine={engine} onEdit={actions.editRules} /> : null}
          <button className="btn btn--ghost btn--sm pg-edit" type="button" id="pg-edit" onClick={actions.editRules}>
            Edit rules
          </button>
        </div>
        <p className={over ? 'error-text' : 'help'} id="pg-rules-help">
          {help}
        </p>
        {s.stale && s.phase === 'done' ? (
          <div className="notice pg-stale" id="pg-stale">
            <p>{STALE_NOTE}</p>
            <button className="btn btn--sm" type="button" id="pg-stale-run" aria-disabled={empty || over} onClick={actions.runFromRail}>
              {RUN_AGAIN}
            </button>
          </div>
        ) : null}
      </div>
      <div className="field">
        <span className="label" id="pg-cap-lbl">
          Monthly cap
        </span>
        <div className="cluster pg-cap-row">
          <RadioGroup variant="seg" options={CAP_OPTIONS} value={String(s.cap)} onChange={actions.setCap} labelledBy="pg-cap-lbl" describedBy="pg-cap-used" />
          <span className="pg-cap-used">
            <Cap cap={s.cap} used={used} hidden />{' '}
            <span className="meta" id="pg-cap-used">
              {capUsed(used, s.cap, done)}
            </span>
          </span>
        </div>
        <p className="help">{CAP_HELP}</p>
      </div>
    </section>
  );
}
