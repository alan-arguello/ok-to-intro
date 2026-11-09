import 'server-only';
import type { AuditAction } from '@/lib/supabase/database.types';

/**
 * Owner: BE2. Append-only facts for the public board (public.audit). Every owner records its own events here:
 * BE1 `playground_run` ({gates}) and nothing per gate on the playground; BE2 asks, gates, offers, intros,
 * check-ins; S3 member_joined / member_gate_on / member_paused / member_resumed / member_deleted / rules_saved /
 * token_created / token_revoked. `detail` holds facts only (verdicts, counts, latencies, ratings, a coarse topic):
 * never rules text, ask text, names or emails.
 *
 * STUB (foundation): signature final. Until BE2 replaces the body it records nothing (and never throws).
 */

export type AuditDetail = Record<string, string | number | boolean | null>;

export interface AuditInput {
  actor_id?: string | null;
  member_id?: string | null;
  asker_id?: string | null;
  ask_id?: string | null;
  offer_id?: string | null;
  detail?: AuditDetail;
}

/** Records one fact. Never throws; a failure is logged without the detail. */
export async function recordAudit(action: AuditAction, input: AuditInput = {}): Promise<void> {
  void action;
  void input;
}
