import 'server-only';
import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { SUGGESTED_EDIT_UNTESTED } from '@/lib/oti/copy';
import { suggestRuleEdit } from '@/lib/oti/rule-edits';
import { capMonth, fmtClock, fmtDay, fmtWeekday, hoursLeft, NETWORK_TZ, resetsOn } from '@/lib/oti/time';
import { qaEnabled } from '@/lib/qa';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { getMemberProfile } from '@/lib/server/member';
import { getOffer, memberForOffer, type OfferRef } from '@/lib/server/offers';
import type { OfferLookup, OfferView } from '@/lib/types';
import {
  isDoneView,
  parseOfferQuery,
  sampleKeep,
  uiFromQuery,
  uiFromRecord,
  WHY_TO_REASON,
  type OfferEditModel,
  type OfferPageModel,
  type OfferQuery,
  type OfferUi,
  type Params,
  type SampleSource,
  type TimeLabel,
  type WhyKey,
} from './model';
import { canonicalCard, serverSampleCard } from './sample-loop';
import { csrfToken, EXAMPLE_CSRF, resolveRecipientRef, SAMPLE_CSRF } from './server-guard';

/**
 * Builds what /o/[token] renders (GET never changes anything). Order (docs/CONTRACT.md §b): QA state → `sample` →
 * link token → `o_…` id for the signed-in member → invalid. Without Supabase every REAL link renders the
 * not-set-up state; a database error renders “Something broke on our side. Nothing was sent to anyone.”
 */

/** The fixed REAL example the QA states render (Mon Nov 9, 21:04 CST → Thu Nov 12, 21:04 CST). */
const EXAMPLE = {
  offerId: 'o_3Fp9',
  actedAt: '2026-11-09T21:16:00-06:00',
  withdrawnAt: '2026-11-10T10:12:00-06:00',
  pausedUntil: 'Dec 1',
  rulesVersion: 4,
};

function weekdayAt(iso: string): TimeLabel {
  const ms = Date.parse(iso);
  return { iso, text: `${fmtWeekday(ms, NETWORK_TZ)} at ${fmtClock(ms, NETWORK_TZ)}` };
}
function clockAt(iso: string): TimeLabel {
  return { iso, text: fmtClock(Date.parse(iso), NETWORK_TZ) };
}
function weekdayOn(iso: string): TimeLabel {
  return { iso, text: fmtWeekday(Date.parse(iso), NETWORK_TZ) };
}

/** The hand-written edit for Ana's rules (SAMPLE and the QA example), labelled as written by hand. */
function sampleEdit(why: WhyKey | null): OfferEditModel | null {
  if (why !== 'area' && why !== 'stage') return null;
  const e = OFFER_SAMPLE.suggested_edits[why];
  return { context: e.context, add: e.add, caption: e.expected };
}

function baseModel(nonce: string, now: number): Pick<OfferPageModel, 'nonce' | 'self' | 'pauseUntil' | 'pausedUntil' | 'edit' | 'rulesVersion' | 'acted' | 'okAt' | 'expiredAt' | 'withdrawnOn' | 'scheduling' | 'base' | 'justActed'> {
  return {
    nonce,
    self: '/',
    pauseUntil: resetsOn(capMonth(now)),
    pausedUntil: null,
    edit: null,
    rulesVersion: null,
    acted: null,
    okAt: null,
    expiredAt: null,
    withdrawnOn: null,
    scheduling: false,
    base: false,
    justActed: false,
  };
}

function cardless(view: 'invalid' | 'unconfigured' | 'broken', mode: OfferPageModel['mode'], nonce: string, now: number): OfferPageModel {
  const ui: OfferUi = { view, nohint: false, failed: null, paused: false, why: null, step: null, did: 'ok' };
  return { ...baseModel(nonce, now), mode, ui, card: null, source: { kind: 'none' }, hours: null, forms: null };
}

/** QA: `?state=` renders the prototype's state from the fixed example (`/o/sample?state=…` keeps the SAMPLE flavor). */
function qaModel(segment: string, q: OfferQuery, nonce: string, now: number): OfferPageModel {
  const sample = segment === 'sample';
  const ui = uiFromQuery(q);
  if (ui.view === 'invalid') return cardless('invalid', sample ? 'sample' : 'example', nonce, now);
  const source: SampleSource = sample ? (q.ask ? { kind: 'ask', id: q.ask } : q.from ? { kind: 'playground' } : { kind: 'canonical' }) : { kind: 'none' };
  const card = sample ? serverSampleCard(source, now).card : canonicalCard();
  const base = !sample || source.kind === 'canonical';
  return {
    ...baseModel(nonce, now),
    mode: sample ? 'sample' : 'example',
    ui,
    card,
    source,
    hours: isDoneView(ui.view) ? null : sample ? 72 : OFFER_SAMPLE.hours_left,
    pausedUntil: ui.paused ? EXAMPLE.pausedUntil : null,
    edit: base ? sampleEdit(ui.why) : null,
    rulesVersion: EXAMPLE.rulesVersion,
    acted: weekdayAt(EXAMPLE.actedAt),
    okAt: clockAt(EXAMPLE.actedAt),
    expiredAt: weekdayAt(OFFER_SAMPLE.reply_by_iso),
    withdrawnOn: weekdayOn(EXAMPLE.withdrawnAt),
    scheduling: true,
    base,
    forms: { ref: segment, csrf: EXAMPLE_CSRF, mode: 'example', offerId: EXAMPLE.offerId, keep: sample ? sampleKeep(q) : {} },
    justActed: false,
  };
}

/** SAMPLE (/o/sample): lib/sample on the server; the client reads the visitor's own tab for `?ask=` and `?from=`. */
function sampleModel(q: OfferQuery, nonce: string, now: number): OfferPageModel {
  const source: SampleSource = q.ask ? { kind: 'ask', id: q.ask } : q.from ? { kind: 'playground' } : { kind: 'canonical' };
  const ui = uiFromQuery(q);
  const base = source.kind === 'canonical';
  return {
    ...baseModel(nonce, now),
    mode: 'sample',
    ui,
    card: serverSampleCard(source, now).card,
    source,
    // SAMPLE times are the viewer's own: the canonical sample was offered just now; a loop's ask counts down from
    // its own send time (the client reads it from the tab).
    hours: isDoneView(ui.view) ? null : 72,
    edit: base ? sampleEdit(ui.why) : null,
    rulesVersion: base ? EXAMPLE.rulesVersion : null,
    base,
    forms: { ref: 'sample', csrf: SAMPLE_CSRF, mode: 'sample', offerId: 'o_sample', keep: sampleKeep(q) },
    justActed: !!(q.done || q.step),
  };
}

/** The templated, additive rule edit for a REAL No (docs/CONTRACT.md §b “REAL No-reason diff”). */
async function realEdit(ref: OfferRef, offer: OfferView, why: WhyKey | null): Promise<{ edit: OfferEditModel | null; version: number | null }> {
  if (why !== 'area' && why !== 'stage') return { edit: null, version: null };
  const member = await memberForOffer(ref).catch(() => null);
  if (!member) return { edit: null, version: null };
  const profile = await getMemberProfile(member.member_id).catch(() => null);
  if (!profile || !profile.ok || !profile.member) return { edit: null, version: null };
  const e = suggestRuleEdit(WHY_TO_REASON[why], {
    rules: profile.member.rules,
    matchedLine: offer.matched?.line ?? null,
    topic: offer.topic,
    askText: offer.facts.map(([, v]) => v).join(' '),
    companies: [offer.asker.company],
  });
  return { edit: e ? { context: e.context, add: e.add, caption: SUGGESTED_EDIT_UNTESTED } : null, version: profile.member.rules_version };
}

async function realModel(segment: string, q: OfferQuery, nonce: string, now: number): Promise<OfferPageModel> {
  const r = await resolveRecipientRef<OfferRef>(segment, 'o', { token: (token) => ({ token }), id: (offer_id, member_id) => ({ offer_id, member_id }) });
  if (r.kind === 'sample') return sampleModel(q, nonce, now);
  if (r.kind !== 'real') return cardless(r.kind, 'real', nonce, now);

  let look: OfferLookup;
  try {
    look = await getOffer(r.ref, new Date(now));
  } catch {
    look = { found: false, reason: 'db_down' };
  }
  if (!look.found) return cardless(look.reason === 'invalid' ? 'invalid' : look.reason === 'not_configured' ? 'unconfigured' : 'broken', 'real', nonce, now);

  const csrf = csrfToken(r.scope);
  if (!csrf) return cardless('unconfigured', 'real', nonce, now);

  const offer = look.offer;
  const ui = uiFromRecord(offer, q, now);
  const { edit, version } = ui.view === 'no' ? await realEdit(r.ref, offer, ui.why) : { edit: null, version: null };
  const a = offer.asker;
  const responded = offer.responded_at;
  return {
    ...baseModel(nonce, now),
    mode: 'real',
    ui,
    card: {
      title: offer.title,
      from: [a.name, a.company, a.stage, a.city].filter(Boolean).join(' · '),
      matched: offer.matched?.text ?? null,
      facts: offer.facts,
      who: a.first,
      cap: offer.cap,
      nth: offer.nth,
    },
    source: { kind: 'none' },
    hours: isDoneView(ui.view) ? null : hoursLeft(Date.parse(offer.expires_at), now),
    pausedUntil: ui.paused && offer.paused_until ? fmtDay(Date.parse(offer.paused_until), NETWORK_TZ) : null,
    edit,
    rulesVersion: version,
    acted: responded ? weekdayAt(responded) : null,
    okAt: responded ? clockAt(responded) : null,
    expiredAt: weekdayAt(offer.expires_at),
    withdrawnOn: offer.ask_withdrawn_at ? weekdayOn(offer.ask_withdrawn_at) : null,
    scheduling: !!offer.scheduling_url,
    base: false,
    forms: { ref: segment, csrf, mode: 'real', offerId: offer.offer_id, keep: {} },
    justActed: !!(q.done || q.step),
  };
}

/** A stable cache key for the query (React `cache` compares arguments by identity). */
export function queryKey(sp: Params): string {
  const qs = new URLSearchParams();
  for (const k of Object.keys(sp).sort()) {
    const v = sp[k];
    for (const s of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, s);
  }
  return qs.toString();
}

/** One model per request: generateMetadata and the page share it. */
const loadCached = cache(async (segment: string, key: string): Promise<OfferPageModel> => {
  const now = Date.now();
  const nonce = randomUUID();
  const q = parseOfferQuery(Object.fromEntries(new URLSearchParams(key)), qaEnabled());
  if (q.qa) return qaModel(segment, q, nonce, now);
  return realModel(segment, q, nonce, now);
});

export async function loadOfferPage(segment: string, sp: Params): Promise<OfferPageModel> {
  const key = queryKey(sp);
  const model = await loadCached(segment, key);
  return { ...model, self: `/o/${encodeURIComponent(segment)}${key ? `?${key}` : ''}` };
}
