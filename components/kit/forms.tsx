import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

/**
 * Form parts (tokens.css “Forms”). Inputs are 16 px so iOS never zooms, borders are --line-input (≥ 3:1),
 * help and errors are linked with aria-describedby, invalid fields set aria-invalid (ux-spec §9).
 */

export function Field({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('field', className)}>{children}</div>;
}

/** `.label-row`: a label with a counter (or action) on the right. */
export function LabelRow({ children }: { children: ReactNode }) {
  return <div className="label-row">{children}</div>;
}

/** A visible label. With `htmlFor` it is a <label>; with `id` only, a <span> that a radiogroup points at. */
export function Label({ htmlFor, id, className, children }: { htmlFor?: string; id?: string; className?: string; children: ReactNode }) {
  return htmlFor ? (
    <label className={cx('label', className)} htmlFor={htmlFor} id={id}>
      {children}
    </label>
  ) : (
    <span className={cx('label', className)} id={id}>
      {children}
    </span>
  );
}

export function Help({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <p className={cx('help', className)} id={id}>
      {children}
    </p>
  );
}

export function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="error-text" id={id}>
      {children}
    </p>
  );
}

/** “214 / 1,000”; red and medium when over. */
export function Counter({ id, over, children }: { id?: string; over?: boolean; children: ReactNode }) {
  return (
    <span className={cx('counter', over && 'is-over')} id={id} aria-live="off">
      {children}
    </span>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; code?: boolean };

/** `.input` (and `.input--code` for the 6-digit code: one input, autocomplete one-time-code). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, code, ...rest }, ref) {
  return <input ref={ref} className={cx('input', code && 'input--code', className)} aria-invalid={invalid ? true : undefined} {...rest} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx('textarea', className)} aria-invalid={invalid ? true : undefined} {...rest} />;
});

/** The 6-digit email code input (ux-spec S3): numeric keypad, OTP autofill, paste works, max 6. */
export const CodeInput = forwardRef<HTMLInputElement, Omit<InputProps, 'code'>>(function CodeInput(props, ref) {
  return <Input ref={ref} code type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" {...props} />;
});
