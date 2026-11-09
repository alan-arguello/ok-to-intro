'use server';

import { redirect } from 'next/navigation';
import { checkinHref, savedQaState, toAnswer, wontReason } from '@/components/checkin/model';
import { isLoopAskId } from '@/components/offer/model';
import { csrfValid, resolveRecipientRef, serverIdempotencyKey } from '@/components/offer/server-guard';
import { hash32 } from '@/lib/oti/text';
import { qaEnabled } from '@/lib/qa';
import { saveCheckin, type CheckinRef } from '@/lib/server/checkins';
import type { CheckinKind, CheckinRole, CheckinSaveResult } from '@/lib/types';

/**
 * The check-in page's one POST (ux-spec S5, docs/CONTRACT.md §forms): CSRF token + Next's Origin check, an
 * idempotency key built here from the link and the answer (the same answer twice records once; a changed answer is
 * a new key), then `redirect()` (303 without JS). SAMPLE (`/c/sample`) and the QA example save nothing.
 */

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === 'string' ? v : null;
}

export async function checkinSave(fd: FormData): Promise<void> {
  const ref = str(fd, 'ref');
  if (!ref || ref.length > 64 || !/^[A-Za-z0-9_-]+$/.test(ref)) redirect('/c/invalid');
  const kindRaw = str(fd, 'kind');
  const kind: CheckinKind = kindRaw === 'd14' || kindRaw === '14d' ? 'd14' : 'd1';
  const role: CheckinRole = str(fd, 'role') === 'member' ? 'member' : 'asker';
  const value = str(fd, 'value');
  const reason = wontReason(str(fd, 'reason'));
  const answer = toAnswer(kind, value, reason, str(fd, 'note'));
  const claimed = str(fd, 'mode');
  const mode = claimed === 'example' && qaEnabled() ? 'example' : ref === 'sample' ? 'sample' : 'real';
  const ask = str(fd, 'ask');
  const keep: Record<string, string> =
    mode === 'sample' ? { ...(isLoopAskId(ask) ? { ask } : {}), ...(kind === 'd14' ? { kind: '14d' } : {}), ...(role === 'member' ? { who: 'member' } : {}) } : {};
  const change = str(fd, 'change') === '1' ? '1' : null;
  const why = answer && answer.kind === 'd1' && 'wont_happen' in answer ? answer.reason : null;

  if (mode === 'example') {
    if (!answer) redirect(checkinHref(ref, { state: 'save-failed', kind: kind === 'd14' ? '14d' : null, who: role === 'member' ? 'member' : null }));
    redirect(checkinHref(ref, { state: savedQaState(kind, role, value as string), v: value, why, who: role === 'member' ? 'member' : null, kind: kind === 'd14' ? '14d' : null }));
  }
  if (mode === 'sample') {
    if (!answer) redirect(checkinHref(ref, { ...keep, error: 'input' }));
    redirect(checkinHref(ref, { ...keep, done: '1', v: value, why }));
  }

  const r = await resolveRecipientRef<CheckinRef>(ref, 'c', { token: (token) => ({ token }), id: (checkin_id, member_id) => ({ checkin_id, member_id }) });
  if (r.kind !== 'real') redirect(checkinHref(ref));
  if (!csrfValid(r.scope, str(fd, 'csrf'))) redirect(checkinHref(ref, { change, v: value, why, error: 'server' }));
  if (!answer) redirect(checkinHref(ref, { change, error: 'input' }));

  // The answer is part of the key: the same answer twice records once; changing it is a new, deliberate save.
  const note = answer.kind === 'd14' && answer.note ? `:${hash32(answer.note).toString(36)}` : '';
  const key = serverIdempotencyKey(r.scope, `${kind}:${value}${why ? `:${why}` : ''}${note}`);
  let res: CheckinSaveResult;
  try {
    res = await saveCheckin(r.ref, answer, key);
  } catch {
    res = { ok: false, reason: 'db_down' };
  }
  if (res.ok) redirect(checkinHref(ref, { done: '1' }));
  if (res.reason === 'db_down') redirect(checkinHref(ref, { change, v: value, why, error: 'server' }));
  if (res.reason === 'bad_input') redirect(checkinHref(ref, { change, error: 'input' }));
  // invalid, closed, not set up: the page shows the check-in's real state.
  redirect(checkinHref(ref));
}
