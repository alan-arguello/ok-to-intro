/**
 * Copy that more than one surface prints, verbatim from ux-spec.md (curly quotes and apostrophes).
 * Surface-specific copy stays with its owner; this file holds only strings two or more owners must agree on.
 */

import type { BannerKind, GateErrorKind, LiveState } from '@/lib/types';

/** Banner copy (ux-spec §8 “Degraded modes”). `off` is this build's honest copy for an instance without a model key. */
export const BANNER_COPY: Record<BannerKind, { tone: 'warn' | 'plain'; text: string }> = {
  slow: { tone: 'warn', text: 'The model API is slow right now. Live checks can take up to 12 s; recorded runs still load at once.' },
  down: { tone: 'warn', text: 'Live checks are paused: the model API isn’t answering. Presets show their recorded run. Nothing you type is lost.' },
  budget: {
    tone: 'warn',
    text: 'Live checks are paused until {date}: this demo reached its model budget. Presets show their recorded run. Nothing you typed was sent.',
  },
  off: { tone: 'plain', text: 'Live checks are off on this instance: no model API key is set. Presets show their example verdicts.' },
  limited: { tone: 'warn', text: 'You ran 20 live checks in 10 minutes. The next live run is at {time}. Presets are unlimited.' },
  offline: { tone: 'plain', text: 'You’re offline. What you typed is saved in this tab.' },
};

/** Fills `{date}` / `{time}` placeholders. */
export function fillCopy(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
}

/** Which banner a live state shows (ok shows none). */
export function bannerForLive(live: LiveState): BannerKind | null {
  return live === 'ok' ? null : live;
}

/** The line every failure that could interrupt someone carries (ux-spec §1 decision 10). */
export const NOTHING_SENT = 'Nothing was sent to anyone.';

/** Row copy for gate failures (ux-spec S1 states and §8). */
export const GATE_FAILURE_COPY: Record<GateErrorKind, string> = {
  timeout: 'No answer in 6 s. A failed gate never counts as an accept.',
  rate_limited: 'The model API rate-limited this check. A failed gate never counts as an accept.',
  overloaded: 'The model API was overloaded. A failed gate never counts as an accept.',
  budget: 'Live checks are paused: this demo reached its model budget. A failed gate never counts as an accept.',
  refused: 'The model refused to evaluate this ask.',
  parse: 'The gate’s answer didn’t parse, so code declined it.',
};

/** The injection trap's reason line when the gate resisted (ux-spec S1, row a11). */
export const INJECTION_RESISTED = 'The ask told the gate what to answer; it was read as text, not followed.';
export const INVESTOR_FLAG = 'It reads as an investor asking for deal flow, not a founder asking for help.';
export const NO_LINE_COVERS = 'No line in your rules covers this ask.';

/** Privacy notes repeated across /me, /privacy and the playground help. */
export const RULES_TO_ANTHROPIC =
  'Your rules go to Anthropic’s API for each check, and Anthropic keeps API data for up to 30 days. Alan, who runs this instance, has database access. The public board shows counts, never names.';
export const PLAYGROUND_RULES_HELP = 'Each run sends your rules to Anthropic’s API. Nothing is stored unless you join.';

/** Labels for recorded data, by source (docs/CONTRACT.md §e). */
export const AUTHORED_LABEL = 'Example verdicts, written by hand · not a model run';
/** S2 SAMPLE fan-out and the send_ask SAMPLE receipt when sample-network.json is `source: "authored"`. */
export const AUTHORED_FANOUT_LABEL = 'Example results for 39 sample members, written by hand · not a model run';
/**
 * Under the No-reason diff on a REAL /o page (and the MCP `respond` suggestion): the edit is templated by code and
 * was not run against the sample asks, so no “Tested on …” line. SAMPLE uses OFFER_SAMPLE.suggested_edits.*.expected.
 */
export const SUGGESTED_EDIT_UNTESTED = 'Templated by code from your reason. Not run against the sample asks.';

/**
 * Who may ask the REAL network (S2 compose, POST /api/asks). `open` mode (REAL_ASKERS unset or `*`) and
 * `allowlist` mode differ only for signed-out visitors and people not on the list.
 */
export const REAL_ASK_COPY = {
  signedOutOpen: 'Sign in to ask the real network.',
  signedOutAllowlist: 'The real network is open to invited founders while it’s small. Sign in if you were invited.',
  notInvited: 'The real network is open to invited founders while it’s small. Your email isn’t on the list yet.',
  profileIncomplete: 'Add your name and company under Your gate before asking the real network.',
  notConfigured: 'The real network isn’t set up on this instance.',
} as const;
export const SAMPLE_NOTE = 'All 12 asks and companies are fictional (SAMPLE).';
export const PROTOTYPE_NUMBERS_NOTE = 'Prototype: example numbers for layout. The live board reads from the database.';

/** The S1 REAL line when the real network isn't connected on this instance (getRealLine() returned null). */
export const REAL_LINE_OFF = 'The real network isn’t connected on this instance yet.';

/** The OTP sign-in limits (ux-spec S3). */
export const OTP_RESEND_SECONDS = 60;
export const OTP_LENGTH = 6;
