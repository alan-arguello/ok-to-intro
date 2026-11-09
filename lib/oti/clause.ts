/**
 * The clause check: the single implementation used by the server (after every gate) and by the read view.
 * Ported unchanged from prototype/shared.js (`OTI.norm`, `OTI.findClause`, `OTI.marked`).
 *
 * Normalisation (both sides): NFKC, curly → straight quotes, collapsed whitespace, lower case.
 * A quote still has to be one contiguous span of the member's rules. Offsets point into the ORIGINAL
 * rules text, so the UI always renders the member's own words, never the model's copy.
 */

import type { CitedQuote } from '@/lib/types';

function normChar(c: string): string {
  return c.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
}

/** NFKC, straight quotes, collapsed whitespace, trimmed, lower case. */
export function norm(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface ClauseRange {
  start: number;
  end: number;
}

/**
 * Finds `clause` in `rules` after normalising both, and returns the span in the ORIGINAL rules text
 * (`rules.slice(start, end)` are the member's own words), or `null` when it isn't there.
 * A quote wrapped in quote marks still counts (“…” or "…").
 */
export function findClause(rules: string, clause: string): ClauseRange | null {
  let out = '';
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < rules.length; i++) {
    const c = rules[i] as string;
    if (/\s/.test(c)) {
      if (!prevSpace) {
        out += ' ';
        map.push(i);
        prevSpace = true;
      }
      continue;
    }
    const n = normChar(c);
    for (let j = 0; j < n.length; j++) {
      out += n[j];
      map.push(i);
    }
    prevSpace = false;
  }
  const needle = norm(clause)
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (!needle) return null;
  const at = out.indexOf(needle);
  if (at < 0) return null;
  return { start: map[at] as number, end: (map[at + needle.length - 1] as number) + 1 };
}

/** Runs the clause check over every quote a gate cited. */
export function checkQuotes(rules: string, quotes: readonly string[]): CitedQuote[] {
  return quotes.map((text) => {
    const r = findClause(rules, text);
    return r ? { text, found: true, start: r.start, end: r.end } : { text, found: false };
  });
}

/** True when every quote was found (an empty list counts as found: there was nothing to check). */
export function allFound(cited: readonly CitedQuote[]): boolean {
  return cited.every((c) => c.found);
}

/** The member's own words for a found quote, or null. */
export function ownWords(rules: string, quote: CitedQuote | string): string | null {
  if (typeof quote === 'string') {
    const r = findClause(rules, quote);
    return r ? rules.slice(r.start, r.end) : null;
  }
  return quote.found && quote.start !== undefined && quote.end !== undefined ? rules.slice(quote.start, quote.end) : null;
}

export interface MarkRange extends ClauseRange {
  /** Extra class names for the <mark>, e.g. `is-active`. */
  className?: string;
  /** Opaque keys (row ids) the merged mark stands for, so hovering a row can activate its marks. */
  keys?: string[];
}

export type MarkedSegment = { text: string; mark: false } | { text: string; mark: true; className: string; keys: string[] };

/**
 * Splits `text` into plain and marked segments for the read view (`<mark class="mark">`), merging overlaps.
 * React port of `OTI.marked`, which returned an HTML string.
 */
export function markedSegments(text: string, ranges: readonly (MarkRange | null | undefined)[]): MarkedSegment[] {
  const rs = ranges
    .filter((r): r is MarkRange => !!r && r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(text.length, r.end), className: r.className ?? '', keys: [...(r.keys ?? [])] }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number; className: string; keys: string[] }[] = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
      if (r.className && !last.className.split(' ').includes(r.className)) last.className = `${last.className} ${r.className}`.trim();
      for (const k of r.keys) if (!last.keys.includes(k)) last.keys.push(k);
    } else merged.push({ ...r });
  }
  const out: MarkedSegment[] = [];
  let pos = 0;
  for (const r of merged) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), mark: false });
    out.push({ text: text.slice(r.start, r.end), mark: true, className: r.className, keys: r.keys });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
  return out;
}

/** Splits rules into lines with their offsets in the full text (blank lines dropped), for the read view tallies. */
export function ruleLines(rules: string): { text: string; start: number; end: number; index: number }[] {
  const lines: { text: string; start: number; end: number; index: number }[] = [];
  let start = 0;
  for (const raw of rules.split('\n')) {
    const end = start + raw.length;
    if (raw.trim()) lines.push({ text: raw, start, end, index: lines.length });
    start = end + 1;
  }
  return lines;
}

/** Which rules line (index into `ruleLines`) a range starts in, or -1. */
export function lineOf(rules: string, range: ClauseRange): number {
  return ruleLines(rules).findIndex((l) => range.start >= l.start && range.start < Math.max(l.end, l.start + 1));
}

export interface ReadViewLine {
  index: number;
  text: string;
  segments: MarkedSegment[];
  /** True when no range touched this line (render `.rules > li.is-unused`). */
  unused: boolean;
}

/**
 * The read view of a member's rules (`<ol class="rules">`): one entry per non-blank line, with the cited
 * ranges (offsets into the full rules text) clipped to each line and merged. Used by S1's rules rail and
 * S3's “This month” view, so both mark exactly what code found.
 */
export function readViewLines(rules: string, ranges: readonly (MarkRange | null | undefined)[]): ReadViewLine[] {
  const valid = ranges.filter((r): r is MarkRange => !!r && r.end > r.start);
  return ruleLines(rules).map((line) => {
    const local: MarkRange[] = [];
    for (const r of valid) {
      const s = Math.max(r.start, line.start);
      const e = Math.min(r.end, line.end);
      if (e > s) local.push({ start: s - line.start, end: e - line.start, className: r.className, keys: r.keys });
    }
    return { index: line.index, text: line.text, segments: markedSegments(line.text, local), unused: local.length === 0 };
  });
}
