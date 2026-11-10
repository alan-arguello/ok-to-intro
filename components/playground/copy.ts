/**
 * S1 playground copy, verbatim from prototype/index.html and a.js unless a comment says why it differs.
 * Strings two owners print live in lib/oti/copy.ts; these are the playground's own.
 */

export const H1 = 'What would you agree to be asked?';
export const LEDE =
  'Founders in a network ask for 20-minute calls. Write what you’d agree to be asked and a monthly cap; a small model checks each ask against your words and must quote the line it used.';

export const RUN_FIRST = 'Run 12 sample asks';
export const RUN_AGAIN = 'Run again';
export const KEEP = 'Keep these rules';
export const OFFER_LINK = 'See a sample offer as a member would ›';
export const ASK_LINK = 'Send a sample ask (your gate is 1 of 40) ›';
export const RUN_LIVE = 'Run live';
export const RAW_TRACE = 'Raw trace';

export const LIST_IDLE = (traps: number) => `12 sample asks, as they would arrive in one month · ${traps} are traps`;

export const HELP_EMPTY = 'Write at least one line, or pick a preset.';
export const HELP_OVER = 'Keep it under 1,000 characters. Gates read every word on every ask.';
export const READ_HINT = 'Highlighted words are the ones the gates quoted. Press Enter to edit your rules.';
export const STALE_NOTE = 'Rules changed. Run again to update the 12 verdicts.';
/**
 * The prototype says “Enforced in Postgres after the gate.” Here the cap is applied in the browser (applyCap), and
 * Postgres enforces it only on real offers, so the line says so (docs/CONTRACT.md §e.9).
 */
export const CAP_HELP = 'Postgres enforces it on real offers. Changing it here needs no model call.';

export const AGREE_EMPTY = 'Disagree with a verdict? Mark it.';
export const agreeLine = (n: number) => `You’d decide ${n} of 12 differently. Your marks stay in this tab.`;
export const marksLine = (n: number) => `You’d decide ${n} of 12 differently.`;
export const bridgeHelp = (cap: number) =>
  `Join with your email; your rules and cap carry over. ${cap === 1 ? 'At most 1 ask a month reaches you.' : `At most ${cap} asks a month reach you.`}`;
export const capNote = (n: number) => `Cap changed to ${n}. Applied in code, no model call.`;
export const capUsed = (used: number, cap: number, done: boolean) => (done ? `${used} of ${cap} used in this sample month` : `0 of ${cap} used`);

export const ALL_DECLINED =
  'None of these 12 fit your rules. They cover Postgres at scale, LLM evals, job queues, hospital procurement, insurer pricing, a first hire outside the Bay Area and SOC 2.';
export const allAccepted = (cap: number) => `12 of 12 fit your rules. Your cap lets ${cap} through a month. Add a “No …” line?`;
export const TRY_ENGINEER = 'Try the Engineer preset';
export const WRITE_ASK = 'Write an ask your rules accept';

export const lostNote = (got: number, total: number) => `Lost the connection after ${got} of ${total}.`;
export const retryOther = (n: number) => `Retry the other ${n}`;

/** Why live checks can't run right now (ux-spec S1 states, §8 degraded modes). `off`: an instance without a model key. */
export type LiveBlock = 'off' | 'down' | 'budget' | 'limited' | 'offline';

export function liveBlockCopy(block: LiveBlock, v: { date: string; time: string }): string {
  switch (block) {
    case 'off':
      return 'Live checks are off on this instance: no model API key is set. Your rules stay in this tab.';
    case 'down':
      return 'Live checks are paused while the model API isn’t answering. Your rules stay in this tab.';
    case 'budget':
      return `Live checks are paused until ${v.date}. Your rules stay in this tab.`;
    case 'limited':
      return `You ran 20 live checks in 10 minutes. The next live run is at ${v.time}. Presets are unlimited.`;
    case 'offline':
      return 'You’re offline, so live checks can’t run. Your rules stay in this tab.';
  }
}

/**
 * The note next to Run on desktop: what Run does right now. `noun` follows the recorded file's source (“the example
 * verdicts” for hand-written data, “the recorded run” for a model recording).
 */
export function runNote(o: {
  edited: boolean;
  block: LiveBlock | null;
  slow: boolean;
  authored: boolean;
  recordedDate: string;
  values: { date: string; time: string };
}): string {
  const noun = o.authored ? 'the example verdicts' : 'the recorded run';
  if (o.block) {
    if (o.edited) {
      if (o.block === 'off') return 'Edited rules need a live check. Live checks are off on this instance.';
      if (o.block === 'limited') return `Edited rules need a live check. Your next live run is at ${o.values.time}.`;
      if (o.block === 'offline') return 'Edited rules need a live check, and you’re offline.';
      return 'Edited rules need a live check. Live checks are paused.';
    }
    if (o.block === 'off') return `Shows ${noun} at once. Live checks are off on this instance.`;
    if (o.block === 'limited') return `Shows ${noun} at once. Your next live run is at ${o.values.time}.`;
    if (o.block === 'offline') return `Shows ${noun}. Live checks need a connection.`;
    return o.authored ? 'Shows the example verdicts at once. Live checks are paused.' : `Shows the recorded run from ${o.recordedDate}. Live checks are paused.`;
  }
  if (o.slow) return 'Live checks: up to 12 s right now. Presets load at once.';
  if (o.edited) return 'Edited rules run live: about 2 s, one gate call per ask.';
  return `Shows ${noun} at once. Run live calls the model, about 2 s.`;
}

/** Start failures that aren't a degraded mode (the server refused or the request never reached it). */
export const START_FAILED_NETWORK = 'The live check couldn’t reach the server. Your rules stay in this tab.';
export const startFailedStatus = (status: number) => `The live check didn’t start (error ${status}). Your rules stay in this tab.`;
export const RULES_REJECTED = 'The server didn’t accept these rules. Keep them between 1 and 1,000 characters.';

export const QA_FIXTURE = 'QA fixture, not a model call';
export const MODEL_VARIANCE = 'Same rules, different verdict (model variance).';
export const BOARD_CLAUSE_LINK = 'Clause-check counts on the Board ›';
