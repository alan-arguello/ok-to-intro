'use server';

import { redirect } from 'next/navigation';
import {
  exampleHref,
  normalizeAnswer,
  normalizeNote,
  offerHref,
  resultHref,
  sampleKeep,
  WHY_TO_REASON,
  isLoopAskId,
  withoutLine,
  type WhyKey,
  type WhyStep,
} from '@/components/offer/model';
import { csrfValid, resolveRecipientRef, serverIdempotencyKey } from '@/components/offer/server-guard';
import { suggestRuleEdit } from '@/lib/oti/rule-edits';
import { capMonth, nextMonthStart } from '@/lib/oti/time';
import { qaEnabled } from '@/lib/qa';
import { appendRuleLine, getMemberProfile, pauseMember, saveRules, setCap } from '@/lib/server/member';
import { getOffer, memberForOffer, respondToOffer, setNoReason, type OfferRef } from '@/lib/server/offers';
import type { OfferAction, OfferActionResult, OfferView } from '@/lib/types';

/**
 * The offer page's POSTs (ux-spec S4 “Interactions”, docs/CONTRACT.md §forms). Each one checks the form's CSRF token
 * (Next also checks Origin against Host for every server action), acts once (the idempotency key is built here from
 * the link and the action; the raw token is never stored), and answers with `redirect()`: a 303 to the result when
 * the form was posted without JS, a client navigation with JS. `redirect()` is always called outside try/catch.
 * SAMPLE (`/o/sample`) and the QA example change nothing: they only move to the next state.
 */

type Mode = 'sample' | 'example' | 'real';

const ACTIONS: readonly OfferAction[] = ['ok', 'answer', 'no'];
const WHYS: readonly WhyKey[] = ['area', 'stage', 'vague', 'busy', 'other'];

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === 'string' ? v : null;
}

interface Posted {
  ref: string;
  mode: Mode;
  keep: Record<string, string>;
}

/** Reads the fields every form carries. The mode is never trusted on its own: SAMPLE is `ref === 'sample'`. */
function posted(fd: FormData): Posted | null {
  const ref = str(fd, 'ref');
  if (!ref || ref.length > 64 || !/^[A-Za-z0-9_-]+$/.test(ref)) return null;
  const claimed = str(fd, 'mode');
  const mode: Mode = claimed === 'example' && qaEnabled() ? 'example' : ref === 'sample' ? 'sample' : 'real';
  const ask = str(fd, 'ask');
  const keep = mode === 'real' ? {} : sampleKeep({ ask: isLoopAskId(ask) ? ask : null, from: str(fd, 'from') === 'playground' ? 'playground' : null });
  return { ref, mode, keep };
}

type Resolved = { ok: true; ref: OfferRef; scope: string } | { ok: false; to: string };

/** REAL: the link (or the signed-in member's offer id) plus a valid CSRF token, or where to send the person. */
async function resolveReal(p: Posted, fd: FormData, onFail: string): Promise<Resolved> {
  const r = await resolveRecipientRef<OfferRef>(p.ref, 'o', { token: (token) => ({ token }), id: (offer_id, member_id) => ({ offer_id, member_id }) });
  if (r.kind !== 'real') return { ok: false, to: offerHref(p.ref) };
  if (!csrfValid(r.scope, str(fd, 'csrf'))) return { ok: false, to: onFail };
  return { ok: true, ref: r.ref, scope: r.scope };
}

function failUrl(p: Posted, r: { done?: OfferAction; why?: WhyKey | null; step?: WhyStep | null; choice?: OfferAction | null; error: 'server' | 'input' }): string {
  return p.mode === 'example' ? exampleHref(p.ref, r) : resultHref(p.ref, p.keep, r);
}

/* ======================================================================== *
 * OK (sends the intro), Answer in 2 lines, No
 * ======================================================================== */

export async function offerRespond(fd: FormData): Promise<void> {
  const p = posted(fd);
  if (!p) redirect('/o/invalid');
  const action = ACTIONS.find((a) => a === str(fd, 'action'));
  if (!action) redirect(offerHref(p.ref));
  const answer = action === 'answer' ? normalizeAnswer(str(fd, 'text')) : undefined;
  if (action === 'answer' && !answer) redirect(failUrl(p, { choice: 'answer', error: 'input' }));

  if (p.mode === 'sample') redirect(resultHref(p.ref, p.keep, { done: action }));
  if (p.mode === 'example') redirect(exampleHref(p.ref, { done: action }));

  const retry = action === 'no' ? null : action;
  const r = await resolveReal(p, fd, failUrl(p, { choice: retry, error: 'server' }));
  if (!r.ok) redirect(r.to);

  let res: OfferActionResult;
  try {
    res = await respondToOffer(r.ref, action, { answer: answer ?? undefined, idempotency_key: serverIdempotencyKey(r.scope, action) });
  } catch {
    res = { ok: false, reason: 'db_down' };
  }
  if (res.ok) redirect(resultHref(p.ref, {}, { done: action }));
  if (res.reason === 'db_down') redirect(failUrl(p, { choice: retry, error: 'server' }));
  if (res.reason === 'bad_input') redirect(failUrl(p, { choice: 'answer', error: 'input' }));
  // invalid, expired, already acted, withdrawn, not set up: the page shows the offer's real state.
  redirect(offerHref(p.ref));
}

/* ======================================================================== *
 * The optional, private reason after a No
 * ======================================================================== */

export async function offerReason(fd: FormData): Promise<void> {
  const p = posted(fd);
  if (!p) redirect('/o/invalid');
  const why = WHYS.find((w) => w === str(fd, 'why'));
  if (!why) redirect(resultHref(p.ref, p.keep, { done: 'no' }));

  if (p.mode === 'sample') redirect(resultHref(p.ref, p.keep, { done: 'no', why }));
  if (p.mode === 'example') redirect(exampleHref(p.ref, { done: 'no', why }));

  const r = await resolveReal(p, fd, failUrl(p, { done: 'no', why, error: 'server' }));
  if (!r.ok) redirect(r.to);
  let saved: Awaited<ReturnType<typeof setNoReason>>;
  try {
    saved = await setNoReason(r.ref, WHY_TO_REASON[why], null);
  } catch {
    saved = { ok: false, reason: 'db_down' };
  }
  if (saved.ok) redirect(resultHref(p.ref, {}, { done: 'no', why }));
  if (saved.reason === 'invalid') redirect(offerHref(p.ref));
  redirect(failUrl(p, { done: 'no', why, error: 'server' }));
}

/* ======================================================================== *
 * The fix that matches the reason: add the templated line (or undo it), lower the cap, pause, or a private note
 * ======================================================================== */

type FollowStep = 'add' | 'undo' | 'cap' | 'pause' | 'note';
const FOLLOW_RESULT: Record<FollowStep, WhyStep> = { add: 'applied', undo: 'undone', cap: 'cap', pause: 'pause', note: 'saved' };
const FOLLOW_WHY: Record<FollowStep, readonly WhyKey[]> = { add: ['area', 'stage'], undo: ['area', 'stage'], cap: ['busy'], pause: ['busy'], note: ['other'] };

/** The one templated line for this offer and reason (ignoring whether the rules already hold it). */
function templatedLine(offer: OfferView, why: 'area' | 'stage'): string | null {
  const e = suggestRuleEdit(WHY_TO_REASON[why], {
    rules: '',
    matchedLine: offer.matched?.line ?? null,
    topic: offer.topic,
    askText: offer.facts.map(([, v]) => v).join(' '),
    companies: [offer.asker.company],
  });
  return e?.add ?? null;
}

type FollowResult = 'done' | 'failed' | 'gone';

async function followReal(ref: OfferRef, step: FollowStep, why: WhyKey, note: string | null): Promise<FollowResult> {
  if (step === 'note') {
    if (!note) return 'failed';
    const saved = await setNoReason(ref, 'other', note);
    return saved.ok ? 'done' : saved.reason === 'invalid' ? 'gone' : 'failed';
  }
  const member = await memberForOffer(ref);
  if (!member) return 'gone';
  if (step === 'cap') return (await setCap(member.member_id, 1)).ok ? 'done' : 'failed';
  if (step === 'pause') return (await pauseMember(member.member_id, nextMonthStart(capMonth()).toISOString())).ok ? 'done' : 'failed';

  const look = await getOffer(ref);
  if (!look.found) return look.reason === 'invalid' ? 'gone' : 'failed';
  const line = templatedLine(look.offer, why === 'area' ? 'area' : 'stage');
  if (!line) return 'failed';
  if (step === 'add') return (await appendRuleLine(member.member_id, line, 'offer_edit')).ok ? 'done' : 'failed';

  // Undo: save the rules without the added line as a new version (nothing to undo is still “done”).
  const profile = await getMemberProfile(member.member_id);
  if (!profile.ok || !profile.member) return 'failed';
  const text = withoutLine(profile.member.rules, line);
  if (text === null) return 'done';
  return (await saveRules(member.member_id, text, 'offer_edit')).ok ? 'done' : 'failed';
}

export async function offerFollow(fd: FormData): Promise<void> {
  const p = posted(fd);
  if (!p) redirect('/o/invalid');
  const step = (['add', 'undo', 'cap', 'pause', 'note'] as const).find((s) => s === str(fd, 'step'));
  const why = WHYS.find((w) => w === str(fd, 'why'));
  if (!step || !why || !FOLLOW_WHY[step].includes(why)) redirect(resultHref(p.ref, p.keep, { done: 'no', why: why ?? null }));
  const note = step === 'note' ? normalizeNote(str(fd, 'note')) : null;
  // An empty note changes nothing: back to the form.
  if (step === 'note' && !note) redirect(p.mode === 'example' ? exampleHref(p.ref, { done: 'no', why }) : resultHref(p.ref, p.keep, { done: 'no', why }));

  const result = FOLLOW_RESULT[step];
  if (p.mode === 'sample') redirect(resultHref(p.ref, p.keep, { done: 'no', why, step: result }));
  if (p.mode === 'example') redirect(exampleHref(p.ref, { done: 'no', why, step: result }));

  const r = await resolveReal(p, fd, failUrl(p, { done: 'no', why, error: 'server' }));
  if (!r.ok) redirect(r.to);
  let outcome: FollowResult;
  try {
    outcome = await followReal(r.ref, step, why, note);
  } catch {
    outcome = 'failed';
  }
  if (outcome === 'done') redirect(resultHref(p.ref, {}, { done: 'no', why, step: result }));
  if (outcome === 'gone') redirect(offerHref(p.ref));
  redirect(failUrl(p, { done: 'no', why, error: 'server' }));
}
