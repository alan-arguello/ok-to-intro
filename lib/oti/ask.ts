/**
 * One ask, shown the same way everywhere (ux-spec Revision 3): the card opens with Problem, and Needs reads
 * “20 minutes with …” on the S2 preview, the S4 page, the offer and intro emails, and MCP receipts.
 * Also the code checks every path that creates or sends an ask runs, whatever the client sent (the compiler is the
 * UX; these are the guard). Pure; safe in client and server code.
 */

import type { AskParts, CompiledAsk, Fact, PartKey } from '@/lib/types';
import { ASK_TEXT_MAX, lower1, needsLine, stripEnd, SUBJECT_MAX, upper1 } from './text';

/** Longest single part (challenge, tried, needs, by, offers). */
export const PART_MAX = 200;
/** Longest ask as members read it: the founder's text (≤ 600) plus the sentences for the parts they added. */
export const ASK_FINAL_MAX = 900;
/** Longest price or answer fact shown on the card. */
export const PRICE_MAX = 100;
export const TOPIC_MAX = 80;

const clean = (s: string | null | undefined) => stripEnd(String(s ?? '').replace(/\s+/g, ' ').trim());

/**
 * Card facts in order: Problem, Needs, Tried, By, Offers, then Price when a gate asked for it and the asker
 * answered. Empty parts are dropped. `price` is the fact text as the surface shows it, e.g.
 * “$18k a year per hospital (Lucía told your gate)”.
 */
export function askFacts(parts: AskParts, price?: string | null): Fact[] {
  const facts: Fact[] = [];
  const add = (label: Fact[0], value: string) => {
    if (value) facts.push([label, value]);
  };
  add('Problem', upper1(clean(parts.challenge)));
  add('Needs', needsLine(clean(parts.needs)));
  add('Tried', upper1(clean(parts.tried)));
  add('By', clean(parts.by));
  add('Offers', upper1(clean(parts.offers)));
  if (price && price.trim()) add('Price', price.trim());
  return facts;
}

/**
 * The ask as members read it: the founder's own text, then one sentence per part they added after the check, in
 * the order tried, needs (+ by), offers. Parts the compiler found in the text are not repeated.
 * assembleAskText('…writes still block.', parts, ['needs', 'by', 'offers']) →
 * “…writes still block. Need 20 minutes with someone who has run Postgres past 100M rows, before Nov 21. Offer: our load-test harness.”
 */
export function assembleAskText(raw: string, parts: AskParts, added: readonly PartKey[]): string {
  let base = String(raw ?? '').trim();
  const has = (k: PartKey) => added.includes(k) && clean(parts[k]) !== '';
  if (has('challenge')) base = `${upper1(clean(parts.challenge))}.${base ? ` ${base}` : ''}`;
  const extra: string[] = [];
  if (has('tried')) extra.push(`Tried ${lower1(clean(parts.tried))}.`);
  if (has('needs')) extra.push(`Need ${lower1(needsLine(clean(parts.needs)))}${has('by') ? `, before ${clean(parts.by)}` : ''}.`);
  else if (has('by')) extra.push(`Needed before ${clean(parts.by)}.`);
  if (has('offers')) extra.push(`Offer: ${lower1(clean(parts.offers))}.`);
  if (!extra.length) return base;
  if (!base) return extra.join(' ');
  return `${base}${/[.!?…]["”’)]?$/.test(base) ? '' : '.'} ${extra.join(' ')}`;
}

/**
 * Asks about YC applications are never sent (ux-spec S2 “Refusals”). The compiler refuses them; this code check
 * runs again wherever an ask is created or sent, so a client can't skip it.
 */
export function isYcApplicationAsk(text: string): boolean {
  const t = String(text ?? '');
  return /\b(yc|y combinator|ycombinator)\b/i.test(t) && /applica|apply|interview|batch/i.test(t);
}

export const YC_APPLICATION_REFUSAL = 'Asks about YC applications aren’t sent. Members agreed to be asked about their work, not about applications.';

export type AskValidation = { ok: true } | { ok: false; reason: 'invalid' | 'yc_application'; message: string; field?: PartKey | 'text' | 'subject' };

/**
 * The server-side check for an ask a client approved (POST /api/asks, POST /api/asks/sample, MCP send_ask):
 * the founder's text 1..600, all 5 parts present (≤ 200 each), a one-line subject ≤ 45, the members' text ≤ 900,
 * and never a YC application. Never trusts that the client ran the compiler.
 */
export function validateAsk(raw: string, compiled: CompiledAsk | null | undefined): AskValidation {
  const text = String(raw ?? '').trim();
  if (!text || text.length > ASK_TEXT_MAX) return { ok: false, reason: 'invalid', message: `Your ask needs 1 to ${ASK_TEXT_MAX} characters.`, field: 'text' };
  if (!compiled || typeof compiled !== 'object' || !compiled.parts) return { ok: false, reason: 'invalid', message: 'Check your ask first: all 5 parts are needed.' };
  const keys: PartKey[] = ['challenge', 'tried', 'needs', 'by', 'offers'];
  for (const k of keys) {
    const v = clean(compiled.parts[k]);
    if (!v) return { ok: false, reason: 'invalid', message: 'All 5 parts are needed before it can be sent.', field: k };
    if (v.length > PART_MAX) return { ok: false, reason: 'invalid', message: `Keep each part under ${PART_MAX} characters.`, field: k };
  }
  const subject = String(compiled.subject ?? '').trim();
  if (!subject || subject.length > SUBJECT_MAX || /[\r\n]/.test(subject)) return { ok: false, reason: 'invalid', message: `The subject needs 1 to ${SUBJECT_MAX} characters on one line.`, field: 'subject' };
  const final = String(compiled.text ?? '').trim();
  if (!final || final.length > ASK_FINAL_MAX) return { ok: false, reason: 'invalid', message: `The ask members read needs 1 to ${ASK_FINAL_MAX} characters.`, field: 'text' };
  if (compiled.price !== null && compiled.price !== undefined && (typeof compiled.price !== 'string' || compiled.price.length > PRICE_MAX)) {
    return { ok: false, reason: 'invalid', message: `Keep the price under ${PRICE_MAX} characters.` };
  }
  if (compiled.topic !== null && compiled.topic !== undefined && (typeof compiled.topic !== 'string' || compiled.topic.length > TOPIC_MAX)) {
    return { ok: false, reason: 'invalid', message: 'The topic is too long.' };
  }
  const all = [text, final, subject, ...keys.map((k) => compiled.parts[k])].join('\n');
  if (isYcApplicationAsk(all)) return { ok: false, reason: 'yc_application', message: YC_APPLICATION_REFUSAL };
  return { ok: true };
}
