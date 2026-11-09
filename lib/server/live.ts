import 'server-only';
import { hasAnthropic } from '@/lib/env';
import type { LiveState } from '@/lib/types';

/**
 * Owner: BE1. Whether live model calls can run right now (ux-spec §8 “Degraded modes”):
 * off (no key on this instance) · budget (Anthropic spend limit or the app's daily cap; never retried until the
 * pause ends) · down (5 consecutive failures or 529s) · slow (p95 of the last 50 gate calls over 6 s, or 429 share
 * over 20%) · ok. Computed from live traffic, no cron canary.
 *
 * STUB (foundation): signatures are final. Until BE1 replaces the bodies it reports configuration only.
 */

export interface LiveSnapshot {
  state: LiveState;
  /** When a budget pause ends (ISO), else null. */
  paused_until: string | null;
}

/** The current live state. Never throws. */
export async function getLiveState(): Promise<LiveSnapshot> {
  return { state: hasAnthropic ? 'ok' : 'off', paused_until: null };
}

/** True when live calls may start (state ok or slow). */
export function canRunLive(snapshot: LiveSnapshot): boolean {
  return snapshot.state === 'ok' || snapshot.state === 'slow';
}
