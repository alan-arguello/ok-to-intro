import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

/* ---------- Panels, cards, directory rows (tokens.css) ---------- */

type Box = { className?: string; children?: ReactNode; id?: string; style?: CSSProperties; 'aria-label'?: string; 'aria-labelledby'?: string };

/** `.panel` (beige-lighter, decorative border). Add `sticky` for the rules rail inside `.grid-rail`. */
export function Panel({ className, sticky, children, ...rest }: Box & { sticky?: boolean }) {
  return (
    <div className={cx('panel', sticky && 'is-sticky', className)} {...rest}>
      {children}
    </div>
  );
}

/** `.card` (white). */
export function Card({ className, children, ...rest }: Box) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  );
}

/** `.list`: a directory list of `.row`s, optionally with a `.list__head`. `busy` sets aria-busy while filling. */
export function List({ className, busy, children, as = 'div', ...rest }: Box & { busy?: boolean; as?: 'div' | 'section' | 'ul' }) {
  const Tag = as;
  return (
    <Tag className={cx('list', className)} aria-busy={busy ? true : undefined} {...rest}>
      {children}
    </Tag>
  );
}

export function ListHead({ className, children, id }: Box) {
  return (
    <div className={cx('list__head', className)} id={id}>
      {children}
    </div>
  );
}

export interface RowProps extends Box {
  interactive?: boolean;
  open?: boolean;
  stale?: boolean;
  changed?: boolean;
  flash?: boolean;
  as?: 'div' | 'li' | 'article';
}

/** `.row` with its state modifiers: `is-interactive`, `is-open`, `is-stale` (sunken, outlined pills), `is-changed`, `is-flash`. */
export function Row({ interactive, open, stale, changed, flash, className, children, as = 'div', ...rest }: RowProps) {
  const Tag = as;
  return (
    <Tag className={cx('row', interactive && 'is-interactive', open && 'is-open', stale && 'is-stale', changed && 'is-changed', flash && 'is-flash', className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * `.row__toggle`: line 1 and the ask together as one <button aria-expanded> (ux-spec S1 “Rows”).
 * Only phrasing content inside: use RowLine1/RowBody with `as="span"`.
 */
export function RowToggle({
  expanded,
  onClick,
  labelledBy,
  describedBy,
  controls,
  children,
  id,
}: {
  expanded: boolean;
  onClick?: () => void;
  labelledBy?: string;
  describedBy?: string;
  controls?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <button className="row__toggle" type="button" aria-expanded={expanded} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-controls={controls} onClick={onClick} id={id}>
      {children}
    </button>
  );
}

/** `.row__line1`: verdict, name, location, tags, aside. A <span> (valid inside the toggle button) by default. */
export function RowLine1({ children, as = 'span', className, id }: { children: ReactNode; as?: 'span' | 'p' | 'div'; className?: string; id?: string }) {
  const Tag = as;
  return (
    <Tag className={cx('row__line1', className)} id={id}>
      {children}
    </Tag>
  );
}

export function RowName({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span className="row__name" id={id}>
      {children}
    </span>
  );
}

export function RowLoc({ children }: { children: ReactNode }) {
  return <span className="row__loc">{children}</span>;
}

/** `.row__aside` (mono, right); `desk` hides it at 760 px and below (`.is-desk`). */
export function RowAside({ children, desk }: { children: ReactNode; desk?: boolean }) {
  return <span className={cx('row__aside', desk && 'is-desk')}>{children}</span>;
}

/** `.row__body`: inside a toggle it must be a block-level span (as in kit.html). */
export function RowBody({ children, as = 'span', className, id }: { children: ReactNode; as?: 'span' | 'p' | 'div'; className?: string; id?: string }) {
  const Tag = as;
  return (
    <Tag className={cx('row__body', className)} id={id} style={as === 'span' ? { display: 'block' } : undefined}>
      {children}
    </Tag>
  );
}

/** `.row__foot`: citation, reason, decided-by. */
export function RowFoot({ children, as = 'div', className }: { children: ReactNode; as?: 'div' | 'p'; className?: string }) {
  const Tag = as;
  return <Tag className={cx('row__foot', className)}>{children}</Tag>;
}

/** `.row__detail`: the expanded facts (dashed top border). */
export function RowDetail({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className="row__detail" id={id}>
      {children}
    </div>
  );
}

/* ---------- Facts: definition rows (offer card, Decided by, settings summaries) ---------- */

export type FactItem = readonly [label: ReactNode, value: ReactNode];

/** `.facts` (uppercase labels) or `.facts--plain` (sentence-case labels, used for “Decided by”). */
export function Facts({ items, plain, className, id }: { items: readonly FactItem[]; plain?: boolean; className?: string; id?: string }) {
  return (
    <dl className={cx('facts', plain && 'facts--plain', className)} id={id}>
      {items.map(([dt, dd], i) => (
        <FactPair key={i} dt={dt} dd={dd} />
      ))}
    </dl>
  );
}

function FactPair({ dt, dd }: { dt: ReactNode; dd: ReactNode }) {
  return (
    <>
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </>
  );
}

/* ---------- Notices: one line plus one action. No toasts, no modals ---------- */

export type NoticeKind = 'plain' | 'warn' | 'error' | 'attn';

/** `.notice` (cream), `--warn` (degraded, limits), `--error` (failures), `--attn` (something waits on a person). */
export function Notice({ kind = 'plain', title, action, children, className, id, role }: { kind?: NoticeKind; title?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string; id?: string; role?: 'status' | 'alert' }) {
  return (
    <div className={cx('notice', kind !== 'plain' && `notice--${kind}`, className)} id={id} role={role}>
      <p>
        {title ? <span className="notice__title">{title}</span> : null}
        {title && children ? ' ' : null}
        {children}
      </p>
      {action}
    </div>
  );
}

/* ---------- Numbers ---------- */

export function Stats({ className, children, id, style }: Box) {
  return (
    <dl className={cx('stats', className)} id={id} style={style}>
      {children}
    </dl>
  );
}

/** One `.stat` row: label left, value right (stacked under 480 px), optional small note under the value. */
export function Stat({ label, value, note, title }: { label: ReactNode; value: ReactNode; note?: ReactNode; title?: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd title={title}>
        {value}
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}

/** `.metric` (40 px tabular); `attn` for people interrupted (orange text). */
export function Metric({ attn, children, className }: { attn?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx('metric', attn && 'metric--attn', className)}>{children}</span>;
}

/** `.hbar`: a 4 px proportion bar (decorative next to its number). */
export function HBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="hbar" aria-hidden="true">
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------- Small parts ---------- */

/** `.crumbs`: “‹ New ask” or “Asks › Postgres p95 at 40M rows”. */
export function Crumbs({ items, label = 'Breadcrumb' }: { items: readonly { href?: string; label: ReactNode }[]; label?: string }) {
  return (
    <nav className="crumbs" aria-label={label}>
      {items.map((it, i) => (
        <CrumbItem key={i} last={i === items.length - 1} item={it} />
      ))}
    </nav>
  );
}

function CrumbItem({ item, last }: { item: { href?: string; label: ReactNode }; last: boolean }) {
  return (
    <>
      {item.href ? <Link href={item.href}>{item.label}</Link> : <span>{item.label}</span>}
      {last ? null : <span aria-hidden="true">›</span>}
    </>
  );
}

/** `.disclosure`: native details/summary with the ▸ marker. */
export function Disclosure({ summary, children, open, className, id, onToggle }: { summary: ReactNode; children: ReactNode; open?: boolean; className?: string; id?: string; onToggle?: (open: boolean) => void }) {
  return (
    <details className={cx('disclosure', className)} open={open} id={id} onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

/** `.popover`: absolutely positioned; the caller positions it next to its anchor. */
export function Popover({ id, style, children, role = 'dialog', label }: { id?: string; style?: CSSProperties; children: ReactNode; role?: 'dialog' | 'tooltip' | 'status'; label?: string }) {
  return (
    <div className="popover" id={id} style={style} role={role} aria-label={label}>
      {children}
    </div>
  );
}

/** `.hr`. */
export function Hr() {
  return <hr className="hr" />;
}

/** `.proto-note`: the dashed “Prototype: example numbers” note (QA example numbers only). */
export function ProtoNote({ children }: { children: ReactNode }) {
  return <span className="proto-note">{children}</span>;
}
