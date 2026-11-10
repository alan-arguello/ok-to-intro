/**
 * Copy for the recipient pages (/o, /c and the SAMPLE email viewer), verbatim from ux-spec S4/S5 and the prototype
 * (offer.html, checkin.html, b.js). Strings two owners print live in lib/oti/copy.ts. Curly quotes and apostrophes.
 */

import { NOTHING_SENT } from '@/lib/oti/copy';

/** S4 [post-failed]: a POST that never reached us (offline, a dropped connection). */
export const POST_FAILED = 'Didn’t go through. Check your connection and tap again; nothing happens twice.';
/** A POST that reached us while the database was down (ux-spec §8: /o and /c show “Something broke on our side”). */
export const POST_BROKE = `Didn’t go through: something broke on our side. ${NOTHING_SENT} Tap again; nothing happens twice.`;
/** A follow-up after a No that didn't save on our side. */
export const FOLLOW_BROKE = 'Didn’t save: something broke on our side. Tap again; nothing happens twice.';
/** S5 [save-failed]. */
export const SAVE_FAILED = 'Didn’t save. Tap again; nothing is recorded twice.';
export const SAVE_BROKE = 'Didn’t save: something broke on our side. Tap again; nothing is recorded twice.';
/** A check-in POST without an answer that fits (no JS, or a hand-edited link). */
export const PICK_FIRST = 'Pick an answer, then save.';

export const BROKE_TITLE = 'Something broke on our side';
export const BROKE_BODY = NOTHING_SENT;

/**
 * Without a database on this instance an email link can't be looked up. That is a setup state, never described as
 * an outage or as a wrong link (CONTRACT §e.8): the page says so and offers the SAMPLE version, which works fully.
 */
export const OFFER_OFF_TITLE = 'Offers aren’t set up on this instance';
export const CHECKIN_OFF_TITLE = 'Check-ins aren’t set up on this instance';
export const UNCONFIGURED_BODY = `This instance has no database connected, so this link can’t be looked up. ${NOTHING_SENT}`;

/** The page titles (`<title>`) of the cardless views. */
export const OFFER_NOT_FOUND = 'Offer not found';
export const CHECKIN_NOT_FOUND = 'Check-in not found';

export const OFFER_INVALID_TITLE = 'This link doesn’t match an offer.';
export const CHECKIN_INVALID_TITLE = 'This link doesn’t match a check-in.';
export const INVALID_BODY = 'It may be mistyped or expired. This site is a demo, so no real offers exist.';

export const SAMPLE_OFFER_NOTE = 'Buttons show what happens; no email is sent.';
export const SAMPLE_CHECKIN_NOTE = 'Buttons show what happens; nothing is saved.';

export const ANSWER_LABEL = 'Your answer, in 2 lines';
export const ANSWER_HELP = 'Sent without your name. No intro, no meeting.';
export const ANSWER_TOO_LONG = 'Your answer needs 1 to 280 characters and at most 2 line breaks.';
export const TWO_BREAKS = 'Two line breaks at most.';

export const WHY_LABEL = 'Why? Optional. Only you see this.';
export const OTHER_HELP = 'Only you and Alan see this.';
export const VAGUE_THANKS = 'Thanks. This goes to the compiler, not to your rules.';
export const KEPT_RULES = 'Kept your rules as they are.';
export const CAP_LOWERED = 'Cap lowered to 1 a month.';
export const NOTE_SAVED = 'Saved.';
export const REASON_SAVED = 'Saved. Only you see this.';
export const NO_EDIT = 'Saved. There’s no rule line to suggest for this ask.';
/** The sample loop's cards aren't Priya's rules, so no hand-written diff applies. */
export const LOOP_EDIT_NOTE = 'On a real gate, this suggests one line to add to your rules, templated by code from your reason. Nothing changes unless you add it.';

export const SUGGESTED_CHANGE = 'Suggested change to your rules';
