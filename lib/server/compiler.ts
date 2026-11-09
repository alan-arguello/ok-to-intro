import 'server-only';
import type { CompileEvent, CompileRequest, LiveState } from '@/lib/types';

/**
 * Owner: BE1. The 5-part compiler (claude-sonnet-5-5, effort low): marks each part found (the founder's own
 * words, verified as a span of their text), suggested (only `needs`, citing its source spans) or missing (a
 * question, never an invented fact); refuses vague asks and anything about YC applications; writes a subject of
 * at most 45 characters and a coarse topic for the board's unanswered-demand view.
 *
 * STUB (foundation): signature final. Until BE1 replaces the body, compiling is unavailable (the UI shows the
 * manual 5-field form: ux-spec S2 “Compiler slow … or if the compiler is down”).
 */

export type CompileRefusal =
  | { error: 'invalid_text'; message: string }
  | { error: 'rate_limited'; retry_at: string }
  | { error: 'live_unavailable'; live: LiveState; until: string | null };

export type CompileStart = { ok: true; events: AsyncIterable<CompileEvent> } | { ok: false; status: 400 | 429 | 503; body: CompileRefusal };

/**
 * Starts a compile stream (plan → part × 5 → done, or refused, or error). Used by POST /api/compile and the
 * MCP tool draft_ask. Checks input (1..600 characters), the rate limit and live availability first.
 */
export async function startCompile(input: CompileRequest, context: { clientKey: string | null; signal?: AbortSignal }): Promise<CompileStart> {
  void input;
  void context;
  return { ok: false, status: 503, body: { error: 'live_unavailable', live: 'off', until: null } };
}
