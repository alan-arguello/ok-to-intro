import type { ReactNode } from 'react';
import type { DisplayVerdict } from '@/lib/oti/cap';
import { DISPLAY_LABEL } from '@/lib/oti/cap';
import { cx } from './cx';

/* ---------- Tags (YC directory pill recipe, 10 px uppercase) ---------- */

export type TagKind = 'plain' | 'real' | 'trap' | 'attn' | 'outline';

/** `.tag`: Sample (plain), Real, Trap · injection, Ask for you (attn), Out of date (outline). */
export function Tag({ kind = 'plain', className, children }: { kind?: TagKind; className?: string; children: ReactNode }) {
  return <span className={cx('tag', kind !== 'plain' && `tag--${kind}`, className)}>{children}</span>;
}

/** The two data labels every surface carries (ux-spec §5 shared rules). */
export function SampleTag({ className }: { className?: string }) {
  return <Tag className={className}>Sample</Tag>;
}
export function RealTag({ className }: { className?: string }) {
  return (
    <Tag kind="real" className={className}>
      Real
    </Tag>
  );
}

/* ---------- Verdict pills: neutral, always with a word and a shape cue ---------- */

/** Every `.verdict--*` modifier in tokens.css. */
export type VerdictKind = DisplayVerdict | 'offered' | 'next' | 'nothistime' | 'on' | 'paused';

export const VERDICT_LABEL: Record<VerdictKind, string> = {
  ...DISPLAY_LABEL,
  offered: 'Offered',
  next: 'Next in line',
  nothistime: 'Not this time',
  on: 'On',
  paused: 'Paused',
};

/** `.verdict.verdict--<kind>`; the label defaults to the kit's word for that kind. */
export function Verdict({ kind, className, children }: { kind: VerdictKind; className?: string; children?: ReactNode }) {
  return <span className={cx('verdict', `verdict--${kind}`, className)}>{children ?? VERDICT_LABEL[kind]}</span>;
}

/* ---------- Cap squares: data, not icons. Used squares are orange (attention spent) ---------- */

/**
 * `.cap > i(.is-used)`. Next to text that already says the numbers, pass `hidden` (aria-hidden);
 * standalone, it is labelled “1 of 2 used”.
 */
export function Cap({ cap, used, hidden, className }: { cap: number; used: number; hidden?: boolean; className?: string }) {
  const squares = Array.from({ length: Math.max(0, cap) }, (_, i) => <i key={i} className={i < used ? 'is-used' : undefined} />);
  return hidden ? (
    <span className={cx('cap', className)} aria-hidden="true">
      {squares}
    </span>
  ) : (
    <span className={cx('cap', className)} role="img" aria-label={`${Math.min(used, cap)} of ${cap} used`}>
      {squares}
    </span>
  );
}
