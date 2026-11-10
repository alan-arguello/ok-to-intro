/**
 * Personal gates (/g/<slug>): the pure parts shared by the /rules form and the server. Client-safe (no node APIs).
 * The owner token's hash and compare live in lib/server/gate-token.ts.
 */

export const GATE_SLUG_RE = /^[a-z0-9-]{3,40}$/;
export const GATE_NAME_MAX = 60;
export const GATE_HEADLINE_MAX = 120;
export const GATE_ASK_MAX = 1200;
export const GATE_ANSWER_MAX = 300;
export const GATE_ASKER_NAME_MAX = 80;
export const GATE_EMAIL_MAX = 200;
export const GATE_CAP_MIN = 1;
export const GATE_CAP_MAX = 10;

/** Loose on purpose: something@something.tld, no spaces. */
export const LOOSE_EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

/** A slug from free text: lowercase ASCII letters, digits and single hyphens, at most 40 characters. */
export function slugify(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return GATE_SLUG_RE.test(slug);
}

export type PersonalVerdict = 'accept' | 'decline' | 'ask_back' | 'over_cap';

/** The monthly cap: an accept past the cap becomes `over_cap`; every other verdict passes through. */
export function capVerdict(verdict: 'accept' | 'decline' | 'ask_back', acceptedThisMonth: number, cap: number): PersonalVerdict {
  if (verdict === 'accept' && acceptedThisMonth >= cap) return 'over_cap';
  return verdict;
}

export function gatePath(slug: string): string {
  return `/g/${encodeURIComponent(slug)}`;
}

export function inboxPath(slug: string, token: string): string {
  return `/g/${encodeURIComponent(slug)}/inbox?k=${encodeURIComponent(token)}`;
}

/** localStorage key for the private inbox link on this browser. */
export const GATE_STORAGE_KEY = 'oti.personal-gate';
