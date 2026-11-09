'use client';

import { useCallback, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * `.seg` and `.chips` radiogroups (port of OTI.radiogroup): role=radiogroup > role=radio with aria-checked,
 * roving tabindex (only the checked option is in the tab order) and arrow keys that move and select.
 *
 * Progressive enhancement: give an option an `href` (e.g. `?v=4`) and it renders as a link, so a no-JS page can
 * preselect with a GET; with JS the click is intercepted and selects in place.
 */

export interface RadioOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  /** Text for a disabled option's description, linked with aria-describedby. */
  describedBy?: string;
  href?: string;
  /** Extra attributes for tests and analytics-free hooks, e.g. data-value. */
  className?: string;
}

export interface RadioGroupProps<V extends string> {
  variant: 'seg' | 'chips';
  options: readonly RadioOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  /** Id of the visible label (preferred) … */
  labelledBy?: string;
  /** … or an aria-label. */
  label?: string;
  describedBy?: string;
  className?: string;
  /** Renders a hidden input so a surrounding <form> submits the value. */
  name?: string;
}

export function RadioGroup<V extends string>({ variant, options, value, onChange, labelledBy, label, describedBy, className, name }: RadioGroupProps<V>) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const checkedIndex = options.findIndex((o) => o.value === value);
  const tabIndexOf = (i: number) => (checkedIndex >= 0 ? (i === checkedIndex ? 0 : -1) : i === enabled[0] ? 0 : -1);

  const select = useCallback(
    (i: number, focus: boolean) => {
      const o = options[i];
      if (!o || o.disabled) return;
      if (focus) refs.current[i]?.focus();
      if (o.value !== value) onChange(o.value);
    },
    [options, value, onChange],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, i: number) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (!step || !enabled.length) return;
    e.preventDefault();
    const at = enabled.indexOf(i);
    const next = enabled[(at + step + enabled.length) % enabled.length] as number;
    select(next, true);
  };

  return (
    <div className={cx(variant, className)} role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} aria-describedby={describedBy}>
      {options.map((o, i) => {
        const common = {
          role: 'radio',
          'aria-checked': o.value === value,
          'aria-disabled': o.disabled ? true : undefined,
          'aria-describedby': o.describedBy,
          tabIndex: tabIndexOf(i),
          'data-value': o.value,
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, i),
          className: cx(variant === 'chips' && 'chip', o.className),
        } as const;
        if (o.href) {
          return (
            <a
              key={o.value}
              href={o.href}
              ref={(el) => {
                refs.current[i] = el;
              }}
              {...common}
              onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault();
                select(i, false);
              }}
            >
              {o.label}
            </a>
          );
        }
        return (
          <button
            key={o.value}
            type="button"
            ref={(el) => {
              refs.current[i] = el;
            }}
            {...common}
            onClick={() => select(i, false)}
          >
            {o.label}
          </button>
        );
      })}
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
    </div>
  );
}
