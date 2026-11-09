import type { ReactNode } from 'react';
import { cx } from './cx';

/* ---------- Dark blocks: traces (mono, hanging indent) ---------- */

export type TraceTone = 'dim' | 'ok' | 'wait' | 'no' | 'attn' | 'link';

/** A colored run inside a trace line: `<span class="t-ok">accept</span>`. */
export function T({ tone, children }: { tone: TraceTone; children: ReactNode }) {
  return <span className={`t-${tone}`}>{children}</span>;
}

/** One `.ln` (wraps with a 2ch hanging indent). */
export function TraceLine({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('ln', className)}>{children}</span>;
}

/** `<pre class="trace">`: mono, tabular numbers, wraps (never scrolls sideways). Focusable so it can scroll. */
export function Trace({ label, children, id, className }: { label: string; children: ReactNode; id?: string; className?: string }) {
  return (
    <pre className={cx('trace', className)} aria-label={label} id={id} tabIndex={0}>
      {children}
    </pre>
  );
}

/* ---------- Diffs (rule edits): GitHub-style, with screen-reader prefixes ---------- */

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  text: string;
}

/** `<pre class="diff">` with “Add: ” / “Remove: ” for screen readers. */
export function Diff({ lines, label, id }: { lines: readonly DiffLine[]; label: string; id?: string }) {
  return (
    <pre className="diff" aria-label={label} id={id}>
      {lines.map((l, i) => (
        <span key={i} className={`d-${l.kind}`}>
          {l.kind === 'add' ? <span className="sr-only">Add: </span> : l.kind === 'del' ? <span className="sr-only">Remove: </span> : null}
          {l.text}
        </span>
      ))}
    </pre>
  );
}

/* ---------- Sticky bottom bar (phones): the page's one next action, in the thumb zone ---------- */

/**
 * `.bar` (`phone`: hidden above 760 px; `stack`: the offer page's 2-row layout). While rendered it marks
 * `data-has-bar`, and app/globals.css pads the body so nothing hides behind it (the prototype's
 * `body.has-bar` / `body.has-bar-lg`, without JS, so it also works on no-JS pages like /o).
 */
export function Bar({ phone = true, stack, text, children, id, label }: { phone?: boolean; stack?: boolean; text?: ReactNode; children?: ReactNode; id?: string; label?: string }) {
  return (
    <div className={cx('bar', phone && 'bar--phone', stack && 'bar--stack')} data-has-bar={stack ? 'lg' : ''} id={id} role={label ? 'region' : undefined} aria-label={label}>
      {text !== undefined ? <p className="bar__text">{text}</p> : null}
      {children}
    </div>
  );
}
