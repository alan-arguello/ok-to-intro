import 'server-only';
import type { CompiledAsk, FanoutCellEventSample, FanoutEvent, FanoutOfferEvent, GateQuestion, LiveState, MemberRef, SampleNetworkAskId } from '@/lib/types';

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
 * Sends a persisted REAL ask that `user` owns (status `ready`; `queued` → 409 queued; anything later → 409
 * already_sent with `ask_id`). Events are asker-serialized: cell states are only offered | next | question |
 * nothistime; no caps, pauses or identities (docs/CONTRACT.md §d). The fan-out must finish and persist even if the
 * client disconnects: build the events with lib/sse `detachedEvents` and register `after(() => run.done)`.
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
 * authored file renders at once and is labelled AUTHORED_FANOUT_LABEL) and YOUR gate runs live (NOT CHECKED when
 * live calls are unavailable: never an accept). Without `you` (no playground rules), the 40th cell is an authored
 * sample member that declines (topic), labelled authored. For any other text all 40 gates run live, or the send is
 * refused with `live_unavailable`; such a send gets the id `sa_` + 6 characters (publicId('sampleAsk')).
 * validateAsk (lib/oti/ask.ts) runs first. Cell events carry the full internal result (FanoutCellEventSample) for
 * the reveal switch; the `offer` event names the holder's cell. Used by POST /api/asks/sample and send_ask without a
 * token. The playground-style stream may stop when the client leaves (nothing is persisted).
 */
export async function startSampleSend(input: SampleSendInput, context: { clientKey: string | null; signal?: AbortSignal }): Promise<FanoutStart> {
  void input;
  void context;
  return { ok: false, status: 503, body: { error: 'not_configured', message: 'Sample sends aren’t built on this instance yet. Nothing was sent to anyone.' } };
}

export interface SampleAnswerInput {
  /** The SAMPLE ask the question is on (`sa_eng`, `sa_health`, `sa_founder` or a custom `sa_…`). */
  sample_ask_id: string;
  compiled: CompiledAsk;
  /** The visitor's own gate, if it was in the send (its question reruns live). */
  you: { rules: string; cap: number } | null;
  question: GateQuestion;
  /** The founder's approved answer, ≤ 280 characters. */
  answer: string;
}

export type SampleAnswerResult =
  | {
      ok: true;
      /** Gates that asked and reran once (“That answer reran the 2 gates that asked.”). */
      reran: number;
      accepted: number;
      /** The cells that changed, with their new internal result (YOU live; sample members from their file's source). */
      cells: FanoutCellEventSample[];
      /** A new offer when nobody held the ask and a rerun accept is now the best accept; else null. */
      offer: FanoutOfferEvent | null;
    }
  | { ok: false; status: 400 | 429 | 503; body: FanoutRefusal };

/**
 * ask_back on SAMPLE (/ask/sa_…, MCP answer_question on a SAMPLE id): the answer goes only to the gates that asked,
 * and each reruns once. YOUR gate reruns live (stays NOT CHECKED when live calls are unavailable); sample members
 * use their recorded or authored rerun, labelled by source. Nothing is persisted. POST /api/asks/sample/answer.
 */
export async function answerSampleQuestion(input: SampleAnswerInput, context: { clientKey: string | null; signal?: AbortSignal }): Promise<SampleAnswerResult> {
  void input;
  void context;
  return { ok: false, status: 503, body: { error: 'not_configured', message: 'Sample answers aren’t built on this instance yet. Nothing was sent to anyone.' } };
}
