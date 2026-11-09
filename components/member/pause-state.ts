/**
 * What /pause/[token] shows for a link that works, from the member's real state and the query BE2's /api/pause
 * redirects back with (`?done=<until>` or `?error=<reason>`), plus `?until=` from the no-JS chips. Pure: the page and
 * the tests share it.
 */

import { fmtDay, NETWORK_TZ, toMs } from '@/lib/oti/time';
import type { MemberStatus } from '@/lib/types';
import { isPauseChoice, PAUSE_COPY, type PauseChoice } from './copy';

/** `failed`: the POST never reached us (client) or carried a bad value; `down`: our side; `undo_gone`: Undo can't apply. */
export type PauseError = 'failed' | 'down' | 'undo_gone';

export type PauseViewState =
  | { kind: 'confirm'; choice: PauseChoice; error: PauseError | null; undone: boolean }
  | { kind: 'paused'; phrase: string; canUndo: boolean; focus: boolean; error: PauseError | null };

export interface PauseLinkState {
  status: MemberStatus;
  paused_until: string | null;
  can_undo: boolean;
}

export function pauseErrorText(error: PauseError): string {
  if (error === 'down') return PAUSE_COPY.down;
  if (error === 'undo_gone') return PAUSE_COPY.undoGone;
  return PAUSE_COPY.failed;
}

/** “for 2 weeks” right after choosing it, otherwise the real end: “until Nov 23”, or “until you turn them back on”. */
function pausedPhrase(pausedUntil: string | null, done: string | undefined): string {
  if (done === '2w') return 'for 2 weeks';
  return pausedUntil ? `until ${fmtDay(toMs(pausedUntil), NETWORK_TZ)}` : 'until you turn them back on';
}

export function pauseViewState(view: PauseLinkState, q: { until?: string; done?: string; error?: string }): PauseViewState {
  const choice: PauseChoice = isPauseChoice(q.until) ? q.until : 'month';
  let error: PauseError | null = null;
  if (q.error === 'db_down' || q.error === 'not_configured') error = 'down';
  // `invalid` on a link that still resolves: an Undo past its 24 hours, or after a pause or resume elsewhere. If the
  // member is on anyway, the Undo's end state already holds: nothing to report.
  else if (q.error === 'invalid') error = view.status === 'paused' ? 'undo_gone' : null;
  else if (q.error) error = 'failed';

  // Paused now (by this link a moment ago, or before), and no duration picked in the URL: say until when.
  if (view.status === 'paused' && !q.until) {
    return { kind: 'paused', phrase: pausedPhrase(view.paused_until, q.done), canUndo: view.can_undo, focus: Boolean(q.done) && q.done !== 'undo', error };
  }
  return { kind: 'confirm', choice, error, undone: q.done === 'undo' && view.status !== 'paused' };
}
