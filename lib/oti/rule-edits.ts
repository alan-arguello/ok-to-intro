/**
 * The rule edit suggested after a No (ux-spec S4 “Why?”). Templated by code, never written by a model: it only adds
 * one line, never names a company, never copies 6 or more consecutive words of the ask, and is skipped when the
 * rules already say it. Shared by R (/o, REAL) and S6 (MCP `respond` with a reason). The SAMPLE offer uses the
 * hand-written OFFER_SAMPLE.suggested_edits instead. Pure; safe in client and server code.
 */

import type { NoReason } from '@/lib/types';
import { norm } from './clause';
import { lower1 } from './text';

export interface SuggestedRuleEdit {
  reason: 'not_my_area' | 'wrong_stage';
  /** A line already in the member's rules, shown as diff context (the matched line when known). */
  context: string | null;
  /** The one line to add. */
  add: string;
}

const WRONG_STAGE_LINE = 'Only after a first paying customer.';

function words(s: string): string[] {
  return norm(s)
    .replace(/[^\p{L}\p{N}\s'$%-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** True when `a` and `b` share `n` or more consecutive words (after normalising). */
export function sharesWords(a: string, b: string, n = 6): boolean {
  const wa = words(a);
  const hay = ` ${words(b).join(' ')} `;
  for (let i = 0; i + n <= wa.length; i++) if (hay.includes(` ${wa.slice(i, i + n).join(' ')} `)) return true;
  return false;
}

/** “Hospital procurement, US” → “hospital procurement”. */
export function topicPhrase(topic: string | null | undefined): string | null {
  const t = String(topic ?? '')
    .split(/[,;:(·|]/)[0]
    ?.replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 3 || t.length > 60) return null;
  return lower1(t).replace(/[.!?]+$/, '');
}

/**
 * The one templated line for a No reason, or null (no reason that maps to a rule, no usable topic, the rules already
 * hold it, or a guard tripped). `not_specific` goes to the compiler, `no_time` offers cap/pause, `other` is a note.
 */
export function suggestRuleEdit(
  reason: NoReason,
  ctx: { rules: string; matchedLine: string | null; topic: string | null; askText: string; companies?: readonly string[] },
): SuggestedRuleEdit | null {
  if (reason !== 'not_my_area' && reason !== 'wrong_stage') return null;
  let add: string | null = null;
  if (reason === 'not_my_area') {
    const phrase = topicPhrase(ctx.topic);
    add = phrase ? `No asks about ${phrase}.` : null;
  } else {
    add = WRONG_STAGE_LINE;
  }
  if (!add) return null;
  if (norm(ctx.rules).includes(norm(add).replace(/\.$/, ''))) return null;
  if ((ctx.companies ?? []).some((c) => c.trim() && norm(add as string).includes(norm(c)))) return null;
  if (sharesWords(add, ctx.askText, 6)) return null;
  const lines = ctx.rules.split('\n').map((l) => l.trim()).filter(Boolean);
  return { reason, context: ctx.matchedLine?.trim() || lines[lines.length - 1] || null, add };
}
