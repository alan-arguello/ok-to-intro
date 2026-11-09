import type { ReactNode } from 'react';
import type { CellClass } from '@/lib/types';
import { cx } from './cx';

/**
 * The fan-out waffle: 40 cells in a 10-column grid with `role="img"` and the full counts in its aria-label;
 * the legend is real text (ux-spec §9). On SAMPLE with “Show what askers never see” on, cells become buttons
 * that open a popover (pass `onCellClick`).
 */

export interface WaffleCellData {
  state: CellClass;
  /** The visitor's own gate (the YOU cell, outlined). */
  you?: boolean;
  /** Text glyph: you · ✓ · ? · · · ! (never an icon). */
  glyph?: string;
  /** Accessible name when the cell is a button (reveal mode). */
  label?: string;
  pressed?: boolean;
}

export const CELL_GLYPH: Partial<Record<CellClass, string>> = { next: '✓', ask: '?', na: '·', failed: '!' };

export function glyphFor(cell: WaffleCellData): string {
  if (cell.you) return 'you';
  return cell.glyph ?? CELL_GLYPH[cell.state] ?? '';
}

export function Waffle({ cells, label, onCellClick, id, className }: { cells: readonly WaffleCellData[]; label: string; onCellClick?: (index: number) => void; id?: string; className?: string }) {
  if (onCellClick) {
    // Interactive (SAMPLE reveal): a group of buttons, each labelled; no role=img.
    return (
      <div className={cx('waffle', className)} role="group" aria-label={label} id={id}>
        {cells.map((c, i) => (
          <button
            key={i}
            type="button"
            className={cx('cell', `cell--${c.state}`, c.you && 'cell--you')}
            aria-label={c.label}
            aria-pressed={c.pressed}
            onClick={() => onCellClick(i)}
          >
            {glyphFor(c)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={cx('waffle', className)} role="img" aria-label={label} id={id}>
      {cells.map((c, i) => (
        <span key={i} className={cx('cell', `cell--${c.state}`, c.you && 'cell--you')}>
          {glyphFor(c)}
        </span>
      ))}
    </div>
  );
}

/** `.legend`: a swatch and a count per state, as text. */
export function Legend({ items, id }: { items: readonly { state: CellClass; text: ReactNode }[]; id?: string }) {
  return (
    <p className="legend" id={id}>
      {items.map((it, i) => (
        <span key={i}>
          <i className={`cell--${it.state}`} aria-hidden="true" />
          {it.text}
        </span>
      ))}
    </p>
  );
}
