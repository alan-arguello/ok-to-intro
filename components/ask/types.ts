/**
 * Props the S2 server pages pass to their client islands (plain data: no server-only imports here).
 */

import type { LiveState } from '@/lib/types';

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

export function liveCanRun(live: LiveInfo): boolean {
  return live.state === 'ok' || live.state === 'slow';
}
