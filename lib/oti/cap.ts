/**
 * The monthly cap, applied to a run of the 12 SAMPLE asks: the same rule Postgres applies to real offers
 * (`reserve_slot`): the first N accepts of the month reach the member; later accepts are over the cap.
 * Used by the playground (cap changes are recomputed here, no model call), the try_rules receipt and the
 * “Tested on the 12 sample asks” line on /o. Pure; safe in client and server code.
 */

import type { DecidedBy, GateErrorKind, Verdict } from '@/lib/types';

/** Verdict pills in the playground and receipts (`.verdict--*`). */
export type DisplayVerdict = 'reach' | 'held' | 'ask' | 'decline' | 'code' | 'failed' | 'checking' | 'notrun';

export const DISPLAY_LABEL: Record<DisplayVerdict, string> = {
  reach: 'Reaches you',
  held: 'Over your cap',
  ask: 'Question first',
  decline: 'Declined',
  code: 'Declined by code',
  failed: 'Not checked',
  checking: 'Checking',
  notrun: 'Not run',
};

export interface CapRow {
  ask_id: string;
  /** Day of the month the ask arrives (arrival order). */
  day: number;
  /** The gate's result, if it answered. */
  gate?: { verdict: Verdict; decided_by: DecidedBy } | null;
  /** The gate failed; refused/parse render as declined by code, the rest as not checked. */
  error?: GateErrorKind | null;
  /** Still streaming. */
  pending?: boolean;
}

export interface CapResult {
  display: DisplayVerdict;
  /** 1-based position among the accepts that reached the member (for “cap 1 of 2”). */
  pos?: number;
}

/**
 * Display verdicts for rows in arrival order (port of the prototype's `recompute`).
 * `provisional` (while a run streams): an accept that an earlier, still-pending row could push over the cap
 * stays CHECKING until that row resolves, so a row never flips from Reaches you to Over your cap mid-stream.
 */
export function applyCap(rows: readonly CapRow[], cap: number, provisional = false): { results: CapResult[]; reachDays: number[] } {
  let accepted = 0;
  let unknown = 0;
  const reachDays: number[] = [];
  const results = rows.map((row): CapResult => {
    if (row.error) return { display: row.error === 'refused' || row.error === 'parse' ? 'code' : 'failed' };
    if (!row.gate) {
      if (row.pending) {
        unknown++;
        return { display: 'checking' };
      }
      return { display: 'notrun' };
    }
    if (row.gate.decided_by === 'clause_check') return { display: 'code' };
    if (row.gate.verdict === 'accept') {
      let out: CapResult;
      if (accepted >= cap) out = { display: 'held' };
      else if (!provisional || accepted + unknown < cap) {
        out = { display: 'reach', pos: accepted + 1 };
        reachDays.push(row.day);
      } else out = { display: 'checking' };
      accepted++;
      return out;
    }
    return { display: row.gate.verdict === 'ask_back' ? 'ask' : 'decline' };
  });
  return { results, reachDays };
}

/** Caps a member can choose (ux-spec S1/S3: segments 1–5, default 2). */
export const CAP_CHOICES = [1, 2, 3, 4, 5] as const;
export const DEFAULT_CAP = 2;

/** “1 of your 2 this month”. */
export function capLine(nth: number, cap: number): string {
  return `${nth} of your ${cap} this month`;
}

/** “1 of 2 used”. */
export function capUsedLabel(used: number, cap: number): string {
  return `${used} of ${cap} used`;
}
