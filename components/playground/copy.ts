/**
 * Copy for `/rules` (“Be asked”). Strings two owners print live in lib/oti/copy.ts; these are the page's own.
 * Short and plain on purpose (Alan, Nov 9): the page is two steps, your rules and what reaches you.
 */

export const H1 = 'What would you agree to help with?';
export const LEDE = 'You’re the one being asked. Write what you’d agree to help with; see which asks would reach you.';

export const STEP_RULES = '1. Your rules';
export const STEP_ASKS = '2. 12 asks from other founders';
export const RUN = 'See what reaches you';
export const BACK_TO_ASK = 'Need help yourself? Write an ask ›';

export const LIST_IDLE = 'Press “See what reaches you” to check these 12 against your rules.';
export const LIST_STALE = 'Your rules changed. Press “See what reaches you” to update.';

export const RULES_HELP = 'Plain sentences, one per line. A live check sends them to Anthropic’s API; they stay in this tab.';
export const HELP_EMPTY = 'Write at least one line, or pick an example.';
export const HELP_OVER = 'Keep it under 1,000 characters.';
export const capLabel = (n: number) => (n === 1 ? 'Up to 1 intro a month' : `Up to ${n} intros a month`);

export const lostNote = (got: number, total: number) => `Lost the connection after ${got} of ${total}.`;
export const retryOther = (n: number) => `Retry the other ${n}`;

/** Why live checks can't run right now. `off`: an instance without a model key. */
export type LiveBlock = 'off' | 'down' | 'budget' | 'limited' | 'offline';

export function liveBlockCopy(block: LiveBlock, v: { date: string; time: string }): string {
  switch (block) {
    case 'off':
      return 'Live checks are off here (no model key). The three examples still work.';
    case 'down':
      return 'The model isn’t answering right now. The three examples still work.';
    case 'budget':
      return `Live checks are paused until ${v.date}. The three examples still work.`;
    case 'limited':
      return `Too many live checks. Try again at ${v.time}. The three examples still work.`;
    case 'offline':
      return 'You’re offline. The three examples still work.';
  }
}

/** Start failures that aren't a degraded mode (the server refused or the request never reached it). */
export const START_FAILED_NETWORK = 'Couldn’t reach the server. Try again.';
export const startFailedStatus = (status: number) => `The check didn’t start (error ${status}). Try again.`;
export const RULES_REJECTED = 'Keep your rules between 1 and 1,000 characters.';

export const QA_FIXTURE = 'QA fixture, not a model call';
