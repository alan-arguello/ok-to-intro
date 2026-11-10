/**
 * OK to Intro · the shared domain model and every wire shape (frozen during the build; see docs/CONTRACT.md).
 *
 * Wire shapes follow ux-spec §8 "Event shapes". Fields marked "(addition)" extend the spec's shape where the
 * spec's own copy needs the value; nothing in the spec's shape is renamed or removed.
 * Types plus two readonly lists (PART_KEYS, ASKER_CELL_STATES); safe to import from client and server.
 */

/* ========================================================================== *
 * Networks, presets, sources
 * ========================================================================== */

/** SAMPLE = 40 fictional members (39 sample + your own gate). REAL = people who joined. */
export type Network = 'sample' | 'real';

/** The three server-defined presets (ux-spec §1 decision 2). Engineer is the default. */
export type PresetId = 'engineer' | 'health' | 'founder';

/** Ids of the 12 SAMPLE asks the playground runs, in arrival order. */
export type SampleAskKey = 'a01' | 'a02' | 'a03' | 'a04' | 'a05' | 'a06' | 'a07' | 'a08' | 'a09' | 'a10' | 'a11' | 'a12';

/** Ids of the three SAMPLE asks on /ask (one per preset). Their status lives in the browser tab only. */
export type SampleNetworkAskId = 'sa_eng' | 'sa_health' | 'sa_founder';

/** Where a recorded file came from. "authored" files are hand-written and are never presented as a model run. */
export type RecordedSource = 'model' | 'authored';

/**
 * Where one verdict on screen came from. `live`: a model call in this request. `recorded`: a model call recorded
 * earlier (a `source: "model"` file). `authored`: hand-written SAMPLE data (a `source: "authored"` file); it is
 * never labelled recorded, live or model, and carries no latency, cost or confidence (docs/CONTRACT.md §e).
 */
export type VerdictSource = 'live' | 'recorded' | 'authored';

/* ========================================================================== *
 * Gates
 * ========================================================================== */

export type Verdict = 'accept' | 'decline' | 'ask_back';

/** Why a gate decided what it did (data.js comment): `match` for accepts, the others for declines and questions. */
export type ReasonCode = 'match' | 'no_rule' | 'rule_says_no' | 'stage' | 'proof' | 'topic' | 'region';

/** Flags a gate may raise about the ask itself. */
export type GateFlag = 'instruction_in_ask' | 'asker_not_founder';

/** ask_back questions are limited to these 8 types (ux-spec S6). Code rejects anything else (→ decline). */
export type QuestionType = 'price' | 'deal_size' | 'buyer_count' | 'stage' | 'region' | 'timeline' | 'role' | 'metric';

export interface GateQuestion {
  type: QuestionType;
  /** At most 100 characters, no URLs, paths or emails (checked by code). */
  text: string;
}

/**
 * One quote a gate cited, after the code clause check (lib/oti/clause.ts `findClause`).
 * `start`/`end` are offsets into the member's ORIGINAL rules text and are present exactly when `found` is true.
 * Render the member's own words `rules.slice(start, end)`, never `text` (the model's copy).
 */
export interface CitedQuote {
  text: string;
  found: boolean;
  start?: number;
  end?: number;
}

/** Who made the final call on a verdict. `clause_check`: code changed it to a decline because a quote was not found. */
export type DecidedBy = 'gate' | 'clause_check';

/**
 * Failure kinds (ux-spec §8 `error.kind`). How each one renders:
 * - timeout | rate_limited | overloaded | budget → the row is NOT CHECKED (red), never an accept.
 * - refused | parse → the row is DECLINED BY CODE with the fixed reason copy in lib/oti/copy.ts.
 */
export type GateErrorKind = 'timeout' | 'rate_limited' | 'overloaded' | 'refused' | 'budget' | 'parse';

/** Server-side gate failure, superset of GateErrorKind: `unavailable` = no model key, or live checks paused. */
export type GateFailureKind = GateErrorKind | 'unavailable';

/** What a single gate decided, after code checks. Persisted in `gate_decisions`; streamed as the `gate` event. */
export interface GateDecision {
  /** Final verdict after code checks. A clause-check failure is always `decline`. */
  verdict: Verdict;
  /** (addition) What the model returned before code checks, for "code changed accept to decline". */
  model_verdict: Verdict;
  cited: CitedQuote[];
  decided_by: DecidedBy;
  reason_code: ReasonCode;
  /** The gate's one-line reason (shown as "Why"). */
  reason: string;
  question: GateQuestion | null;
  flags: GateFlag[];
  /** Model-reported and uncalibrated. Shown only inside "Gate output". `null` in authored data. */
  confidence: number | null;
}

/* ========================================================================== *
 * POST /api/try: the playground's live run (SSE). ux-spec §8.
 * ========================================================================== */

export interface TryRequest {
  /** The visitor's rules, 1..1000 characters. Never stored or logged. */
  rules: string;
  /** Subset of the 12 SAMPLE asks to run (retry of missing rows). Default: all 12, in arrival order. */
  ask_ids?: SampleAskKey[];
  /**
   * absent or `live`: live only (400/429/503 before streaming). `recorded`: an unedited preset's recorded run.
   * `auto`: live when possible; an unedited preset falls back to its recorded run (MCP try_rules).
   */
  mode?: 'live' | 'recorded' | 'auto';
}

export interface TryPlanEvent {
  run_id: string;
  mode: 'live' | 'recorded';
  rules_chars: number;
  /** `i` is the ask's index in the 12 (0-based, arrival order); rows resolve in place by index. */
  gates: { i: number; ask_id: SampleAskKey }[];
  recorded_at?: string;
}

export interface TryGateEvent extends GateDecision {
  i: number;
  ask_id: SampleAskKey;
  /** Milliseconds from the start of the run. `null` only for authored data, which has no real timing. */
  ms: number | null;
  /** `/api/try` only ever streams `live`; recorded files render client-side as `recorded` or `authored`. */
  source: VerdictSource;
}

export interface TryErrorEvent {
  /** Absent for a run-level error (budget, rate limit before any gate ran). */
  i?: number;
  /** (addition) Present whenever `i` is. */
  ask_id?: SampleAskKey;
  kind: GateErrorKind;
  retry_after_s?: number;
}

export interface TryCounts {
  accept: number;
  /** Includes clause-check declines and refused/parse declines. */
  decline: number;
  ask_back: number;
  /** Rows NOT CHECKED: timeout, rate_limited, overloaded, budget. */
  failed: number;
}

export interface TryDoneEvent {
  counts: TryCounts;
  wall_ms: number;
  /** Measured from token usage. `null` when unknown (never estimated in a live run). */
  cost_usd: number | null;
}

export type TryEvent =
  | { event: 'plan'; data: TryPlanEvent }
  | { event: 'gate'; data: TryGateEvent }
  | { event: 'error'; data: TryErrorEvent }
  | { event: 'done'; data: TryDoneEvent };

/* ========================================================================== *
 * POST /api/compile: the 5-part compiler (SSE). ux-spec S2.
 * ========================================================================== */

export type PartKey = 'challenge' | 'tried' | 'needs' | 'by' | 'offers';
export const PART_KEYS: readonly PartKey[] = ['challenge', 'tried', 'needs', 'by', 'offers'];

/**
 * found: the founder's own words (an exact span of their text).
 * suggested: drafted by the compiler; only `needs` may be suggested, and it must cite its source spans.
 * missing: a fact the compiler will not invent; the UI asks `question`.
 */
export type PartState = 'found' | 'suggested' | 'missing';

export interface CompiledPart {
  key: PartKey;
  state: PartState;
  /** found: the founder's words; suggested: the drafted phrase; missing: ''. */
  text: string;
  /** found: the span itself; suggested: the spans it was drawn from. Offsets index the founder's raw text. */
  source: CitedQuote[];
  /** missing only: the question to ask the founder, e.g. “By when do you need this?”. */
  question: string | null;
}

export type CompileRefusalKind = 'vague' | 'yc_application';
export type CompileErrorKind = GateErrorKind | 'unavailable';

export interface CompileRequest {
  /** 1..600 characters. */
  text: string;
  network: Network;
}

export interface CompilePlanEvent {
  draft_id: string;
  words: number;
  network: Network;
}
export interface CompilePartEvent {
  i: number;
  part: CompiledPart;
}
export interface CompileRefusedEvent {
  kind: CompileRefusalKind;
  /** The exact refusal copy (ux-spec S2 "Refusals"). */
  message: string;
}
export interface CompileErrorEvent {
  kind: CompileErrorKind;
  retry_after_s?: number;
}
export interface CompileDoneEvent {
  draft_id: string;
  /** ≤ 45 characters, written by the compiler, editable by the founder. */
  subject: string;
  /** Coarse topic for the board (never shown to members). */
  topic: string | null;
  parts: CompiledPart[];
  ms: number;
}

export type CompileEvent =
  | { event: 'plan'; data: CompilePlanEvent }
  | { event: 'part'; data: CompilePartEvent }
  | { event: 'refused'; data: CompileRefusedEvent }
  | { event: 'error'; data: CompileErrorEvent }
  | { event: 'done'; data: CompileDoneEvent };

/* ========================================================================== *
 * Asks
 * ========================================================================== */

/** The five parts as the founder approved them (plain text; `needs` as the founder wrote it: a call, an intro, an answer or an action). */
export interface AskParts {
  challenge: string;
  tried: string;
  needs: string;
  by: string;
  offers: string;
}

/** What the asker approved on /ask. Stored in `asks.compiled`. */
export interface CompiledAsk {
  parts: AskParts;
  /** ≤ 45 characters, e.g. “Intro to a hospital procurement lead”. */
  subject: string;
  /** The ask as members will see it (the founder's text, possibly with the parts they added). */
  text: string;
  /** Known only after a gate asked and the asker answered (type `price`). */
  price: string | null;
  /** A coarse topic the compiler assigns (e.g. “Enterprise sales, US”), for the board's unanswered demand. */
  topic: string | null;
}

export interface AskerProfile {
  name: string;
  company: string;
  stage: string;
  city: string;
}

/** One labelled fact on the offer card, emails and previews. Order: Problem, Needs, Tried, By, Offers, Price. */
export type FactLabel = 'Problem' | 'Needs' | 'Tried' | 'By' | 'Offers' | 'Price';
export type Fact = readonly [FactLabel, string];

/** Internal ask lifecycle (asks.status). Askers never see this directly: see AskerAskView. */
export type AskStatus =
  | 'ready' // created by POST /api/asks, not sent yet (POST /api/asks/[id]/send sends it)
  | 'queued' // the asker has 3 open asks; BE2 sends it when one of them closes
  | 'gating' // fan-out running
  | 'open' // at least one accept is offered or waiting; or a question is pending
  | 'answered' // a member answered in 2 lines; waiting on the asker's “Did that solve it?”
  | 'intro' // a member said OK; intro email sent
  | 'no_match' // no gate accepted
  | 'closed' // everyone in line passed or expired, the deadline passed, or the asker closed it
  | 'failed' // more than 1 in 5 gates failed: nothing was offered (fail closed)
  | 'withdrawn';

export type AskCloseReason = 'all_passed' | 'deadline' | 'solved' | 'answer_timeout' | 'asker_closed';

/* ========================================================================== *
 * Per-member candidate state on one ask: internal vs what an asker may see
 * ========================================================================== */

/** The full internal state of one (ask, member) pair. Persisted across gate_decisions and offers. */
export type CandidateState =
  | 'skipped_at_cap' // SQL, before any model call
  | 'skipped_paused'
  | 'skipped_repeat_pair'
  | 'skipped_self'
  | 'gate_failed' // timeout / rate limit / overload / budget: not checked, never an accept
  | 'declined' // includes clause-check, refused and parse declines
  | 'question' // ask_back pending on the asker's answer
  | 'accepted' // in line, not offered yet
  | 'offered' // offer pending on the member
  | 'ok' // member said OK: intro sent
  | 'answered' // member answered in 2 lines
  | 'passed' // member said No
  | 'expired' // 72 h without a reply
  | 'withdrawn'; // the asker withdrew while this member held the offer

/** The only four states an asker ever sees for a REAL member (ux-spec §1 decision 7). */
export type AskerCellState = 'offered' | 'next' | 'question' | 'nothistime';
export const ASKER_CELL_STATES: readonly AskerCellState[] = ['offered', 'next', 'question', 'nothistime'];

/** Internal cell states on a SAMPLE fan-out, revealed behind “Show what askers never see (SAMPLE only)”. */
export type SampleCellState = 'accept' | 'decline' | 'ask_back' | 'na' | 'failed';

/** Waffle cell classes in tokens.css (`.cell--*`). */
export type CellClass = 'queued' | 'checking' | 'offered' | 'next' | 'ask' | 'nothistime' | 'declined' | 'na' | 'failed';

/* ========================================================================== *
 * Fan-out (SSE): POST /api/asks/[id]/send (REAL) and POST /api/asks/sample (SAMPLE). ux-spec §8.
 * ========================================================================== */

export interface FanoutPlanEvent {
  ask_id: string;
  network: Network;
  /** Network size (REAL counts every member, including those SQL skipped). */
  total: number;
  /** SAMPLE: where the 39 sample members' results come from. */
  sample_source?: RecordedSource | 'live';
  recorded_at?: string;
}

/** REAL cell event: position and one of the 4 asker states, nothing else. */
export interface FanoutCellEventReal {
  cell: number;
  state: AskerCellState;
}

/** SAMPLE cell event: the full internal result, for the reveal switch and popovers. */
export interface FanoutCellEventSample {
  cell: number;
  state: SampleCellState;
  /** True for the visitor's own gate (the YOU cell). */
  you: boolean;
  /** Sample member label (m-7f2a) or `You`. */
  label: string;
  city: string;
  reason_code: ReasonCode | null;
  /** The member's own words the gate cited (already verified by code), or null. */
  cited: string | null;
  question: GateQuestion | null;
  /** Gate latency; null for authored data and SQL skips. */
  ms: number | null;
  cap: number;
  used: number;
  na: 'at_cap' | 'paused' | null;
  /**
   * The YOU cell is `live` (with `state: 'failed'` when live calls are unavailable: not checked, never an accept).
   * The 39 sample members follow their recorded file's source: `recorded` or `authored`.
   */
  source: VerdictSource;
}

export interface FanoutQuestionEvent {
  qid: string;
  type: QuestionType;
  text: string;
  /** How many gates asked this question (“Your answer goes only to the gates that asked (2)”). */
  gates: number;
}

export interface FanoutOfferEvent {
  /** offered_at + 72 h, ISO. */
  expires_at: string;
  /** SAMPLE only: who holds the offer. Never sent on REAL. */
  to?: 'you' | 'member';
  /** SAMPLE only: the waffle position of the member who holds it (its cell carries the label). Never sent on REAL. */
  cell?: number;
}

export interface FanoutDoneEvent {
  wall_ms: number;
  people_interrupted: number;
  /** REAL: counts in the 4 asker states only. */
  counts: Record<AskerCellState, number>;
  /**
   * SAMPLE: gates that ran (“31 of 33 gates answered”). REAL: always null, because network size minus gates ran
   * = members SQL skipped (at cap, paused, repeat pair), which askers must not learn. REAL copy uses the failure
   * count alone (“2 gates failed and count as not checked, never as an accept.”).
   */
  gates_ran: number | null;
  /** Failed gates (not checked, never an accept). */
  gates_failed: number;
  /** True when more than 1 in 5 gates failed and nothing was offered. */
  failed_closed: boolean;
}

export type FanoutEvent =
  | { event: 'plan'; data: FanoutPlanEvent }
  | { event: 'cell'; data: FanoutCellEventReal | FanoutCellEventSample }
  | { event: 'question'; data: FanoutQuestionEvent }
  | { event: 'offer'; data: FanoutOfferEvent }
  | { event: 'error'; data: { kind: GateErrorKind | 'unavailable' | 'queued' | 'not_allowed'; message: string } }
  | { event: 'done'; data: FanoutDoneEvent };

/**
 * GET /api/asks/[id] with `Accept: text/event-stream` (REAL, owner only): the tail of a persisted ask.
 * `view` is the whole serialized AskerAskView, sent on connect and again whenever anything asker-visible changes
 * (each one replaces the last, so Last-Event-ID needs no replay). The server ends the stream after about 55 s or
 * when the view stops changing on its own (outcome not `ready`/`gating`); `end` says which. The client closes its
 * EventSource on `end` (EventSource would otherwise reconnect forever) and re-reads at the next checkpoint
 * (`view.next_checkpoint`) or on focus.
 */
export type AskTailEvent =
  | { event: 'view'; data: AskerAskView }
  | { event: 'end'; data: { reason: 'settled' | 'timeout' | 'not_found' } };

/* ========================================================================== *
 * What an asker can read about a REAL ask: the serializer's output (BE2 lib/server/serializer.ts)
 * ========================================================================== */

/**
 * The outcome card on /ask/[id] for REAL asks. Pass and expiry read the same (`offered` again, or `closed`).
 * `ready`: created but not sent (the page sends it: POST /api/asks/[id]/send, then renders the stream).
 */
export type AskerOutcome = 'ready' | 'queued' | 'gating' | 'offered' | 'question' | 'answered' | 'intro' | 'no_match' | 'closed' | 'failed' | 'withdrawn';

export interface AskerQuestion {
  id: string;
  type: QuestionType;
  text: string;
  gates: number;
  answer: string | null;
  answered_at: string | null;
}

/**
 * Everything an asker may read about one REAL ask: the output of BE2's `serializeForAsker` (docs/CONTRACT.md §d).
 * Timing rule: every timestamp that follows a MEMBER's action (a pass, an expiry, a 2-line answer, the offer moving
 * on, a close after all passed) is the checkpoint at which it became visible (`as_of`), never the moment it
 * happened. Timestamps of the asker's own actions (sent, withdrawn) and of an intro are exact.
 */
export interface AskerAskView {
  id: string;
  network: 'real';
  subject: string;
  compiled: CompiledAsk;
  sent_at: string | null;
  outcome: AskerOutcome;
  /** The moment this view reflects: max(send finished, last 09:00/21:00 PT checkpoint). Intros show at once. */
  as_of: string;
  next_checkpoint: string;
  /** Fixed shuffled positions; length = network size at send time. */
  cells: AskerCellState[];
  people_interrupted: number;
  /** Gates that failed on the send (no verdict, or never answered): the count alone, never how many ran (§d.2). */
  gates_failed: number;
  /**
   * While someone holds the offer: their reply deadline and the line position (“2 of 3”). For position 1 the
   * deadline is exact (offered at send + 72 h; the asker knows the send time). For position 2 and later it is
   * rounded UP to the next 09:00/21:00 checkpoint, because the exact minute would date the previous member's No.
   */
  offered: { reply_by: string; position: number; in_line: number } | null;
  questions: AskerQuestion[];
  /** “Matched a member's rules.” when null; the verbatim line only if that member turned it on. */
  matched_line: string | null;
  /** A member's 2-line answer, without their name. `at` is the checkpoint it became visible at. */
  answer: { text: string; at: string } | null;
  /** Only after a member said OK. */
  intro: { member_name: string; member_line: string; sent_at: string; scheduling_url: string | null } | null;
  /** Coarse reasons over the whole network; buckets under 3 fold into `other`. Only for no_match. */
  no_match: { why: Partial<Record<'topic' | 'stage' | 'proof' | 'region', number>> & { other: number }; suggestion: AskEditSuggestion | null } | null;
  /** `at` is the checkpoint the close became visible at (exact only for the asker's own close or a deadline). */
  closed: { reason: AskCloseReason; offered_count: number; at: string } | null;
  withdrawn_at: string | null;
  /** The raw trace lines the asker may see (ux-spec S2 “Raw trace for the asker on REAL”). */
  trace: string[];
}

/** “What would change it”: one sentence that may only add true information to the ask. */
export interface AskEditSuggestion {
  context: string;
  add: string;
  why: string;
}

export interface AskListItem {
  id: string;
  subject: string;
  network: Network;
  outcome: AskerOutcome;
  /** One short status phrase, e.g. “offered · reply by Thu Nov 12, 21:04 PT”. */
  status_line: string;
  created_at: string;
}

/* ========================================================================== *
 * Offers (S4) and check-ins (S5)
 * ========================================================================== */

export type OfferState = 'pending' | 'ok' | 'answered' | 'passed' | 'expired' | 'withdrawn';
export type OfferAction = 'ok' | 'answer' | 'no';
export type NoReason = 'not_my_area' | 'wrong_stage' | 'not_specific' | 'no_time' | 'other';

/**
 * What /o/[token] renders. Built server-side for the member who holds the offer (the link is theirs); never contains
 * the token or the member's id.
 */
export interface OfferView {
  offer_id: string;
  state: OfferState;
  sample: boolean;
  /** Subject without “, 20 min?”. */
  title: string;
  subject: string;
  asker: { name: string; first: string; company: string; stage: string; city: string };
  /**
   * The member's own words at the offsets code found (offsets index `rules_version`'s text), plus the whole rules
   * line that holds them: the context line of the No-reason diff.
   */
  matched: { text: string; start: number; end: number; line: string } | null;
  /** The rules version the gate read (S4 “Rules updated, version 4”). */
  rules_version: number;
  /** The compiler's coarse topic for the ask (e.g. “Enterprise sales, US”), for the templated No edit. */
  topic: string | null;
  /** The member's own scheduling link (“with your scheduling link” after OK), or null. */
  scheduling_url: string | null;
  /** Facts in card order (lib/oti/ask.ts askFacts): Problem, Needs, Tried, By, Offers, Price. */
  facts: Fact[];
  /** “1 of your 2 this month”. */
  cap: number;
  nth: number;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  /** The member's own 2-line answer (only to the member). */
  answer: string | null;
  no_reason: NoReason | null;
  paused_until: string | null;
  ask_withdrawn_at: string | null;
  member_first: string;
}

export type OfferLookup =
  | { found: true; offer: OfferView }
  | { found: false; reason: 'invalid' | 'not_configured' | 'db_down' };

export type OfferActionResult =
  | { ok: true; offer: OfferView; repeated: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'already_acted' | 'withdrawn' | 'bad_input' | 'not_configured' | 'db_down'; offer?: OfferView };

export type CheckinKind = 'd1' | 'd14';
export type CheckinRole = 'asker' | 'member';
export type D14Outcome = 'unblocked' | 'customer' | 'hire' | 'investor' | 'nothing_yet';
export type WontHappenReason = 'no_reply' | 'wrong_person' | 'timing';

export type CheckinAnswer =
  | { kind: 'd1'; rating: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'd1'; not_yet: true }
  | { kind: 'd1'; wont_happen: true; reason: WontHappenReason | null }
  | { kind: 'd14'; outcome: D14Outcome; note: string | null };

export interface CheckinView {
  checkin_id: string;
  /** The asker's own ask (for “Your ask”); null on the member's check-in. */
  ask_id: string | null;
  kind: CheckinKind;
  role: CheckinRole;
  sample: boolean;
  /** The other person, by full and first name. */
  other_name: string;
  other_first: string;
  intro_subject: string;
  intro_made_at: string;
  answer: CheckinAnswer | null;
  answered_at: string | null;
  closes_at: string;
  /** d1 “We haven't talked yet” → one reminder date. */
  reminder_at: string | null;
}

export type CheckinLookup =
  | { found: true; checkin: CheckinView }
  | { found: false; reason: 'invalid' | 'not_configured' | 'db_down' };

export type CheckinSaveResult =
  | { ok: true; checkin: CheckinView; repeated: boolean }
  | { ok: false; reason: 'invalid' | 'closed' | 'bad_input' | 'not_configured' | 'db_down'; checkin?: CheckinView };

/* ========================================================================== *
 * Members (S3)
 * ========================================================================== */

export type MemberStatus = 'pending' | 'on' | 'paused';

/** A signed-in member as server code sees it (never sent whole to an asker). */
export interface MemberRef {
  id: string;
  email: string;
}

export interface MemberProfile {
  id: string;
  email: string;
  name: string;
  /** “Who you are, in one line”, shown to askers only after OK. */
  one_line: string;
  /** Asker profile (S2 “Sent as …” on REAL): edited in /me settings; empty strings until set. */
  company: string;
  stage: string;
  city: string;
  scheduling_url: string | null;
  cap: number;
  show_matched: boolean;
  accept_guests: boolean;
  status: MemberStatus;
  paused_until: string | null;
  rules: string;
  rules_version: number;
  rules_saved_at: string | null;
  created_at: string;
}

/* ========================================================================== *
 * Health, live state, banner (ux-spec §8 "Degraded modes")
 * ========================================================================== */

/** off = no model key on this instance (never described as an outage). */
export type LiveState = 'ok' | 'slow' | 'down' | 'budget' | 'off';

export interface HealthSnapshot {
  live: LiveState;
  /** When live checks resume (budget pauses), ISO. */
  live_paused_until: string | null;
  db: 'ok' | 'down' | 'off';
  email: 'ok' | 'off';
  /** `sample_only` when the REAL network isn't configured on this instance. */
  network: 'real' | 'sample_only';
  checked_at: string;
}

/**
 * Banner kinds (lib/oti/copy.ts BANNER_COPY). /api/health is the same for every viewer (cacheable), so the
 * banner shows slow/down/budget/off from it, `offline` from the browser, and `limited` only as a QA state:
 * per-address rate limits are each surface's own notice (ux-spec S8 “Rate limit”).
 */
export type BannerKind = 'slow' | 'down' | 'budget' | 'off' | 'limited' | 'offline';

/* ========================================================================== *
 * Board (S7) and the playground's REAL line (S1)
 * ========================================================================== */

/** The dated REAL line under the S1 lede: “Network since Nov 9: 23 members, 12 asks, 7 intros.” */
export interface RealLine {
  /** First day the network had a member, e.g. “Nov 9”; null before anyone joined (honest zeros). */
  since: string | null;
  members: number;
  asks: number;
  intros: number;
  /** When these counts were read, ISO. */
  as_of: string;
}

/**
 * getRealLine() (S7) for S1. `not_configured`: show REAL_LINE_OFF. `db_down`: render no REAL line at all (never
 * “not connected”, never stale numbers presented as current).
 */
export type RealLineResult = { ok: true; line: RealLine } | { ok: false; reason: 'not_configured' | 'db_down' };

/* ========================================================================== *
 * Email templates (R owns lib/emails/**; BE2 sends)
 * ========================================================================== */

export interface EmailMessage {
  subject: string;
  /** Hidden preview text. */
  preheader: string;
  /** Inline-styled HTML, ≤ 20 KB, light only, no images or tracking. */
  html: string;
  /** Plain-text part (always sent). */
  text: string;
  /** Extra headers, e.g. List-Unsubscribe and List-Unsubscribe-Post. */
  headers: Record<string, string>;
}

/** Footer links follow the recipient's role (ux-spec S5). All absolute URLs. */
export type EmailFooter =
  | { role: 'member'; pause_url: string; rules_url: string; delete_url: string; unsubscribe_post_url: string }
  | { role: 'asker'; ask_url: string; delete_url: string };

export interface OfferEmailInput {
  /** Absolute `/o/[token]`; buttons append `?choice=ok|answer|no`. */
  offer_url: string;
  member_first: string;
  cap: number;
  nth: number;
  asker: { name: string; first: string; company: string; stage: string; city: string };
  subject: string;
  title: string;
  /** The member's own words. */
  matched: string;
  facts: Fact[];
  /** e.g. “Thu Nov 12, 21:04 PT” and “Thu”. */
  reply_by_label: string;
  reply_by_day: string;
  footer: Extract<EmailFooter, { role: 'member' }>;
}

export interface IntroEmailInput {
  /**
   * Optional lower-case phrase after the member's name in the subject: “Intro: Maya Bennett (Oakline Health) and
   * Priya Shah (hospital procurement)”. Null drops the parenthetical (“… and Priya Shah”). R builds the subject.
   */
  member_context: string | null;
  member: { name: string; first: string; one_line: string; scheduling_url: string | null; email: string };
  asker: { name: string; first: string; company: string; stage: string; city: string; email: string };
  /** The facts the asker approved, in card order (lib/oti/ask.ts askFacts). */
  facts: Fact[];
  /** Only if the member turned “Show askers the line that matched” on. */
  matched_line: string | null;
  /** “Tomorrow we'll ask each of you one question, and Maya one more in two weeks”: the two check-in dates. */
  checkin_d1_label: string;
  checkin_d14_label: string;
  member_footer: Extract<EmailFooter, { role: 'member' }>;
}

/** To the member who held an offer when the asker withdrew it (ux-spec S2 [withdrawn]: “was told it's no longer needed”). */
export interface WithdrawnEmailInput {
  member_first: string;
  asker_first: string;
  /** The ask's title (subject without “, 20 min?”). */
  title: string;
  /** e.g. “Tue Nov 10”. */
  withdrawn_on: string;
  /** “It still counted as 1 of your 2 this month.” */
  cap: number;
  nth: number;
  footer: Extract<EmailFooter, { role: 'member' }>;
}

export interface CheckinEmailInput {
  kind: CheckinKind;
  role: CheckinRole;
  to_first: string;
  other_name: string;
  other_first: string;
  /** Absolute `/c/[token]`; options append `?v=1..5|notyet|wont` (d1) or `?v=<outcome>` (d14). */
  checkin_url: string;
  footer: EmailFooter;
}

export interface QuestionEmailInput {
  asker_first: string;
  ask_subject: string;
  question: GateQuestion;
  gates: number;
  /** Absolute `/ask/[id]`. */
  ask_url: string;
  footer: Extract<EmailFooter, { role: 'asker' }>;
}

export interface OutcomeNoteEmailInput {
  member_first: string;
  asker_first: string;
  outcome: Exclude<D14Outcome, 'nothing_yet'> | 'useful_call';
  /** e.g. “Nov 23”. */
  reported_on: string;
  footer: Extract<EmailFooter, { role: 'member' }>;
}

/* ========================================================================== *
 * Small shared results
 * ========================================================================== */

/** A typed "this feature isn't configured on this instance" result. Never thrown. */
export interface NotConfigured {
  ok: false;
  reason: 'not_configured';
  /** Which env variables are missing, by name (never values). */
  missing: string[];
}

export type RateBucket = 'try' | 'compile' | 'send' | 'sample_send' | 'mcp' | 'pages' | 'gate_create' | 'gate_ask';

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retry_at: string; limit: number; window_s: number };

/* ========================================================================== *
 * The held-out eval: BE1's `npm run eval` writes data/eval/heldout-summary.json; S7 renders it on /board
 * ========================================================================== */

export type EvalCaseType = 'fits' | 'wrong_stage' | 'investor' | 'injection' | 'polite_spam' | 'other';

/**
 * data/eval/heldout-summary.json. `source: 'none'` (the committed placeholder) until `npm run eval` has run; the
 * board then shows “No eval run yet”, never example numbers. Eval cases are written for the eval (fictional rules
 * and asks), so the misses may be shown in full; REAL rules and asks never appear on the board.
 */
export interface EvalSummary {
  source: 'none' | 'eval';
  ran_at: string | null;
  model: string | null;
  rubric_hash: string | null;
  /** “20 cases written by Alex Torrenegra (Alan’s cofounder), who didn’t see the rubric or the gate prompt · …”. */
  header: string | null;
  /** One row per case type: n cases, correct per run (3 runs), correct for the keyword baseline. */
  rows: { case_type: EvalCaseType; label: string; n: number; runs: number[]; baseline: number }[];
  totals: { n: number; runs: number[]; baseline: number } | null;
  wrongly_let_through: { runs: number[]; baseline: number } | null;
  wrongly_blocked: { runs: number[]; baseline: number } | null;
  misses: {
    case_id: string;
    case_type: EvalCaseType;
    ask: string;
    rules_excerpt: string;
    expected: Verdict;
    /** One entry per run; `not_checked` when the gate failed. */
    actual: (Verdict | 'not_checked')[];
    /** The quotes the gate cited in the first run that missed. */
    cited: string[];
  }[];
}
