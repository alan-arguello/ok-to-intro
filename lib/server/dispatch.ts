import 'server-only';
import type { CompiledAsk, FanoutEvent, LiveState, MemberRef, SampleNetworkAskId } from '@/lib/types';

/**
 * Owner: BE2. The fan-out: SQL prefilter (public.prefilter_members) → gates in parallel (BE1 runGate, at most 16
 * in flight, each decision persisted before it streams) → reserve_slot / create_offer for the best accept (the
 * member with the most unused cap this month, then the earliest answer) → offer email. Fails closed: if more than
 * 1 in 5 gates fail, nothing is offered.
 *
 * STUB (foundation): signatures are final. Until BE2 replaces the bodies every call reports `not_configured`.
 */

export type FanoutRefusal = {
  error: 'invalid' | 'not_configured' | 'not_allowed' | 'not_found' | 'queued' | 'already_sent' | 'rate_limited' | 'live_unavailable';
  message: string;
  retry_at?: string;
  live?: LiveState;
  ask_id?: string;
};

export type FanoutStart =
  | { ok: true; ask_id: string; events: AsyncIterable<FanoutEvent> }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 503; body: FanoutRefusal };

/**
 * Sends a persisted REAL ask that `user` owns. Events are asker-serialized: cell states are only
 * offered | next | question | nothistime; no caps, pauses or identities (docs/CONTRACT.md §d).
 * Used by POST /api/asks/[id]/send and the MCP tool send_ask (with a token).
 */
export async function startSend(askId: string, user: MemberRef, context: { clientKey: string | null; signal?: AbortSignal }): Promise<FanoutStart> {
  void askId;
  void user;
  void context;
  return { ok: false, status: 503, body: { error: 'not_configured', message: 'The real network isn’t set up on this instance. Nothing was sent to anyone.' } };
}

export interface SampleSendInput {
  /** One of the three sample asks when the founder sent its text (vague / partial / complete variants). */
  sample_ask_id: SampleNetworkAskId | null;
  text: string;
  compiled: CompiledAsk;
  /** The visitor's own gate (the YOU cell): their playground rules and cap, or null. */
  you: { rules: string; cap: number } | null;
}

/**
 * The SAMPLE fan-out: nothing is persisted and nobody is emailed. For a sample ask, the 39 sample members come
 * from data/recorded/sample-network.json (replayed at recorded speed only when its source is "model"; an
 * authored file renders at once and is labelled as written by hand) and YOUR gate runs live. For any other text
 * all 40 gates run live, or the send is refused with `live_unavailable`. Cell events carry the full internal
 * result (FanoutCellEventSample) for the reveal switch. Used by POST /api/asks/sample and send_ask without a token.
 */
export async function startSampleSend(input: SampleSendInput, context: { clientKey: string | null; signal?: AbortSignal }): Promise<FanoutStart> {
  void input;
  void context;
  return { ok: false, status: 503, body: { error: 'not_configured', message: 'Sample sends aren’t built on this instance yet. Nothing was sent to anyone.' } };
}
