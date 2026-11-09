import 'server-only';
import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { queryKey } from '@/components/offer/load';
import type { Params } from '@/components/offer/model';
import { csrfToken, EXAMPLE_CSRF, resolveRecipientRef, SAMPLE_CSRF } from '@/components/offer/server-guard';
import { loopForAsk } from '@/components/offer/sample-loop';
import { loopOther } from '@/lib/emails/sample';
import { bareSubject } from '@/lib/oti/text';
import { DAY_MS, fmtDay, NETWORK_TZ } from '@/lib/oti/time';
import { qaEnabled } from '@/lib/qa';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { getCheckin, type CheckinRef } from '@/lib/server/checkins';
import type { CheckinLookup, CheckinRole } from '@/lib/types';
import {
  answerValue,
  parseCheckinQuery,
  sampleCheckinKeep,
  uiFromQuery,
  uiFromRecord,
  type CheckinPageModel,
  type CheckinQuery,
  type CheckinUi,
  type CkTimeLabel,
} from './model';

/**
 * Builds what /c/[token] renders (GET preselects, never saves). Order: QA state → `sample` → link token → `c_…` id
 * for the signed-in member → invalid. Without Supabase every REAL link renders the not-set-up state; a database
 * error renders “Something broke on our side. Nothing was sent to anyone.”
 */

/** The fixed REAL example (Lucía asked, Ana said OK on Mon Nov 9). */
const EXAMPLE = {
  introMade: '2026-11-09T21:16:00-06:00',
  d14: '2026-11-23T10:00:00-06:00',
  reminder: '2026-11-13T10:00:00-06:00',
  answeredD1: '2026-11-10T10:00:00-06:00',
  answeredD14: '2026-11-24T10:00:00-06:00',
  closed: '2026-12-09T10:00:00-06:00',
};

function day(iso: string): CkTimeLabel {
  return { iso, text: fmtDay(Date.parse(iso), NETWORK_TZ) };
}
function dayMs(ms: number): CkTimeLabel {
  return day(new Date(ms).toISOString());
}

function exampleOther(role: CheckinRole): { name: string; first: string } {
  return role === 'member' ? { name: OFFER_SAMPLE.asker.name, first: OFFER_SAMPLE.asker.first } : { name: OFFER_SAMPLE.member.name, first: OFFER_SAMPLE.member.first };
}

function cardless(view: 'invalid' | 'unconfigured' | 'broken', nonce: string): CheckinPageModel {
  const ui: CheckinUi = { view, kind: 'd1', role: 'asker', value: null, reason: null, failed: null };
  return {
    nonce,
    self: '/',
    mode: 'real',
    ui,
    source: { kind: 'none' },
    other: null,
    subject: null,
    introMade: null,
    d14: null,
    reminder: null,
    answeredOn: null,
    closedOn: null,
    note: '',
    forms: null,
    justActed: false,
  };
}

/** SAMPLE (/c/sample) and the QA example: the URL is the state; the loop's people come from the visitor's tab. */
function sampleOrExample(segment: string, q: CheckinQuery, nonce: string, now: number, qa: boolean): CheckinPageModel {
  const sample = segment === 'sample';
  const ui = uiFromQuery(q);
  if (ui.view === 'invalid') return { ...cardless('invalid', nonce), mode: sample ? 'sample' : 'example' };
  const loop = sample && q.ask ? loopForAsk(q.ask, { sampleAsk: null, sampleOffer: null, playground: null }, now) : null;
  const other = loop ? loopOther(loop, ui.role) : exampleOther(ui.role);
  const keep = sample ? sampleCheckinKeep(q, ui) : {};
  return {
    nonce,
    self: '/',
    mode: sample ? 'sample' : 'example',
    ui,
    // The loop's ask id even when only the visitor's tab knows it (a custom `sa_…` send): the client rebuilds the
    // names and dates from the tab, and the footer's “Your ask” opens that ask.
    source: sample && q.ask ? { kind: 'ask', id: q.ask } : sample ? { kind: 'canonical' } : { kind: 'none' },
    other,
    subject: loop ? bareSubject(loop.subject) : OFFER_SAMPLE.title,
    introMade: loop ? dayMs(loop.introAt) : day(EXAMPLE.introMade),
    d14: loop ? dayMs(loop.introAt + 14 * DAY_MS) : day(EXAMPLE.d14),
    reminder: loop ? dayMs(loop.introAt + 4 * DAY_MS) : day(EXAMPLE.reminder),
    answeredOn: ui.kind === 'd14' ? day(EXAMPLE.answeredD14) : day(EXAMPLE.answeredD1),
    closedOn: day(EXAMPLE.closed),
    note: '',
    forms: { ref: segment, csrf: qa ? EXAMPLE_CSRF : SAMPLE_CSRF, mode: qa ? 'example' : 'sample', keep },
    justActed: q.done,
  };
}

async function realModel(segment: string, q: CheckinQuery, nonce: string, now: number): Promise<CheckinPageModel> {
  const r = await resolveRecipientRef<CheckinRef>(segment, 'c', { token: (token) => ({ token }), id: (checkin_id, member_id) => ({ checkin_id, member_id }) });
  if (r.kind === 'sample') return sampleOrExample(segment, q, nonce, now, false);
  if (r.kind !== 'real') return cardless(r.kind, nonce);
  let look: CheckinLookup;
  try {
    look = await getCheckin(r.ref, new Date(now));
  } catch {
    look = { found: false, reason: 'db_down' };
  }
  if (!look.found) return cardless(look.reason === 'invalid' ? 'invalid' : look.reason === 'not_configured' ? 'unconfigured' : 'broken', nonce);
  const csrf = csrfToken(r.scope);
  if (!csrf) return cardless('unconfigured', nonce);
  const c = look.checkin;
  const ui = uiFromRecord(c, q, now);
  const made = Date.parse(c.intro_made_at);
  return {
    nonce,
    self: '/',
    mode: 'real',
    ui,
    source: c.ask_id ? { kind: 'ask', id: c.ask_id } : { kind: 'none' },
    other: { name: c.other_name, first: c.other_first },
    subject: bareSubject(c.intro_subject),
    introMade: day(c.intro_made_at),
    d14: Number.isNaN(made) ? null : dayMs(made + 14 * DAY_MS),
    reminder: c.reminder_at ? day(c.reminder_at) : Number.isNaN(made) ? null : dayMs(made + 4 * DAY_MS),
    answeredOn: c.answered_at ? day(c.answered_at) : null,
    closedOn: day(c.closes_at),
    note: c.answer && c.answer.kind === 'd14' ? (c.answer.note ?? '') : '',
    forms: { ref: segment, csrf, mode: 'real', keep: ui.view === 'form' && answerValue(c.answer) ? { change: '1' } : {} },
    justActed: q.done,
  };
}

const loadCached = cache(async (segment: string, key: string): Promise<CheckinPageModel> => {
  const now = Date.now();
  const nonce = randomUUID();
  const qa = qaEnabled();
  const q = parseCheckinQuery(Object.fromEntries(new URLSearchParams(key)), qa);
  if (q.qa) return sampleOrExample(segment, q, nonce, now, true);
  return realModel(segment, q, nonce, now);
});

export async function loadCheckinPage(segment: string, sp: Params): Promise<CheckinPageModel> {
  const key = queryKey(sp);
  const model = await loadCached(segment, key);
  return { ...model, self: `/c/${encodeURIComponent(segment)}${key ? `?${key}` : ''}` };
}
