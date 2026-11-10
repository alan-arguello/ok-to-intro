/**
 * Text and number helpers shared by every surface (ports of the prototype's OTI.fmt and the a.js/b.js helpers).
 * Pure functions; safe in client and server code.
 */

/** 980 → “980 ms”, 1290 → “1.3 s”. */
export function fmtMs(n: number): string {
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;
}

/** 0.0019 → “$0.002”, 0.32 → “$0.32”. */
export function fmtUsd(n: number): string {
  return `$${n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`;
}

/** 1980 → “1,980”. */
export function fmtN(n: number): string {
  return Number(n).toLocaleString('en-US');
}

/** Wraps in curly quotes: “…”. */
export function q(s: string): string {
  return `“${s}”`;
}

/** plural(1, 'ask') → “1 ask”; plural(2, 'ask') → “2 asks”; plural(2, 'person', 'people') → “2 people”. */
export function plural(n: number, one: string, many?: string): string {
  return `${fmtN(n)} ${n === 1 ? one : many || `${one}s`}`;
}

/** ['a', 'b', 'c'] → “a, b and c”. */
export function joinAnd(list: readonly string[]): string {
  if (list.length < 2) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function upper1(s: string): string {
  const v = String(s || '');
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Lower-cases the first letter only when it starts an ordinary word: “Someone” → “someone”, “A CTO” → “a CTO”,
 * while acronyms stay (“CTO who…” stays).
 */
export function lower1(s: string): string {
  const v = String(s || '');
  return /^[A-Z](?=[a-z]|\s)/.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : v;
}

export function wordCount(s: string): number {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Splits text into sentences on . ! ? ; followed by whitespace. */
export function sentences(text: string): string[] {
  return String(text || '')
    .replace(/([.!?;])\s+/g, '$1\u0000')
    .split('\u0000')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Drops trailing punctuation and spaces. */
export function stripEnd(s: string): string {
  return String(s || '').replace(/[.;!?\s]+$/, '');
}

/** “Hospital procurement in the US, 20 min?” → “Hospital procurement in the US”. */
export function bareSubject(subject: string): string {
  return String(subject || '').replace(/,\s*20 min\?\s*$/, '');
}

/** The subject limit (members see it in their inbox). */
export const SUBJECT_MAX = 45;

/**
 * Needs reads the same everywhere (ux-spec Revision 3): “20 minutes with …”.
 * needsLine('Someone who has run Postgres past 100M rows') → “20 minutes with someone who has run Postgres past 100M rows”.
 */
export function needsLine(needs: string): string {
  const n = String(needs || '').trim();
  if (!n) return '';
  return /^20 minutes/i.test(n) ? upper1(n) : `20 minutes with ${lower1(n)}`;
}

/** A random-looking but deterministic 4-hex id (FNV-1a), e.g. run ids `r_8f2a` in recorded traces. */
export function hex4(s: string): string {
  let h = 2166136261;
  const v = String(s);
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `0000${((h >>> 0) & 0xffff).toString(16)}`.slice(-4);
}

/** FNV-1a 32-bit hash, for deterministic shuffles. */
export function hash32(s: string): number {
  let h = 2166136261;
  const v = String(s);
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic permutation of 0..n-1 (fixed shuffled waffle positions). */
export function shuffled(n: number, seed: number): number[] {
  const r = rng(seed);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let j = n - 1; j > 0; j--) {
    const k = Math.floor(r() * (j + 1));
    const t = a[j] as number;
    a[j] = a[k] as number;
    a[k] = t;
  }
  return a;
}

/**
 * Trace time column: “+0 ms     ”, “+1290 ms  ” (padded to 10 characters, as in the prototype traces).
 */
export function traceTime(ms: number): string {
  const s = `+${Math.round(ms)} ms`;
  return s.length >= 10 ? `${s} ` : s + ' '.repeat(10 - s.length);
}

/** Counter text: “214 / 1,000”. */
export function counterText(n: number, max: number): string {
  return `${fmtN(n)} / ${fmtN(max)}`;
}

/** Rules limits (ux-spec S1). */
export const RULES_MAX = 1000;
export const ASK_TEXT_MAX = 600;
export const ANSWER_MAX = 280;
export const NOTE_MAX = 140;

/** True when a string has straight quotes or apostrophes that should be curly in UI copy (ux-spec §2.7). */
export function hasStraightQuotes(s: string): boolean {
  return /["']/.test(s);
}

/** Banned words in UI copy (ux-spec §2.7). Lint helper for tests. */
export const BANNED_COPY = [/AI-powered/i, /seamless/i, /\bmagic\b/i, /!/] as const;
