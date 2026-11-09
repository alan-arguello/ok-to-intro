/**
 * The SAMPLE loop (S1/S2 → S4 → S5) read from the visitor's own tab (docs/CONTRACT.md §storage): which ask they
 * sent (`oti.sampleAsk.compiled`, the ask exactly as sent), who held the offer and when, what the visitor's own gate
 * quoted, and when they said OK on /o/sample (`oti.sampleOffer`). /o/sample?ask=…, /c/sample?ask=… and
 * /emails/<kind>?ask=… render THIS, falling back to lib/sample when the tab has nothing (a link opened in a new tab).
 * Everything is fictional and labelled SAMPLE. Pure, except `readSampleStoresRaw` (browser only, never throws).
 */

import type { SampleLoop } from '@/lib/emails/sample';
import { SAMPLE_YOU_LINE } from '@/lib/emails/sample';
import { askFacts } from '@/lib/oti/ask';
import { ownWords } from '@/lib/oti/clause';
import { STORAGE_KEYS, type PlaygroundStore, type SampleAskStore, type SampleOfferStore } from '@/lib/oti/storage';
import { bareSubject } from '@/lib/oti/text';
import { hoursLeft, OFFER_WINDOW_MS } from '@/lib/oti/time';
import { sampleAskById } from '@/lib/sample/asks';
import { memberCitation, SAMPLE_MEMBER_NAMES, SAMPLE_MEMBERS, SAMPLE_NETWORK_ASKS, sampleNetworkAskById } from '@/lib/sample/network';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { presetById } from '@/lib/sample/presets';
import { AUTHORED_VERDICTS } from '@/lib/sample/verdicts';
import type { CompiledAsk, PresetId } from '@/lib/types';
import type { OfferCardModel, SampleSource } from './model';

export interface SampleStores {
  sampleAsk: SampleAskStore | null;
  sampleOffer: SampleOfferStore | null;
  playground: PlaygroundStore | null;
}

const NO_STORES: SampleStores = { sampleAsk: null, sampleOffer: null, playground: null };

/**
 * The three stores as one string (a stable `useSyncExternalStore` snapshot: equal strings mean nothing changed).
 * Empty string when storage is unavailable.
 */
export function readSampleStoresRaw(): string {
  try {
    const s = window.sessionStorage;
    return [STORAGE_KEYS.sampleAsk, STORAGE_KEYS.sampleOffer, STORAGE_KEYS.playground].map((k) => s.getItem(k) ?? '').join('\u0000');
  } catch {
    return '';
  }
}

function parseV1<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: unknown } | null;
    return v && typeof v === 'object' && v.v === 1 ? (v as T) : null;
  } catch {
    return null;
  }
}

export function parseSampleStores(raw: string | null): SampleStores {
  if (!raw) return NO_STORES;
  const [a, o, p] = raw.split('\u0000');
  return { sampleAsk: parseV1<SampleAskStore>(a), sampleOffer: parseV1<SampleOfferStore>(o), playground: parseV1<PlaygroundStore>(p) };
}

/* ---------- helpers ---------- */

function validCompiled(c: unknown): c is CompiledAsk {
  const x = c as CompiledAsk | null;
  return !!x && typeof x === 'object' && typeof x.subject === 'string' && !!x.parts && typeof x.parts.challenge === 'string' && typeof x.parts.needs === 'string';
}

/** The visitor's rules for a preset: the playground's own text when it was written for that preset. */
function visitorRules(preset: PresetId, pg: PlaygroundStore | null): { rules: string; cap: number } {
  const p = presetById(preset);
  if (pg && pg.preset === preset && typeof pg.rules === 'string' && pg.rules.trim()) return { rules: pg.rules, cap: pg.cap || p.cap };
  return { rules: p.rules, cap: p.cap };
}

/** What the visitor's gate would quote on a sample ask, as the visitor's own words (authored, then found by code). */
function authoredMatch(preset: PresetId, askId: string, rules: string): string | null {
  const v = AUTHORED_VERDICTS[preset].find((x) => x.ask_id === askId);
  for (const c of v?.cited ?? []) {
    const own = ownWords(rules, c) ?? ownWords(presetById(preset).rules, c);
    if (own) return own;
  }
  return null;
}

const SAMPLE_FOUNDER = 'Sample founder';
const THE_FOUNDER = 'the founder';

/* ---------- the loop ---------- */

/**
 * The loop for a sample ask id (`sa_eng`…, or a custom `sa_…` when the tab has it) or a playground ask (`a01`…).
 * Null when nothing is known (a custom id in a new tab): callers show the canonical sample.
 */
export function loopForAsk(askId: string, stores: SampleStores, now: number): SampleLoop | null {
  const offer = stores.sampleOffer && stores.sampleOffer.ask_id === askId ? stores.sampleOffer : null;
  const introAt = offer && offer.action === 'ok' && typeof offer.at === 'number' ? offer.at : now;

  if (/^a(0[1-9]|1[0-2])$/.test(askId)) {
    const ask = sampleAskById(askId);
    if (!ask) return null;
    const pg = stores.playground;
    const preset = pg?.preset ?? 'engineer';
    const { rules, cap } = visitorRules(preset, pg);
    const row = pg?.results?.find((r) => r.ask_id === askId);
    const matched = row?.cited?.[0] ?? authoredMatch(preset, askId, rules) ?? '';
    return {
      askId,
      subject: ask.subject,
      parts: ask.parts,
      price: null,
      asker: { name: SAMPLE_FOUNDER, first: THE_FOUNDER, company: ask.company, stage: ask.stage, city: ask.city },
      member: { you: true, name: 'You', first: 'you', line: SAMPLE_YOU_LINE, scheduling: null },
      matched,
      cap,
      nth: 1,
      offeredAt: now,
      introAt,
      question: null,
    };
  }

  const st = stores.sampleAsk && stores.sampleAsk.id === askId ? stores.sampleAsk : null;
  const sa = sampleNetworkAskById(askId);
  if (!st && !sa) return null;
  const preset: PresetId = st?.preset ?? (sa?.preset as PresetId);
  const net = SAMPLE_NETWORK_ASKS[preset];
  const based = sa ? sampleAskById(sa.based_on) : null;
  const compiled: CompiledAsk | null = st && validCompiled(st.compiled) ? st.compiled : based && sa ? { parts: based.parts, subject: sa.subject, text: based.text, price: null, topic: based.topic } : null;
  if (!compiled) return null;
  const to = st?.offered_to ?? 'you';
  const pg = stores.playground;
  const asker = { name: net.as.name, first: THE_FOUNDER, company: net.as.company, stage: net.as.stage, city: net.as.city };
  const offeredAt = typeof st?.offered_at === 'number' ? st.offered_at : typeof st?.sent_at === 'number' ? st.sent_at : now;
  const question = st?.question ?? null;
  const price = compiled.price && compiled.price.trim() ? compiled.price.trim() : st?.answered?.type === 'price' ? st.answered.text : null;

  if (to === 'you') {
    const { rules, cap } = visitorRules(preset, pg);
    const matched = st?.you_cited?.find((c) => typeof c === 'string' && c.trim()) ?? (sa ? authoredMatch(preset, sa.based_on, rules) : null) ?? '';
    return {
      askId,
      subject: compiled.subject,
      parts: compiled.parts,
      price,
      asker,
      member: { you: true, name: 'You', first: 'you', line: SAMPLE_YOU_LINE, scheduling: null },
      matched,
      cap,
      nth: 1,
      offeredAt,
      introAt,
      question,
    };
  }

  const m = SAMPLE_MEMBERS.find((x) => x.label === to);
  const nm = SAMPLE_MEMBER_NAMES[to];
  return {
    askId,
    subject: compiled.subject,
    parts: compiled.parts,
    price,
    asker,
    member: {
      you: false,
      name: nm?.name ?? 'A sample member',
      first: nm?.first ?? 'the member',
      line: nm?.line ?? null,
      scheduling: nm ? `https://${nm.scheduling}` : null,
    },
    matched: m ? memberCitation(m) : '',
    cap: m?.cap ?? 2,
    nth: m ? Math.min(m.used + 1, m.cap) : 1,
    offeredAt,
    introAt,
    question,
  };
}

/** The playground's top “Reaches you” row as a loop (ux-spec S1: the card quotes the visitor's own words). */
export function loopForPlayground(stores: SampleStores, now: number): SampleLoop | null {
  const top = stores.playground?.results?.find((r) => r.display === 'reach');
  return top ? loopForAsk(top.ask_id, stores, now) : null;
}

/* ---------- cards ---------- */

/** The canonical SAMPLE card: Lucía Ferrer's ask, Ana's matched rule (also the QA example). */
export function canonicalCard(): OfferCardModel {
  const a = OFFER_SAMPLE.asker;
  return {
    title: OFFER_SAMPLE.title,
    from: [a.name, a.company, a.stage, a.city].join(' · '),
    matched: OFFER_SAMPLE.matched,
    facts: [...OFFER_SAMPLE.facts],
    who: a.first,
    cap: OFFER_SAMPLE.member.cap,
    nth: OFFER_SAMPLE.member.used_before + 1,
  };
}

export function cardFromLoop(loop: SampleLoop): OfferCardModel {
  const playground = /^a\d\d$/.test(loop.askId);
  const a = loop.asker;
  // The member card shows the price the founder told a gate; on the visitor's own gate, say so.
  const price = loop.price ? `${loop.price}${loop.member.you && loop.question?.type === 'price' ? ' (the founder told your gate)' : ''}` : null;
  return {
    title: bareSubject(loop.subject),
    // The playground's 12 asks have no founder name (prototype offerFromPlayground).
    from: (playground ? [a.company, a.stage, a.city] : [a.name, a.company, a.stage, a.city]).join(' · '),
    matched: loop.matched || null,
    facts: askFacts(loop.parts, price),
    who: a.first,
    cap: loop.cap,
    nth: loop.nth,
  };
}

/** Hours left on a SAMPLE offer, from the ask's own send time (the viewer's clock). */
export function loopHours(loop: SampleLoop, now: number): number {
  return hoursLeft(loop.offeredAt + OFFER_WINDOW_MS, now);
}

/** What the server can render before the tab is read: the canonical card for the known sample ids, else Lucía's. */
export function serverSampleCard(source: SampleSource, now: number): { card: OfferCardModel; askId: string | null } {
  if (source.kind === 'ask') {
    const loop = loopForAsk(source.id, NO_STORES, now);
    if (loop) return { card: cardFromLoop(loop), askId: source.id };
  }
  return { card: canonicalCard(), askId: null };
}

/** The client's card once the tab has been read; null when the tab knows nothing more than the server did. */
export function clientSampleCard(source: SampleSource, stores: SampleStores, now: number): { card: OfferCardModel; askId: string; hours: number; loop: SampleLoop } | null {
  const loop = source.kind === 'ask' ? loopForAsk(source.id, stores, now) : source.kind === 'playground' ? loopForPlayground(stores, now) : null;
  return loop ? { card: cardFromLoop(loop), askId: loop.askId, hours: loopHours(loop, now), loop } : null;
}
