'use client';

import { Counter, Textarea } from '@/components/kit/forms';
import { Kbd, KBD_SHORTCUTS } from '@/components/kit/kbd';
import { RadioGroup, type RadioOption } from '@/components/kit/radio-group';
import { CAP_CHOICES } from '@/lib/oti/cap';
import { counterText, RULES_MAX } from '@/lib/oti/text';
import { PRESETS } from '@/lib/sample/presets';
import type { PresetId } from '@/lib/types';
import { capLabel, HELP_EMPTY, HELP_OVER, RULES_HELP, RUN, STEP_RULES } from './copy';
import { isEdited, isEmpty, isOver, type PgState } from './engine';
import { checkingLabel, TOTAL } from './model';

const CAP_OPTIONS: readonly RadioOption<string>[] = CAP_CHOICES.map((n) => ({ value: String(n), label: String(n) }));

export interface RailActions {
  usePreset(id: PresetId): void;
  setRules(text: string): void;
  setCap(value: string): void;
  run(): void;
}

/** Step 1, “Your rules”: three examples to start from, the textarea, the monthly limit and the page's one button. */
export function Rail({ s, actions }: { s: PgState; actions: RailActions }) {
  const empty = isEmpty(s);
  const over = isOver(s);
  const running = s.phase === 'running';
  // Up to date: the asks on screen were checked against exactly these rules. Editing re-enables the button.
  const fresh = !!s.run && s.phase === 'done' && !s.stale;
  const disabled = running || empty || over || fresh;
  const picked = isEdited(s) ? null : s.preset;
  const progress = s.run && s.plan ? s.plan.filter((id) => s.run?.gates[id] || s.run?.errors[id]).length : 0;

  return (
    <section className="panel is-sticky pg-rail" aria-labelledby="pg-rail-title">
      <h2 className="h2 pg-step" id="pg-rail-title">
        {STEP_RULES}
      </h2>
      <div className="field">
        <span className="label" id="pg-start-lbl">
          Start from an example
        </span>
        <div className="pg-presets" id="pg-presets" role="group" aria-labelledby="pg-start-lbl">
          {PRESETS.map((p) => (
            <button key={p.id} className="chip" type="button" data-value={p.id} aria-pressed={picked === p.id} onClick={() => actions.usePreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="label-row">
          <label className="label" htmlFor="pg-rules">
            What you’d agree to help with
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
          onChange={(e) => actions.setRules(e.target.value)}
        />
        <p className={over ? 'error-text' : 'help'} id="pg-rules-help">
          {empty ? HELP_EMPTY : over ? HELP_OVER : RULES_HELP}
        </p>
      </div>
      <div className="field">
        <span className="label" id="pg-cap-lbl">
          {capLabel(s.cap)}
        </span>
        <div className="pg-cap-row">
          <RadioGroup variant="seg" options={CAP_OPTIONS} value={String(s.cap)} onChange={actions.setCap} labelledBy="pg-cap-lbl" />
        </div>
      </div>
      <button
        className="btn btn--primary btn--lg pg-run"
        id="pg-run"
        type="button"
        data-primary=""
        aria-disabled={disabled}
        aria-busy={running ? true : undefined}
        aria-keyshortcuts={disabled ? undefined : KBD_SHORTCUTS}
        onClick={() => {
          if (!disabled) actions.run();
        }}
      >
        {running ? (
          checkingLabel(progress, s.plan?.length ?? TOTAL)
        ) : (
          <>
            {RUN} {disabled ? null : <Kbd />}
          </>
        )}
      </button>
    </section>
  );
}
