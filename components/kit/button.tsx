import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { KBD_SHORTCUTS, Kbd } from './kbd';

/**
 * Buttons: sans 500 pills (tokens.css `.btn`). One `primary` (black) per view; `ok` (orange) only for
 * “OK to intro” and “Send intro”. Disabled and busy states are never dimmed with opacity (tokens.css).
 *
 * `primary` marks the page's ⌘↵ target (`data-primary`); `kbd` shows the ⌘↵ / Ctrl ↵ hint and sets
 * aria-keyshortcuts. A disabled primary uses aria-disabled (it stays focusable and announced); `disabled`
 * still works for plain buttons.
 */

export type ButtonVariant = 'outline' | 'primary' | 'ok' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg' | 'sm';

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** The page's one primary action (⌘↵ presses the first visible, enabled one). */
  primary?: boolean;
  /** Show the ⌘↵ hint. */
  kbd?: boolean;
  busy?: boolean;
  className?: string;
}

export function buttonClass({ variant = 'outline', size = 'md', block, className }: ButtonStyleProps): string {
  return cx(
    'btn',
    variant !== 'outline' && `btn--${variant}`,
    size === 'lg' && 'btn--lg',
    size === 'sm' && 'btn--sm',
    block && 'btn--block',
    className,
  );
}

export type ButtonProps = ButtonStyleProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
    children: ReactNode;
  };

export function Button({ variant, size, block, primary, kbd, busy, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, className })}
      data-primary={primary ? '' : undefined}
      aria-busy={busy ? true : undefined}
      aria-keyshortcuts={kbd ? KBD_SHORTCUTS : undefined}
      {...rest}
    >
      {children}
      {kbd ? <Kbd /> : null}
    </button>
  );
}

export type ButtonLinkProps = ButtonStyleProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'href'> & {
    href: string;
    children: ReactNode;
    /** Render a plain <a> (external links, downloads, links that must not prefetch). */
    plain?: boolean;
  };

/** A link styled as a button (e.g. “Review the ask”, “Open it as the member”). */
export function ButtonLink({ variant, size, block, primary, kbd, busy, className, href, plain, children, ...rest }: ButtonLinkProps) {
  const props = {
    className: buttonClass({ variant, size, block, className }),
    'data-primary': primary ? '' : undefined,
    'aria-busy': busy ? true : undefined,
    'aria-keyshortcuts': kbd ? KBD_SHORTCUTS : undefined,
    ...rest,
  };
  const content = (
    <>
      {children}
      {kbd ? <Kbd /> : null}
    </>
  );
  if (plain || /^(https?:|mailto:)/.test(href)) {
    return (
      <a href={href} {...props}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} {...props}>
      {content}
    </Link>
  );
}

/** `.btn-row`: a wrapping row of buttons. */
export function ButtonRow({ className, children, style }: { className?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={cx('btn-row', className)} style={style}>
      {children}
    </div>
  );
}
