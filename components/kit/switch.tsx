'use client';

import type { ReactNode } from 'react';

/**
 * `.switch` (role=switch, 44 px hit area) and `.switch-row`, whose visible label also toggles it
 * (as in prototype/shared.js). Pass `name` to submit the value with a surrounding form (“on” / “off”).
 */

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy?: string;
  label?: string;
  describedBy?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}

export function Switch({ checked, onChange, labelledBy, label, describedBy, disabled, name, id }: SwitchProps) {
  return (
    <>
      <button
        id={id}
        className="switch"
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        aria-disabled={disabled ? true : undefined}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
      />
      {name ? <input type="hidden" name={name} value={checked ? 'on' : 'off'} /> : null}
    </>
  );
}

export interface SwitchRowProps extends Omit<SwitchProps, 'labelledBy' | 'label' | 'describedBy'> {
  /** Unique id prefix: the label gets `${id}-label`, the help `${id}-help`. */
  id: string;
  label: ReactNode;
  help?: ReactNode;
}

export function SwitchRow({ id, label, help, checked, onChange, disabled, name }: SwitchRowProps) {
  return (
    <div className="switch-row">
      {/* The label toggles too; the switch keeps its own focus and keyboard handling. */}
      <div
        onClick={(e) => {
          if (disabled || (e.target as HTMLElement).closest('a, button, input, textarea, select')) return;
          onChange(!checked);
        }}
      >
        <p className="label" id={`${id}-label`}>
          {label}
        </p>
        {help ? (
          <p className="help" id={`${id}-help`}>
            {help}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onChange={onChange}
        labelledBy={`${id}-label`}
        describedBy={help ? `${id}-help` : undefined}
        disabled={disabled}
        name={name}
      />
    </div>
  );
}
