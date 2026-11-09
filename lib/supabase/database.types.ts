/**
 * Database types for supabase-js, written by hand to match supabase/migrations/0001_init.sql (the Supabase CLI
 * isn't part of this build). If a later migration changes a table, update this file in the same change.
 * Column comments live in the migration; JSON columns are typed in lib/types.ts.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Required extends keyof Row, Optional extends keyof Row = never> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Pick<Row, Optional>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type MemberRow = {
  id: string;
  email: string;
  name: string;
  one_line: string;
  company: string;
  stage: string;
  city: string;
  scheduling_url: string | null;
  cap: number;
  show_matched: boolean;
  accept_guests: boolean;
  status: 'pending' | 'on' | 'paused';
  paused_until: string | null;
  created_at: string;
  updated_at: string;
};

export type RuleVersionRow = {
  member_id: string;
  version: number;
  text: string;
  source: 'web' | 'playground' | 'offer_edit' | 'mcp';
  created_at: string;
};

export type RulesRow = {
  member_id: string;
  version: number;
  text: string;
  updated_at: string;
};

export type CapUsageRow = {
  member_id: string;
  month: string;
  used: number;
  updated_at: string;
};

export type RealAskerRow = {
  email: string;
  source: 'env' | 'admin';
  added_at: string;
};

export type AskRow = {
  id: string;
  asker_id: string;
  network: 'real' | 'sample';
  raw: string;
  /** lib/types CompiledAsk */
  compiled: Json;
  subject: string;
  /** ready = created, not sent yet; queued = the asker already has 3 open asks (lib/types AskStatus). */
  status: 'ready' | 'queued' | 'gating' | 'open' | 'answered' | 'intro' | 'no_match' | 'closed' | 'failed' | 'withdrawn';
  /** An edited resend of this earlier ask (at most one a week per original). */
  resend_of: string | null;
  close_reason: 'all_passed' | 'deadline' | 'solved' | 'answer_timeout' | 'asker_closed' | null;
  deadline: string | null;
  network_size: number | null;
  idempotency_key: string | null;
  created_at: string;
  sent_at: string | null;
  gated_at: string | null;
  closed_at: string | null;
  withdrawn_at: string | null;
  updated_at: string;
};

export type AskMemberRow = {
  ask_id: string;
  member_id: string;
  position: number;
  skip: 'at_cap' | 'paused' | 'repeat_pair' | 'self' | null;
  created_at: string;
};

export type QuestionRow = {
  id: string;
  ask_id: string;
  type: 'price' | 'deal_size' | 'buyer_count' | 'stage' | 'region' | 'timeline' | 'role' | 'metric';
  text: string;
  gates: number;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

export type GateDecisionRow = {
  id: number;
  ask_id: string;
  member_id: string;
  attempt: number;
  rules_version: number;
  verdict: 'accept' | 'decline' | 'ask_back' | null;
  model_verdict: 'accept' | 'decline' | 'ask_back' | null;
  /** lib/types CitedQuote[] */
  cited: Json;
  decided_by: 'gate' | 'clause_check' | null;
  clause_verified: boolean;
  reason_code: 'match' | 'no_rule' | 'rule_says_no' | 'stage' | 'proof' | 'topic' | 'region' | null;
  reason: string | null;
  /** lib/types GateQuestion */
  question: Json | null;
  question_id: string | null;
  flags: string[];
  confidence: number | null;
  error_kind: 'timeout' | 'rate_limited' | 'overloaded' | 'refused' | 'budget' | 'parse' | 'unavailable' | null;
  latency_ms: number | null;
  model: string | null;
  source: 'live' | 'recorded';
  request_id: string | null;
  cost_usd: number | null;
  created_at: string;
};

export type OfferRow = {
  id: string;
  ask_id: string;
  member_id: string;
  token_hash: string;
  position: number;
  month: string;
  state: 'pending' | 'ok' | 'answered' | 'passed' | 'expired' | 'withdrawn';
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  answer: string | null;
  no_reason: 'not_my_area' | 'wrong_stage' | 'not_specific' | 'no_time' | 'other' | null;
  no_note: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export type IntroRow = {
  id: string;
  ask_id: string;
  offer_id: string;
  member_id: string;
  asker_id: string;
  sent_at: string | null;
  created_at: string;
};

export type CheckinRow = {
  id: string;
  intro_id: string;
  member_id: string;
  role: 'asker' | 'member';
  kind: 'd1' | 'd14';
  token_hash: string;
  due_at: string;
  sent_at: string | null;
  email_id: string | null;
  /** lib/types CheckinAnswer */
  answer: Json | null;
  answered_at: string | null;
  reminder_at: string | null;
  closes_at: string;
  created_at: string;
};

export type ApiTokenRow = {
  id: string;
  member_id: string;
  token_hash: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  last_used_from: string | null;
  revoked_at: string | null;
};

export type PauseTokenRow = {
  token_hash: string;
  member_id: string;
  created_at: string;
  last_used_at: string | null;
  /** Set when this token paused the member (Undo within 24 h restores the two undo_* values). */
  paused_at: string | null;
  undo_status: 'pending' | 'on' | 'paused' | null;
  undo_paused_until: string | null;
};

export type RateLimitRow = {
  key: string;
  bucket: 'try' | 'compile' | 'send' | 'sample_send' | 'mcp' | 'pages' | 'otp';
  window_start: string;
  count: number;
};

export type EmailOutboxRow = {
  key: string;
  kind: 'offer' | 'intro' | 'checkin' | 'question' | 'outcome_note' | 'withdrawn';
  member_id: string | null;
  status: 'queued' | 'scheduled' | 'sent' | 'failed' | 'cancelled';
  send_at: string;
  resend_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type DraftRow = {
  id: string;
  /** The member whose token drafted it; null for an open SAMPLE draft. */
  owner_id: string | null;
  network: 'sample' | 'real';
  raw: string;
  /** lib/types CompiledPart[] */
  parts: Json;
  subject: string | null;
  topic: string | null;
  state: 'missing' | 'ready' | 'refused' | 'sent';
  ask_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type ModelUsageRow = {
  /** Local day in Mexico City, YYYY-MM-DD. */
  day: string;
  usd: number;
  calls: number;
  updated_at: string;
};

export type AppStateRow = {
  key: string;
  value: Json;
  updated_at: string;
};

export type HookSeenRow = {
  member_id: string;
  /** 'offer:o_…' | 'question:q_…' | 'checkin:c_…' */
  item: string;
  /** 0..2: each item shows at most twice (when it arrives, and when under 24 h remain). */
  shown: number;
  last_shown_at: string | null;
};

export type AuditAction =
  | 'member_joined' | 'member_gate_on' | 'member_paused' | 'member_resumed' | 'member_deleted' | 'rules_saved'
  | 'compile_refused' | 'ask_sent' | 'ask_withdrawn' | 'ask_closed' | 'ask_no_match' | 'ask_failed_closed'
  | 'gate_checked' | 'question_answered'
  | 'offer_delivered' | 'offer_ok' | 'offer_answered' | 'offer_passed' | 'offer_expired' | 'offer_withdrawn'
  | 'intro_made' | 'checkin_answered'
  | 'playground_run' | 'sample_ask_sent' | 'token_created' | 'token_revoked';

export type AuditRow = {
  id: number;
  at: string;
  action: AuditAction;
  actor_id: string | null;
  member_id: string | null;
  asker_id: string | null;
  ask_id: string | null;
  offer_id: string | null;
  detail: Json;
};

export type EvalCaseRow = {
  id: string;
  set_name: 'dev' | 'heldout';
  case_type: 'fits' | 'wrong_stage' | 'investor' | 'injection' | 'polite_spam' | 'other';
  author: string;
  rules: string;
  ask_text: string;
  expected: 'accept' | 'decline' | 'ask_back';
  notes: string | null;
  frozen_at: string | null;
  created_at: string;
};

export type EvalRunRow = {
  id: string;
  label: string;
  set_name: 'dev' | 'heldout';
  model: string;
  rubric_hash: string;
  baseline: boolean;
  started_at: string;
  finished_at: string | null;
  totals: Json | null;
};

export type EvalResultRow = {
  run_id: string;
  case_id: string;
  verdict: 'accept' | 'decline' | 'ask_back' | null;
  cited: Json;
  decided_by: 'gate' | 'clause_check' | null;
  error_kind: string | null;
  correct: boolean;
  latency_ms: number | null;
  created_at: string;
};

export type PrefilterRow = {
  member_id: string;
  rules_text: string;
  rules_version: number;
  cap: number;
  used: number;
  skip: 'self' | 'paused' | 'at_cap' | 'repeat_pair' | null;
};

export type Database = {
  public: {
    Tables: {
      members: Table<MemberRow, 'id' | 'email', Exclude<keyof MemberRow, 'id' | 'email'>>;
      rule_versions: Table<RuleVersionRow, 'member_id' | 'version' | 'text', 'source' | 'created_at'>;
      rules: Table<RulesRow, 'member_id' | 'version' | 'text', 'updated_at'>;
      cap_usage: Table<CapUsageRow, 'member_id' | 'month', 'used' | 'updated_at'>;
      real_askers: Table<RealAskerRow, 'email', 'source' | 'added_at'>;
      asks: Table<AskRow, 'id' | 'asker_id' | 'raw' | 'compiled' | 'subject', Exclude<keyof AskRow, 'id' | 'asker_id' | 'raw' | 'compiled' | 'subject'>>;
      ask_members: Table<AskMemberRow, 'ask_id' | 'member_id' | 'position', 'skip' | 'created_at'>;
      questions: Table<QuestionRow, 'id' | 'ask_id' | 'type' | 'text', 'gates' | 'answer' | 'answered_at' | 'created_at'>;
      gate_decisions: Table<GateDecisionRow, 'ask_id' | 'member_id' | 'rules_version', Exclude<keyof GateDecisionRow, 'id' | 'ask_id' | 'member_id' | 'rules_version'>>;
      offers: Table<OfferRow, 'id' | 'ask_id' | 'member_id' | 'token_hash' | 'month' | 'expires_at', Exclude<keyof OfferRow, 'id' | 'ask_id' | 'member_id' | 'token_hash' | 'month' | 'expires_at'>>;
      intros: Table<IntroRow, 'id' | 'ask_id' | 'offer_id' | 'member_id' | 'asker_id', 'sent_at' | 'created_at'>;
      checkins: Table<CheckinRow, 'id' | 'intro_id' | 'member_id' | 'role' | 'kind' | 'token_hash' | 'due_at' | 'closes_at', Exclude<keyof CheckinRow, 'id' | 'intro_id' | 'member_id' | 'role' | 'kind' | 'token_hash' | 'due_at' | 'closes_at'>>;
      api_tokens: Table<ApiTokenRow, 'id' | 'member_id' | 'token_hash', Exclude<keyof ApiTokenRow, 'id' | 'member_id' | 'token_hash'>>;
      pause_tokens: Table<PauseTokenRow, 'token_hash' | 'member_id', 'created_at' | 'last_used_at' | 'paused_at' | 'undo_status' | 'undo_paused_until'>;
      rate_limits: Table<RateLimitRow, 'key' | 'bucket' | 'window_start', 'count'>;
      email_outbox: Table<EmailOutboxRow, 'key' | 'kind', Exclude<keyof EmailOutboxRow, 'key' | 'kind'>>;
      audit: Table<AuditRow, 'action', Exclude<keyof AuditRow, 'id' | 'action'>>;
      eval_cases: Table<EvalCaseRow, 'id' | 'set_name' | 'case_type' | 'author' | 'rules' | 'ask_text' | 'expected', 'notes' | 'frozen_at' | 'created_at'>;
      eval_runs: Table<EvalRunRow, 'id' | 'label' | 'set_name' | 'model' | 'rubric_hash', 'baseline' | 'started_at' | 'finished_at' | 'totals'>;
      eval_results: Table<EvalResultRow, 'run_id' | 'case_id' | 'correct', Exclude<keyof EvalResultRow, 'run_id' | 'case_id' | 'correct'>>;
      drafts: Table<DraftRow, 'id' | 'raw', Exclude<keyof DraftRow, 'id' | 'raw'>>;
      model_usage: Table<ModelUsageRow, 'day', 'usd' | 'calls' | 'updated_at'>;
      app_state: Table<AppStateRow, 'key', 'value' | 'updated_at'>;
      hook_seen: Table<HookSeenRow, 'member_id' | 'item', 'shown' | 'last_shown_at'>;
    };
    Views: { [_ in never]: never };
    Functions: {
      cap_month: { Args: { ts?: string }; Returns: string };
      save_rules: { Args: { p_member: string; p_text: string; p_source?: string }; Returns: number };
      reserve_slot: { Args: { p_member: string; p_month?: string }; Returns: boolean };
      create_offer: {
        Args: { p_offer_id: string; p_ask_id: string; p_member: string; p_token_hash: string; p_position?: number; p_at?: string };
        /**
         * One row: the new offer. No row: this member can't take it now (cap full, paused, not on): try the next.
         * Error code 'OTI01': someone already holds the ask (stop). 'OTI02': the ask isn't open for offers (stop).
         */
        Returns: OfferRow[];
      };
      expire_due_offers: { Args: { p_now?: string }; Returns: OfferRow[] };
      hit_rate_limit: { Args: { p_key: string; p_bucket: string; p_window_s: number; p_limit: number }; Returns: { allowed: boolean; hits: number; retry_at: string }[] };
      prefilter_members: { Args: { p_asker: string; p_at?: string }; Returns: PrefilterRow[] };
      real_line: { Args: Record<string, never>; Returns: Json };
      board_snapshot: { Args: { p_as_of?: string }; Returns: Json };
      /* 0002_network.sql: every net_ function takes named p_… arguments and returns jsonb (service_role only). */
      net_asker_access: { Args: Record<string, unknown>; Returns: Json };
      net_create_ask: { Args: Record<string, unknown>; Returns: Json };
      net_begin_send: { Args: Record<string, unknown>; Returns: Json };
      net_record_decision: { Args: Record<string, unknown>; Returns: Json };
      net_finish_send: { Args: Record<string, unknown>; Returns: Json };
      net_ask_owner: { Args: Record<string, unknown>; Returns: Json };
      net_advance: { Args: Record<string, unknown>; Returns: Json };
      net_tick_ask: { Args: Record<string, unknown>; Returns: Json };
      net_due_asks: { Args: Record<string, unknown>; Returns: Json };
      net_ask_snapshot: { Args: Record<string, unknown>; Returns: Json };
      net_ask_snapshots: { Args: Record<string, unknown>; Returns: Json };
      net_withdraw_ask: { Args: Record<string, unknown>; Returns: Json };
      net_resolve_ask: { Args: Record<string, unknown>; Returns: Json };
      net_answer_question: { Args: Record<string, unknown>; Returns: Json };
      net_rerun_counts: { Args: Record<string, unknown>; Returns: Json };
      net_offer_view: { Args: Record<string, unknown>; Returns: Json };
      net_respond_offer: { Args: Record<string, unknown>; Returns: Json };
      net_set_no_reason: { Args: Record<string, unknown>; Returns: Json };
      net_pending_for_member: { Args: Record<string, unknown>; Returns: Json };
      net_intro_view: { Args: Record<string, unknown>; Returns: Json };
      net_checkin_view: { Args: Record<string, unknown>; Returns: Json };
      net_save_checkin: { Args: Record<string, unknown>; Returns: Json };
      net_outbox_claim: { Args: Record<string, unknown>; Returns: Json };
      net_outbox_cancel: { Args: Record<string, unknown>; Returns: Json };
      net_outbox_due: { Args: Record<string, unknown>; Returns: Json };
      net_unsent_asks: { Args: Record<string, unknown>; Returns: Json };
      net_resume_gates: { Args: Record<string, unknown>; Returns: Json };
      net_fail_missing_reruns: { Args: Record<string, unknown>; Returns: Json };
      net_checkins_due: { Args: Record<string, unknown>; Returns: Json };
      net_cleanup: { Args: Record<string, unknown>; Returns: Json };
      net_outbox_result: { Args: Record<string, unknown>; Returns: undefined };
      net__audit: { Args: Record<string, unknown>; Returns: undefined };
      /** Adds measured model usage; returns the local day's total in USD. */
      add_model_usage: { Args: { p_usd: number; p_calls?: number; p_at?: string }; Returns: number };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
