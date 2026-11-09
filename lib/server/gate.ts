import 'server-only';
import type { AskParts, GateDecision, GateFailureKind, LiveState, QuestionType, TryEvent, TryRequest } from '@/lib/types';

/**
 * Owner: BE1. The gate: one member's rules × one ask → accept | decline | ask_back with cited quotes, then the
 * code checks (lib/oti/clause.ts `checkQuotes`; a quote not found turns the verdict into a decline with
 * decided_by 'clause_check'; ask_back questions outside the 8 types, over 100 characters or with URLs, paths or
 * emails become declines). claude-haiku-5-5, structured output (one frozen all-required schema), thinking off,
 * effort low, the rubric cached ahead of the member's rules, the ask as quoted data, 6 s timeout, SDK maxRetries 1.
 *
 * STUB (foundation): signatures are final and documented in docs/CONTRACT.md. Until BE1 replaces the bodies,
 * every call reports `unavailable` — never a verdict.
 */

export interface GateInput {
  /** The member's rules, exactly the version recorded with the decision. */
  rules: string;
  /** The ask as members see it; quoted to the model as data after the rules, never as instructions. */
  ask: { text: string; subject?: string; parts?: AskParts; asker_stage?: string };
  /** The one rerun after a question: the asker's approved answers. */
  answers?: { type: QuestionType; text: string }[];
}

export interface GateUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type GateResult =
  | { ok: true; decision: GateDecision; ms: number; model: string; request_id: string | null; cost_usd: number | null; usage: GateUsage | null }
  | {
      ok: false;
      kind: GateFailureKind;
      ms: number;
      retry_after_s?: number;
      request_id?: string | null;
      /** refused / parse only: the decline by code that replaces the missing verdict. */
      decision?: GateDecision;
    };

/**
 * Runs one gate. Never throws; never returns an accept it can't back with found quotes.
 * A timeout, rate limit, overload or budget stop is `{ok:false}` (the caller shows NOT CHECKED).
 */
export async function runGate(input: GateInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<GateResult> {
  void input;
  void options;
  return { ok: false, kind: 'unavailable', ms: 0 };
}

/** Why a live run can't start (JSON body of the 400 / 429 / 503 that /api/try returns before streaming). */
export type TryRefusal =
  | { error: 'invalid_rules'; message: string }
  | { error: 'rate_limited'; retry_at: string }
  | { error: 'live_unavailable'; live: LiveState; until: string | null };

export type TryStart = { ok: true; events: AsyncIterable<TryEvent> } | { ok: false; status: 400 | 429 | 503; body: TryRefusal };

/**
 * Starts a live playground run over the 12 SAMPLE asks (all, or `ask_ids` to retry missing rows), checking
 * input, the rate limit (`clientKey`) and live availability first. The events follow ux-spec §8: one `plan`,
 * one `gate` or `error` per ask (in completion order, each resolving its row by `i`), then `done`.
 * Rules are never stored or logged. Used by POST /api/try and the MCP tool try_rules.
 */
export async function startTry(input: TryRequest, context: { clientKey: string | null; signal?: AbortSignal }): Promise<TryStart> {
  void input;
  void context;
  return { ok: false, status: 503, body: { error: 'live_unavailable', live: 'off', until: null } };
}

/**
 * One real gate call on a fixed SAMPLE pair, to compile and cache the structured-output grammar after a deploy
 * and twice a day (tech.md: compiled grammars expire after 24 h unused). Used by /api/cron/warm (BE2's route).
 * Never throws; `ok: false` when live calls are unavailable.
 */
export async function warmGate(): Promise<{ ok: boolean; ms: number; kind?: GateFailureKind }> {
  return { ok: false, ms: 0, kind: 'unavailable' };
}
