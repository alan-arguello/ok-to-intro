/**
 * Types for the SAMPLE data (a typed port of prototype/data.js). Everything typed here is fictional and is
 * labelled SAMPLE in the UI. The verdicts in lib/sample/verdicts.ts are hand-authored expectations, not model output.
 */

import type { AskParts, GateFlag, GateQuestion, PartKey, PresetId, ReasonCode, SampleAskKey, SampleNetworkAskId, Verdict } from '@/lib/types';

export interface Preset {
  id: PresetId;
  label: string;
  cap: number;
  rules: string;
}

export type TrapKind = 'wrong stage' | 'investor' | 'injection' | 'polite spam';

export interface SampleAsk {
  id: SampleAskKey;
  /** Day of the month it arrives (arrival order). */
  day: number;
  company: string;
  city: string;
  stage: string;
  topic: string;
  trap: TrapKind | null;
  /** The trap's tell: exact substrings of `text`, underlined (dotted) in the row. */
  trap_spans: string[];
  /** ≤ 45 characters. */
  subject: string;
  text: string;
  parts: AskParts;
}

/** A hand-authored expected verdict for one preset × ask (prototype “recorded” data; reviewed for a literal reading). */
export interface AuthoredVerdict {
  ask_id: SampleAskKey;
  verdict: Verdict;
  /** Quotes as a gate would cite them; each is an exact substring of the preset's rules (checked by tests). */
  cited: string[];
  reason_code: ReasonCode;
  reason: string;
  question: GateQuestion | null;
  flags: GateFlag[];
}

export interface OneTapEditAdd {
  id: 'add-line';
  kind: 'add';
  line: string;
  /** The verdicts this line is expected to flip (a live run decides; these are for tests and docs). */
  expected_flips: Partial<Record<SampleAskKey, { verdict: Verdict; cited: string[]; reason_code: ReasonCode; reason: string }>>;
}
export interface OneTapEditCap {
  id: 'cap';
  kind: 'cap';
  from: number;
  to: number;
}
export type OneTapEdit = OneTapEditAdd | OneTapEditCap;

export interface SampleMember {
  /** Per-ask random-looking label, e.g. `m-7f2a`. */
  label: string;
  city: string;
  topic: string;
  rules: string;
  cap: number;
  used: number;
  paused: boolean;
}

export interface SampleMemberName {
  name: string;
  first: string;
  line: string;
  /** Shown without the scheme, e.g. `cal.com/ana-ruiz/20min`. */
  scheduling: string;
}

export interface CompiledPartialSample {
  key: PartKey;
  state: 'found' | 'suggested' | 'missing';
  text: string;
  /** suggested: the founder's phrases it was drawn from. */
  from: string[];
  question: string | null;
  /** The “Use sample answer” value for a missing part. */
  sample: string | null;
}

export interface SampleNetworkAsk {
  id: SampleNetworkAskId;
  preset: PresetId;
  /** Which of the 12 asks it is. */
  based_on: SampleAskKey;
  /** Members whose expected fan-out result is driven by this topic tag. */
  topicTag: string;
  as: { name: string; company: string; stage: string; city: string };
  vague: string;
  partial: string;
  complete: string;
  compiledPartial: CompiledPartialSample[];
  subject: string;
  /** Sample members whose gates accept (expected). */
  accept: string[];
  ask_back: [string, GateQuestion][];
  askBackSample: string;
  answeredSample: string;
  noMatchEdit: { context: string; add: string; why: string };
  decline: Partial<Record<'stage' | 'proof' | 'region', string[]>>;
  /** The visitor's own gate asks this question first (Health only). */
  youAskBack: (GateQuestion & { sampleAnswer: string }) | null;
}

/** One sample member's expected result on a sample ask (authored; see buildFanout). */
export interface SampleFanoutRow {
  label: string;
  city: string;
  cap: number;
  used: number;
  state: 'accept' | 'decline' | 'ask_back' | 'na';
  na: 'at_cap' | 'paused' | null;
  reason_code: ReasonCode | null;
  /** First sentence of the member's rules (what an accept would cite). */
  cited: string | null;
  question: GateQuestion | null;
}
