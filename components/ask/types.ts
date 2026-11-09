/**
 * Props the S2 server pages pass to their client islands (plain data: no server-only imports here).
 */

import type { AskEditSuggestion, LiveState } from '@/lib/types';

/** Whether this visitor can ask the REAL network, resolved on the server (getUser → canAskReal → getMemberProfile). */
export type RealAccess =
  | { kind: 'allowed'; profile: AskerProfileView; example?: boolean }
  | { kind: 'signed_out'; mode: 'open' | 'allowlist' }
  | { kind: 'not_invited' }
  | { kind: 'profile_incomplete' }
  | { kind: 'not_configured' }
  | { kind: 'db_down' };

export interface AskerProfileView {
  name: string;
  first: string;
  company: string;
  stage: string;
  city: string;
}

/** BE1's live state when the page rendered: whether model calls (compiler, gates) can run. */
export interface LiveInfo {
  state: LiveState;
  /** Budget pauses: when live checks resume, as a short day label (“Dec 1”), else null. */
  until: string | null;
}

/** `/ask?resend=<a_id>`: the asker's own earlier REAL ask, loaded on the server. */
export interface ResendSeed {
  id: string;
  text: string;
  suggestion: AskEditSuggestion | null;
}

export function liveCanRun(live: LiveInfo): boolean {
  return live.state === 'ok' || live.state === 'slow';
}
