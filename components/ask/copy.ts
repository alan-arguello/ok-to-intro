/**
 * S2 copy (/ask and /ask/[id]), verbatim from ux-spec S2 and prototype/a.js unless a comment says why it differs.
 * Strings two surfaces share live in lib/oti/copy.ts; these are S2's own. Pure; safe in client and server code.
 */

import type { LiveState, PartKey } from '@/lib/types';
import { fmtN, plural } from '@/lib/oti/text';

export const ASK_TITLE = 'Ask the network';
export const ASK_LEDE = 'You’re a founder who needs help. Write your ask; see how it’s checked and who would get it.';
export const ASK_DESCRIPTION = 'Write one specific ask, check it for its 5 parts, see what a member would get, then send it to the sample network.';
export const STATUS_DESCRIPTION = 'Where your ask stands: who it was offered to, the 40-member fan-out, any question for you and the raw trace.';
/** The home page (`/`): the same composer, ask-first (Alan, Nov 9: “the main window should be like ChatGPT”). */
export const HOME_TITLE = 'What do you need from the network?';
export const HOME_LEDE = ASK_LEDE;
export const HOME_DESCRIPTION =
  'Write one specific ask for a 20-minute call. It is checked for 5 parts, then against each member’s own rules; at most one person sees it at a time.';
/** The second card under the composer: the member's side, on /rules. */
export const OTHER_SIDE_LINK = 'On the other side? See what would reach you →';
export const OTHER_SIDE_NOTE = 'Write what you’d agree to help with; 12 asks from other founders are checked against it.';
export const COMPOSER_LABEL = 'What do you need?';
export const ASK_PLACEHOLDER = 'We sell X to Y. We tried Z. Need 20 minutes with someone who has done W, before [date]. In return: …';

/** The 5 parts: row labels and the question a missing part asks (prototype LBL / QUESTION). */
export const PART_LABEL: Record<PartKey, string> = {
  challenge: 'Challenge',
  tried: 'What you tried',
  needs: 'Who you need',
  by: 'Deadline',
  offers: 'Offer back',
};
export const PART_QUESTION: Record<PartKey, string> = {
  challenge: 'What’s blocked, in one line?',
  tried: 'What have you tried so far?',
  needs: 'Who could unblock it?',
  by: 'By when do you need this?',
  offers: 'What can you give the person in return?',
};
/** “Your ask” on the status page labels the parts as facts (prototype paintFacts). */
export const FACT_LABEL: Record<PartKey, string> = { challenge: 'Challenge', tried: 'Tried', needs: 'Needs', by: 'By', offers: 'Offers' };

/** Honesty labels for compile results that no compiler produced (docs/CONTRACT.md §14). */
export const EXAMPLE_PARTS_LABEL = 'Example parts, written by hand · not a compiler run';

export const REFUSAL = {
  vague: { title: 'Too vague to send.', body: 'It doesn’t say what’s blocked or who could unblock it. Add one line on each; the rest can be drafted.' },
  yc_application: { title: 'Asks about YC applications aren’t sent.', body: 'Members agreed to be asked about their work, not about applications.' },
} as const;

export const COMPILE_SLOW = 'Still checking. A check usually takes 3 s.';
/** The compiler stopped or never answered: the 5 rows become inputs. `off` is this build's copy for an instance without a model key. */
export function compilerDownCopy(kind: 'down' | 'budget' | 'off', until: string | null): string {
  if (kind === 'budget') return `The compiler is paused until ${until ?? 'next month'}: this demo reached its model budget. Fill the 5 parts yourself; your text is kept.`;
  if (kind === 'off') return 'The compiler is off on this instance: no model API key is set. Fill the 5 parts yourself; your text is kept.';
  return 'The compiler isn’t answering. Fill the 5 parts yourself; your text is kept.';
}
export function compileLimitedCopy(time: string): string {
  return `You checked 20 asks in 10 minutes. The next check is at ${time}. Your text is kept.`;
}
export const COMPILE_OFFLINE = 'You’re offline. Your text is saved in this tab.';
export const COMPILE_FAILED = 'The check didn’t go through. Your text is kept; try again.';
export const QUEUED_COPY = 'You have 3 open asks. This one sends when one of them closes.';

export const ACTIONS_READY = 'At most 1 person sees it at a time. You learn who only if they say OK.';
export const ACTIONS_STALE = 'Check again before sending.';
export const ACTIONS_OFFLINE = 'You’re offline. Send waits for a connection.';
export const ACTIONS_NO_SUBJECT = 'Write the subject members see before sending.';
export function partsLeftCopy(n: number): string {
  return n === 1 ? '1 part left to resolve.' : `${n} parts left to resolve.`;
}
export function barPartsLeft(n: number): string {
  return n === 1 ? '1 part left ›' : `${n} parts left ›`;
}

/**
 * A SAMPLE send of the founder's own text runs all 40 gates live, so it can't go out while live checks are
 * unavailable (docs/CONTRACT.md §14: “custom text on SAMPLE is refused with the live-off copy”). Shown before the
 * click instead of after it. REAL needs live gates too.
 */
export function liveBlockedCopy(state: LiveState, network: 'sample' | 'real', until: string | null): string {
  const why =
    state === 'off'
      ? 'Live checks are off on this instance (no model API key is set)'
      : state === 'budget'
        ? `Live checks are paused until ${until ?? 'next month'}: this demo reached its model budget`
        : 'Live checks are paused: the model API isn’t answering';
  return network === 'real'
    ? `${why}, so the real network can’t check asks right now. Nothing was sent to anyone.`
    : `${why}, so only the 3 sample asks can go to the sample network. Try one above; your text is kept.`;
}

export const SEND_LABEL = 'Send to 40 sample members';

/* ---------- status page ---------- */

/** “‹ New ask” opens an empty compose (the draft kept in this tab is for coming back to an ask, not a new one). */
export const NEW_ASK_HREF = '/ask?new=1';

export const ST_COPY = {
  newAsk: '‹ New ask',
  yourAsks: '‹ Your asks',
  fanout: 'Fan-out',
  interrupted: 'People interrupted:',
  revealLabel: 'Show what askers never see (sample only)',
  revealNote: 'On the real network, askers see only: offered, next in line, question for you, not this time.',
  sideAsker: 'What you sent',
  sideMember: 'What the member sees',
  sideChange: 'What would change it',
  sideCaption: 'Askers never see this card. It is shown here because this is a sample.',
  askerFine: 'This is the card the member gets. You learn who it is only if they say OK. A No stays private.',
  matchedMembers: 'Matched a member’s rules.',
  open: 'Open it as the member',
  openPhone: 'Open it as the member (sample) ›',
  yourAsk: 'Your ask',
  withdraw: 'Withdraw',
  withdrawConfirm: 'Withdraw this ask? The person who has it will be told it’s no longer needed.',
  keep: 'Keep it',
  changeHelp: 'Only true information you add yourself. Nothing is sent until you check and send again.',
  useEdit: 'Use this edit',
  editResend: 'Edit and resend',
  resendWeek: 'You can resend once a week.',
  answerHelp72: 'If there is no choice within 72 h, the ask closes; nobody else is asked.',
  solved: 'Yes, close my ask',
  keepOpen: 'No, keep it open',
  sendAnswer: 'Send answer',
  answerLabel: 'Your answer',
  answerIt: 'Answer it',
  useSampleAnswer: 'Use sample answer',
  sampleAnswerHelp: 'Suggested from the sample ask (sample answer).',
  introEmail: 'See the intro email (sample) ›',
  checkin: 'See tomorrow’s check-in (sample) ›',
  noRules: 'Your rules aren’t in this network yet.',
  noRulesLink: 'Write them on the playground',
  noRulesTail: 'to be one of the 40.',
} as const;

export function offeredCopy(replyBy: string): string {
  return `Waiting on 1 person whose rules accept asks like this. They have until ${replyBy} to reply. If they don’t say OK by then, the next person in line gets it. You learn who it is only if they say OK.`;
}
export const OFFERED_YOU_COPY =
  'Your own gate accepted, and you have the most unused cap, so the offer went to you (sample). You’re playing both sides here: the asker (a sample founder) and a member (your rules).';
export function movedOnCopy(position: number, inLine: number, replyBy: string): string {
  return `Offered to the next person in line (${position} of ${inLine}). They have until ${replyBy}.`;
}
export function streamingCopy(answered: number | null, total: number): string {
  return answered === null ? 'Checking members’ gates…' : `Checking members’ gates… ${fmtN(answered)} of ${fmtN(total)} answered.`;
}
/** Nothing offered yet and a gate's question waits (the question card leads the page; this card says where it stands). */
export const QUESTION_OUTCOME_LABEL = 'Not offered yet';
export const QUESTION_OUTCOME_COPY = 'Nobody has been offered it yet: no member’s rules accepted it as written, and a gate has one question first. Your answer reruns only the gates that asked.';
export const NO_MATCH_COPY = 'No member’s rules accepted this ask. 0 people interrupted.';
export function allPassedCopy(offered: number): string {
  return `No one in line said OK within their reply windows. ${plural(offered, 'person was', 'people were')} offered it.`;
}
export function deadlineCopy(by: string, offered: number): string {
  return `Your deadline (${by}) passed, so the ask closed. ${plural(offered, 'person was', 'people were')} offered it.`;
}
export const SOLVED_COPY = 'You closed this ask. Their answer solved it, and nobody else will be asked.';
export const ANSWER_TIMEOUT_COPY = 'No choice came within 72 h of their answer, so the ask closed. Nobody else was asked.';
export const ASKER_CLOSED_COPY = 'You closed this ask. Nobody else will be asked.';
export function withdrawnCopy(day: string, sample: boolean): string {
  // SAMPLE adds the same “(sample, no email was sent)” the intro state carries: nobody is emailed on SAMPLE.
  return `You withdrew this ask on ${day}. The person who had it was told it’s no longer needed${sample ? ' (sample, no email was sent)' : ''}.`;
}
export function answeredCopy(text: string): string {
  return `A member answered without sharing their name: “${text}” Did that solve it?`;
}
export function failedClosedCopy(failed: number | null, ran: number | null): string {
  if (failed === null) return 'Too many gates failed, so nothing was offered. Your ask is saved.';
  const n = ran !== null ? `${fmtN(failed)} of ${fmtN(ran)} gates` : plural(failed, 'gate');
  return `${n} failed, so nothing was offered. Your ask is saved.`;
}
export function partialFailureCopy(failed: number, ran: number | null): string {
  const count = failed === 1 ? 'counts' : 'count';
  if (ran !== null) return `${fmtN(ran - failed)} of ${fmtN(ran)} gates answered. ${fmtN(failed)} failed and ${count} as not checked, never as an accept.`;
  return `${plural(failed, 'gate')} failed and ${count} as not checked, never as an accept.`;
}
export function questionCardCopy(text: string, gates: number): string {
  return `A member’s gate has one question before deciding: “${text}” ${
    gates === 1 ? 'Your answer goes only to the gate that asked, and it reruns once.' : `Your answer goes only to the gates that asked (${fmtN(gates)}), and each reruns once.`
  }`;
}
export function questionLine(text: string, gates: number): string {
  return gates === 1 ? `1 question for you: “${text}”` : `${fmtN(gates)} gates asked: “${text}”`;
}
/** After the asker's answer reran the gates that asked (ux-spec S2 “Question card”). */
export function rerunCopy(reran: number, accepted: number, offerMade: boolean): string {
  const ran = reran === 1 ? 'That answer reran the gate that asked.' : `That answer reran the ${fmtN(reran)} gates that asked.`;
  let result: string;
  if (accepted === 0) result = reran === 1 ? 'It didn’t accept, so nothing changed.' : 'None accepted, so nothing changed.';
  else if (offerMade) result = accepted === 1 ? 'It accepted and has the offer: 1 person interrupted.' : `${fmtN(accepted)} accepted; the best one has the offer: 1 person interrupted.`;
  else if (accepted === reran) result = reran === 1 ? 'It accepted; it’s next in line. Nobody new was interrupted.' : `${reran === 2 ? 'Both' : `All ${fmtN(reran)}`} accepted; they’re next in line. Nobody new was interrupted.`;
  else result = `${fmtN(accepted)} accepted; ${accepted === 1 ? 'it’s' : 'they’re'} next in line. Nobody new was interrupted.`;
  return `${ran} ${result}`;
}

/** The one live-region line when a fan-out finishes on the page (SAMPLE outcome names; REAL maps onto them). */
export function fanoutDoneAnnouncement(outcome: string): string | null {
  switch (outcome) {
    case 'offered':
      return 'Offered to 1 person. 1 person interrupted.';
    case 'offered-you':
      return 'The offer went to you (sample). 1 person interrupted.';
    case 'question':
      return 'Nobody has been offered it yet. A gate has a question for you.';
    case 'no-match':
      return 'No match. 0 people interrupted.';
    case 'failed-closed':
      return 'Nothing was sent to anyone. Too many gates failed, so nothing was offered.';
    case 'refused':
    case 'lost':
    case 'offline':
      return 'Nothing was sent to anyone.';
    default:
      return null;
  }
}

/** The status page when a SAMPLE id has nothing in this tab (sessionStorage is per tab; nothing is stored). */
export const NOT_IN_TAB_SAMPLE = 'This sample ask hasn’t been sent from this tab. Sample asks live only in the tab that sends them; nothing is stored on a server.';
export const NOT_IN_TAB_CUSTOM = 'This sample ask isn’t in this tab. Sample asks live only in the tab that sent them; nothing is stored on a server.';
export const WRITE_AN_ASK = 'Write an ask';
export const SEND_FAILED_TITLE = 'Nothing was sent to anyone.';
/** Server refusals already say “Nothing was sent to anyone.”; the notice prints it once, as its title. */
export function withoutNothingSent(message: string): string {
  return message.replace(/\s*Nothing was sent to anyone\.\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
export const LOST_STREAM = 'The connection dropped before the fan-out finished. Your ask is kept in this tab.';
export const OFFLINE_SEND = 'You’re offline. Your ask is kept in this tab; it sends when you try again online.';
export const ANSWER_FAILED = 'Didn’t go through. Your answer is kept; try again.';
export const ACTION_FAILED = 'Didn’t go through. Check your connection and try again; nothing happens twice.';

/** REAL sends that didn't go out, and a page that lost track of an ask that did. */
export const REAL_SEND_OFFLINE = 'You’re offline. Your ask is saved; it sends when you try again online.';
export const REAL_SEND_REFUSED = 'The real network didn’t take this ask. Your ask is saved.';
export const REAL_VIEW_LOST = 'Couldn’t read where your ask stands. It is saved, and its fan-out finishes without this page.';

/** REAL states without data. */
export const REAL_SIGN_IN = 'Sign in to see this ask.';
export const REAL_DB_DOWN = 'Something broke on our side. Nothing was sent to anyone.';
export const REAL_UNKNOWN_ERROR = 'Something broke on our side, so this ask didn’t load. Nothing was sent to anyone.';

/** QA example notes (example data next to a dashed note, docs/CONTRACT.md §e.4). */
export const EXAMPLE_REAL_NOTE = 'Example REAL ask for layout (QA state). A real ask reads from the database.';

