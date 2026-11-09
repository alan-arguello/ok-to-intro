import type { ReactNode } from 'react';
import { readViewLines, type MarkRange } from '@/lib/oti/clause';
import { cx } from './cx';

/**
 * One citation style everywhere (ux-spec Revision 2): the member's own words on --mark, in curly quotes.
 * `.clause--missing` (red strike-through) only for a quote code rejected.
 *
 * Pass the member's own words (rules.slice(start, end) at the offsets code found), never the model's copy.
 */
export function Clause({ children, missing, className }: { children: ReactNode; missing?: boolean; className?: string }) {
  return (
    <span className={cx('clause', missing && 'clause--missing', className)}>
      “{children}”
    </span>
  );
}

/** `<mark class="mark">`, `.is-active` while its row is hovered or focused. */
export function Mark({ children, active, className, ...data }: { children: ReactNode; active?: boolean; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <mark className={cx('mark', active && 'is-active', className)} {...data}>
      {children}
    </mark>
  );
}

/** The trap's tell inside an ask: dotted underline (`.mark--trap` lives in the playground's CSS). */
export function TrapMark({ children }: { children: ReactNode }) {
  return <span className="mark--trap">{children}</span>;
}

export interface RulesReadViewProps {
  rules: string;
  /** Cited ranges in the FULL rules text (offsets from findClause), with optional row keys for `is-active`. */
  ranges: readonly (MarkRange | null | undefined)[];
  /** Tally per non-blank line (“3 let in · 1 kept out”, “not used by these 12”, “checking…”). */
  tallies?: readonly (string | null | undefined)[];
  /** Row keys whose marks are active (hovered or focused row). */
  activeKeys?: readonly string[];
  label?: string;
  id?: string;
  className?: string;
}

/**
 * `.rules` read view: one <li> per rules line, the quoted words marked at the offsets code found,
 * a tally per line; unused lines get `.is-unused`.
 */
export function RulesReadView({ rules, ranges, tallies, activeKeys, label = 'Your rules, read view', id, className }: RulesReadViewProps) {
  const lines = readViewLines(rules, ranges);
  const active = new Set(activeKeys ?? []);
  return (
    <ol className={cx('rules', className)} aria-label={label} id={id}>
      {lines.map((line) => (
        <li key={line.index} className={line.unused ? 'is-unused' : undefined}>
          {line.segments.map((seg, i) =>
            seg.mark ? (
              <mark key={i} className={cx('mark', seg.className, seg.keys.some((k) => active.has(k)) && 'is-active')} data-keys={seg.keys.join(' ') || undefined}>
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
          {tallies?.[line.index] ? <span className="tally">{tallies[line.index]}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** “Not in your rules: “Happy to take any intro”” under the read view. */
export function RulesMissing({ quotes }: { quotes: readonly string[] }) {
  if (!quotes.length) return null;
  return <p className="rules__missing">Not in your rules: {quotes.map((q) => `“${q}”`).join(', ')}</p>;
}
