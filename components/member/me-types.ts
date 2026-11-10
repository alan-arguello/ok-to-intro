/**
 * What the /me server component hands its client view. Pure types: safe on both sides of the boundary.
 * `mode: 'sample'` is the QA-only preview (example numbers, the sample member Priya Shah, actions simulated in the tab);
 * `mode: 'real'` is the signed-in member's own data, and every action is a server action.
 */

import type { QaState } from '@/lib/qa';
import type { AskerOutcome, MemberStatus } from '@/lib/types';
import type { LedgerCounts } from './copy';

/** A time the server formatted in Pacific time (`label`), re-formatted in the viewer's zone after hydration when `iso` is set. */
export interface TimeLabel {
  iso: string | null;
  label: string;
  /** clock “21:04” · day “Nov 9” · last “21:04” today, else “Nov 8, 21:04”. */
  fmt: 'clock' | 'day' | 'last';
}

export interface MeProfile {
  name: string;
  one_line: string;
  company: string;
  stage: string;
  city: string;
  scheduling_url: string;
  cap: number;
  show_matched: boolean;
}

export interface MeLedger extends LedgerCounts {
  /**
   * The tally of each rules line the server counted against (“1 let in · 1 question”), keyed by the line's text so a
   * view of edited rules can still place them; null when nothing reached the gate this month (plain read view).
   */
  lines: { text: string; tally: string }[] | null;
  /** The member's own words that gates quoted this month; the view marks them with findClause on the shown rules. */
  quotes: string[];
  /** The member's own words for the “Asker sees: Matched: …” preview, or null (the first line is used). */
  example: string | null;
}

export type MeAsks =
  | { state: 'ok'; items: { id: string; subject: string; outcome: AskerOutcome; created: TimeLabel; href: string }[]; example: boolean }
  | { state: 'down' }
  | { state: 'off' };

export type MeToken =
  | { state: 'off' }
  | { state: 'none' }
  | { state: 'active'; created: TimeLabel; lastUsed: TimeLabel | null }
  | { state: 'new'; token: string; created: TimeLabel }
  | { state: 'revoked' };

export interface MeInitial {
  mode: 'real' | 'sample';
  qaState: QaState<'me'> | null;
  /** Server time when the page rendered (ms): pause chip labels and hours left. */
  now: number;
  status: MemberStatus;
  pausedUntil: string | null;
  profile: MeProfile;
  rules: string;
  /** 0 = no rules saved yet. */
  rulesVersion: number;
  saved: TimeLabel | null;
  /** The first-visit block's source label: “From the playground”, “Sales operator preset”, or null. */
  rulesSourceLabel: string | null;
  capUsed: number;
  /** Cap month, YYYY-MM-01 (Pacific time). */
  month: string;
  ledger: MeLedger | null;
  pending: { title: string; from: string; hoursLeft: number; href: string } | null;
  asks: MeAsks;
  token: MeToken;
  /** ?first=1 (after sign-in) and ?carried=1 (rules from the playground to review). */
  first: boolean;
  carried: boolean;
  exportHref: string | null;
}
