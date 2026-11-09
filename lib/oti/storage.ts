/**
 * Browser storage shared across surfaces (ports of prototype/shared.js OTI.KEYS and OTI.store). sessionStorage,
 * JSON, never throws (private mode, blocked storage and SSR all read as null). Every value carries `v: 1`;
 * a value with another version or the wrong shape reads as null.
 *
 * Who writes and reads what (docs/CONTRACT.md §storage):
 * - oti.playground  S1 writes (300 ms after the last keystroke, and after each run); S3 “Test my rules ›” writes
 *                   the member's rules. Read by S2 (YOU cell, sample chip preset), S3 (/join carry-over card),
 *                   R (/o/sample?from=playground builds the card from the top Reaches you row).
 * - oti.sampleAsk   S2 writes (SAMPLE send and every outcome change). Read by R (/o/sample?ask=…, the sample
 *                   email viewer).
 * - oti.sampleOffer R writes when a SAMPLE offer is acted on. Read by S2 (the sample loop: intro / answered /
 *                   moved-on) on focus, pageshow and visibilitychange.
 * - oti.join        S3 only (/join step and email between reloads).
 */

import type { DisplayVerdict } from './cap';
import type { CompiledAsk, GateQuestion, OfferAction, PresetId, QuestionType, SampleAskKey, SampleNetworkAskId } from '@/lib/types';
import type { QaState } from '@/lib/qa';

export const STORAGE_KEYS = {
  playground: 'oti.playground',
  sampleAsk: 'oti.sampleAsk',
  sampleOffer: 'oti.sampleOffer',
  join: 'oti.join',
} as const;

export interface PlaygroundStore {
  v: 1;
  preset: PresetId;
  rules: string;
  cap: number;
  /** True once the visitor changed the preset's text (the presets radiogroup then shows no selection). */
  edited: boolean;
  /** The last finished run, or nulls before any run. */
  run_id: string | null;
  ran_at: string | null;
  mode: 'live' | 'recorded' | null;
  /** The rules that run used; results are stale when they differ from `rules`. */
  run_rules: string | null;
  /** Rows of that run in arrival order. `cited` holds the member's own words (found quotes only). */
  results: { ask_id: SampleAskKey; display: DisplayVerdict; cited: string[] }[];
  /** Ask ids marked “Disagree” in that run. */
  marks: SampleAskKey[];
}

export interface SampleAskStore {
  v: 1;
  /**
   * `sa_eng | sa_health | sa_founder` for the three sample asks, or `sa_` + 6 characters (publicId('sampleAsk'))
   * for a SAMPLE send of the visitor's own text. /ask/[id] renders any `sa_…` id from this store (isSampleAskId).
   */
  id: SampleNetworkAskId | `sa_${string}`;
  preset: PresetId;
  /** The S2 status page's outcome state (QA state names). */
  state: QaState<'askStatus'>;
  /** Who holds the offer: the visitor (`you`) or a sample member label (`m-7f2a`); null before the offer. */
  offered_to: 'you' | string | null;
  question: GateQuestion | null;
  answered: { type: QuestionType; text: string } | null;
  /** When the visitor pressed Send (epoch ms): SAMPLE times are the viewer's own. */
  sent_at: number;
  /** When the offer was made (epoch ms; reply by = this + 72 h), or null before the offer. */
  offered_at: number | null;
  /**
   * The ask exactly as the visitor approved and sent it (subject, parts, text). /o/sample?ask=…, the sample email
   * viewer and the sample check-in render THIS, so the loop shows the ask that was actually sent.
   */
  compiled: CompiledAsk;
  /** The visitor's own words their gate quoted (found quotes only) when the YOU cell accepted; [] otherwise. */
  you_cited: string[];
}

export interface SampleOfferStore {
  v: 1;
  /** The SAMPLE ask the offer came from (`sa_*`), or a playground ask id (`a01`…) for /o/sample?from=playground. */
  ask_id: string;
  action: OfferAction;
  at: number;
  /** The 2-line answer, for action `answer`. */
  text: string | null;
}

export interface JoinStore {
  v: 1;
  email: string | null;
  step: 'email' | 'code' | 'verified' | 'on';
}

export interface StoreShapes {
  playground: PlaygroundStore;
  sampleAsk: SampleAskStore;
  sampleOffer: SampleOfferStore;
  join: JoinStore;
}

export type StoreName = keyof StoreShapes;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads a stored value; null when missing, unreadable, another version, or not an object. */
export function readStore<K extends StoreName>(name: K): StoreShapes[K] | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STORAGE_KEYS[name]);
    if (raw === null) return null;
    const value = JSON.parse(raw) as { v?: unknown } | null;
    return value && typeof value === 'object' && value.v === 1 ? (value as StoreShapes[K]) : null;
  } catch {
    return null;
  }
}

/** Writes a value; false when storage is unavailable or full. */
export function writeStore<K extends StoreName>(name: K, value: StoreShapes[K]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(STORAGE_KEYS[name], JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearStore(name: StoreName): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEYS[name]);
  } catch {
    /* ignore */
  }
}
