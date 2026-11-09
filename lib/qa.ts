/**
 * QA states: `?state=<name>` renders a designed state directly, `?degraded=<kind>` shows a degraded banner.
 * Both are honoured only when QA is enabled: any non-production build, or `QA_STATES=1` in production
 * (so the integrator can audit every state on a deployed preview). State names match the prototype's.
 *
 * Static pages must not read searchParams on the server (it makes them dynamic). Resolve `qaEnabled()` in a
 * server component, pass it down as a prop, and resolve the state on the client with `resolveQaState`.
 */

import type { BannerKind } from '@/lib/types';

export const QA_STATES = {
  playground: [
    'not-run', 'running', 'done-recorded', 'done-live', 'rerun-changed', 'rerun-nochange', 'stale', 'cap-changed',
    'partial-timeout', 'clause-check', 'marks', 'empty-rules', 'too-long', 'all-declined', 'all-accepted',
    'rate-limited', 'api-down', 'budget', 'lost-stream', 'offline',
  ],
  ask: ['empty', 'filled', 'compiling', 'compiled', 'ready', 'refused-vague', 'refused-yc', 'compiler-slow', 'compiler-down', 'queued', 'real-guest'],
  askStatus: [
    'offered', 'streaming', 'offered-you', 'ask-back', 'answered', 'intro', 'moved-on', 'no-match', 'closed-all-passed',
    'expired-deadline', 'failed-closed', 'partial-failure', 'withdrawn', 'real',
  ],
  board: ['default', 'launch-day', 'small-n', 'stale'],
  offer: [
    'open', 'confirm-ok', 'answer', 'ok-sent', 'answer-sent', 'no-done', 'no-reason-diff', 'no-reason-busy', 'diff-applied',
    'already-acted', 'expired', 'withdrawn', 'paused-member', 'invalid', 'post-failed', 'sample',
  ],
  checkin: ['d1-preselected', 'd1-saved', 'd1-notyet', 'd1-wont', 'member-d1', 'd14-preselected', 'd14-saved', 'already-answered', 'closed', 'invalid', 'save-failed'],
  join: ['email', 'email-carried', 'email-invalid', 'code', 'code-wrong', 'code-expired', 'code-limited', 'code-delayed', 'resend-ready'],
  me: ['on', 'first', 'offer-pending', 'paused', 'dirty', 'saved', 'save-failed', 'token-created', 'token-revoked', 'delete-confirm', 'deleted', 'empty-ledger', 'signed-out'],
  pause: ['confirm', 'paused', 'post-failed'],
  agents: ['default'],
  how: ['default'],
  privacy: ['default'],
  notFound: ['default'],
  error: ['default'],
} as const;

export type QaPage = keyof typeof QA_STATES;
export type QaState<P extends QaPage> = (typeof QA_STATES)[P][number];

/** `?degraded=` values (the prototype's five plus `off`, an instance without a model key). */
export const DEGRADED_KINDS: readonly BannerKind[] = ['slow', 'down', 'budget', 'limited', 'offline', 'off'];

/**
 * True when QA states are honoured. Authoritative on the server (reads QA_STATES at runtime or build time).
 * On the client only NODE_ENV is known, so client code must receive this as a prop from a server component.
 */
export function qaEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.QA_STATES === '1';
}

/** The QA state for `page` from a raw `?state=` value, or null (QA off, missing, or not a known state). */
export function resolveQaState<P extends QaPage>(page: P, raw: string | string[] | null | undefined, enabled: boolean): QaState<P> | null {
  if (!enabled) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return (QA_STATES[page] as readonly string[]).includes(value) ? (value as QaState<P>) : null;
}

/** The degraded banner kind from a raw `?degraded=` value, or null (QA off, missing, unknown). */
export function resolveDegraded(raw: string | string[] | null | undefined, enabled: boolean): BannerKind | null {
  if (!enabled) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && (DEGRADED_KINDS as readonly string[]).includes(value) ? (value as BannerKind) : null;
}

/** Server helper for dynamic pages: `qaState('offer', (await searchParams).state)`. */
export function qaState<P extends QaPage>(page: P, raw: string | string[] | null | undefined): QaState<P> | null {
  return resolveQaState(page, raw, qaEnabled());
}
