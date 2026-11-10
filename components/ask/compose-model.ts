/**
 * The /ask compose flow as data: the 5 part rows, what “resolved” means, the head line, the example (hand-written)
 * compile results for the sample chips, and the reducer the compose island runs. Pure; tested in tests/ask.
 *
 * Where a compile result comes from (labelled on screen, docs/CONTRACT.md §e and §14):
 * - `live`: POST /api/compile streamed it (BE1's compiler).
 * - `example`: the text is one of the three sample chips, so the hand-written parts in lib/sample render at once,
 *   labelled EXAMPLE_PARTS_LABEL (like the playground's unedited presets). No request is made.
 * - `manual`: the compiler is off, paused or didn't answer, so the founder fills the 5 parts.
 */

import { assembleAskText } from '@/lib/oti/ask';
import { norm } from '@/lib/oti/clause';
import { ASK_TEXT_MAX, joinAnd, q, SUBJECT_MAX, upper1, wordCount } from '@/lib/oti/text';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import type { SampleNetworkAsk } from '@/lib/sample/types';
import { PART_KEYS, type AskParts, type CompiledAsk, type CompiledPart, type CompileRefusalKind, type Network, type PartKey } from '@/lib/types';
import { PART_QUESTION } from './copy';

export type PartRowState = 'checking' | 'found' | 'suggested' | 'approved' | 'missing' | 'editing';

export interface PartRow {
  key: PartKey;
  state: PartRowState;
  /** found / suggested / approved: the part's text (found: the founder's own words). */
  text: string;
  /** Under the text: “your text”, or “suggested from “…” and “…””. */
  note: string;
  /** missing / editing: the input's label. */
  question: string;
  /** missing / editing: what the founder typed. */
  value: string;
  /** SAMPLE only: the hand-written answer “Use sample answer” fills in. */
  sample: string | null;
}

export type Phase = 'compose' | 'compiling' | 'compiled';
export type CompileSource = 'live' | 'example' | 'manual';
export type DownKind = 'down' | 'budget' | 'off';

/** Notices under the samples, in this order. Each one is a line plus at most one action (no toasts, no modals). */
export type Note =
  | { key: 'refused'; kind: CompileRefusalKind }
  | { key: 'slow' }
  | { key: 'down'; kind: DownKind; until: string | null }
  | { key: 'limited'; retryAt: string | null }
  | { key: 'offline' }
  | { key: 'failed' }
  | { key: 'stale' }
  | { key: 'queued' }
  | { key: 'send'; tone: 'plain' | 'warn' | 'error'; title: string | null; body: string; action: 'signin' | 'profile' | 'asks' | null };

export type NoteKey = Note['key'];
export const NOTE_ORDER: readonly NoteKey[] = ['refused', 'slow', 'down', 'limited', 'offline', 'failed', 'stale', 'queued', 'send'];

export interface ComposeState {
  net: Network;
  text: string;
  phase: Phase;
  source: CompileSource | null;
  /** The text the last check ran on: found offsets index it. */
  checked: string | null;
  parts: PartRow[] | null;
  /** The text changed after a check: rows sunken, subject and preview hidden, Send waits for a new check. */
  stale: boolean;
  subject: string;
  subjectEdited: boolean;
  /** The subject was written by code from the founder's challenge (manual form): it follows the challenge until edited. */
  subjectAuto: boolean;
  draftId: string | null;
  topic: string | null;
  notes: Note[];
  sending: boolean;
  /** The disabled REAL option was pressed: its reason shows. */
  realOpen: boolean;
  /** Bumped per row when it resolves, so the row flashes once. */
  flash: number[];
  /**
   * The parts the founder typed into the manual form, kept while a new check runs: if the compiler still can't
   * answer, the form comes back with them instead of empty.
   */
  manual: { parts: PartRow[]; subject: string; subjectEdited: boolean } | null;
}

export function initialCompose(net: Network, text = ''): ComposeState {
  return {
    net,
    text,
    phase: 'compose',
    source: null,
    checked: null,
    parts: null,
    stale: false,
    subject: '',
    subjectEdited: false,
    subjectAuto: false,
    draftId: null,
    topic: null,
    notes: [],
    sending: false,
    realOpen: false,
    flash: [0, 0, 0, 0, 0],
    manual: null,
  };
}

/* ---------- rows ---------- */

function row(key: PartKey, state: PartRowState, init: Partial<PartRow> = {}): PartRow {
  return { key, state, text: '', note: '', question: PART_QUESTION[key], value: '', sample: null, ...init };
}

export function checkingRows(): PartRow[] {
  return PART_KEYS.map((k) => row(k, 'checking'));
}

/** “suggested from “churn after month 3” and “31 of 120 accounts””. */
export function suggestedFrom(phrases: readonly string[]): string {
  const list = phrases.map((p) => p.trim()).filter(Boolean);
  return list.length ? `suggested from ${joinAnd(list.map(q))}` : 'suggested';
}

/** A part the compiler streamed. Found parts show the founder's own words at the offsets code found. */
export function rowFromCompiled(part: CompiledPart, checked: string): PartRow {
  const own = (i: number): string | null => {
    const s = part.source[i];
    return s && s.found && typeof s.start === 'number' && typeof s.end === 'number' && s.end <= checked.length ? checked.slice(s.start, s.end) : null;
  };
  if (part.state === 'found') return row(part.key, 'found', { text: own(0) ?? part.text, note: 'your text' });
  if (part.state === 'suggested') {
    const from = part.source.map((s, i) => own(i) ?? s.text);
    return row(part.key, 'suggested', { text: part.text, note: suggestedFrom(from) });
  }
  return row(part.key, 'missing', { question: part.question?.trim() || PART_QUESTION[part.key] });
}

export type SampleKind = 'vague' | 'partial' | 'complete';

/** Spaces don't matter; everything else must match (the same test BE2's SAMPLE send applies to a sample ask). */
function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

/** Which sample chip `text` is, or null for the founder's own text (which needs the compiler and live gates). */
export function sampleKindOf(text: string, sa: SampleNetworkAsk): SampleKind | null {
  if (!text.trim()) return null;
  if (sameText(text, sa.vague)) return 'vague';
  if (sameText(text, sa.partial)) return 'partial';
  if (sameText(text, sa.complete)) return 'complete';
  return null;
}

/** Fewer words than this can't name a blocker and a person (BE1 lib/server/compiler.ts `MIN_WORDS`). */
export const VAGUE_MIN_WORDS = 6;

/**
 * The compiler's own code refusal for vague asks (BE1 `codeRefusal`: a sample's Vague text, or fewer than 6 words),
 * run in the browser only when live checks are off or paused, so the page can refuse without a request that would
 * just answer 503. With live checks on, the server decides. tests/ask checks the two agree.
 */
export function looksVague(text: string): boolean {
  const t = norm(text);
  return Object.values(SAMPLE_NETWORK_ASKS).some((s) => norm(s.vague) === t) || wordCount(text) < VAGUE_MIN_WORDS;
}

/**
 * The hand-written compile result for a sample chip (lib/sample `compiledPartial`). For the Complete chip every
 * part is found: each value is an exact span of the complete text (tests/ask checks it).
 */
export function exampleRows(sa: SampleNetworkAsk, kind: 'partial' | 'complete'): PartRow[] {
  return sa.compiledPartial.map((p) => {
    if (kind === 'complete') return row(p.key, 'found', { text: p.state === 'missing' ? (p.sample ?? '') : p.text, note: 'your text' });
    if (p.state === 'found') return row(p.key, 'found', { text: p.text, note: 'your text' });
    if (p.state === 'suggested') return row(p.key, 'suggested', { text: p.text, note: suggestedFrom(p.from) });
    return row(p.key, 'missing', { question: p.question ?? PART_QUESTION[p.key], sample: p.sample });
  });
}

/** The 5 parts as the sample's own answers (the manual form's “Use sample answer” on a sample text). */
export function sampleAnswers(sa: SampleNetworkAsk): Record<PartKey, string> {
  return Object.fromEntries(exampleRows(sa, 'complete').map((r) => [r.key, r.text])) as Record<PartKey, string>;
}

/** The 5 rows as inputs (compiler off, paused or silent). Rows the compiler already resolved are kept. */
export function manualRows(previous: readonly PartRow[] | null, samples: Record<PartKey, string> | null, typed: readonly PartRow[] | null = null): PartRow[] {
  return PART_KEYS.map((k, i) => {
    const prev = previous?.[i];
    if (prev && prev.state !== 'checking') return prev;
    const own = typed?.[i];
    if (own && own.key === k) return own;
    return row(k, 'missing', { sample: samples ? samples[k] : null });
  });
}

/** The manual form as it stands, to keep while a new check runs (null when the parts aren't the manual form). */
function manualBackup(state: ComposeState): ComposeState['manual'] {
  if (state.source === 'manual' && state.parts && state.phase === 'compiled') return { parts: state.parts, subject: state.subject, subjectEdited: state.subjectEdited };
  return state.manual;
}

export function partValue(p: PartRow): string {
  return p.state === 'missing' || p.state === 'editing' ? p.value.trim() : p.text.trim();
}

export function isResolved(p: PartRow): boolean {
  return p.state === 'found' || p.state === 'approved' || ((p.state === 'missing' || p.state === 'editing') && p.value.trim() !== '');
}

export interface PartCounts {
  found: number;
  approved: number;
  added: number;
  suggested: number;
  missing: number;
  checking: number;
}

export function partCounts(parts: readonly PartRow[] | null): PartCounts {
  const c: PartCounts = { found: 0, approved: 0, added: 0, suggested: 0, missing: 0, checking: 0 };
  for (const p of parts ?? []) {
    if (p.state === 'checking') c.checking++;
    else if (p.state === 'found') c.found++;
    else if (p.state === 'approved') c.approved++;
    else if (p.state === 'suggested') c.suggested++;
    else if (isResolved(p)) c.added++;
    else c.missing++;
  }
  return c;
}

/** “5 parts · 2 found · 1 suggested · 2 missing”. */
export function partsHead(parts: readonly PartRow[] | null): string {
  const c = partCounts(parts);
  const bits: string[] = [];
  if (c.found) bits.push(`${c.found} found`);
  if (c.approved) bits.push(`${c.approved} approved`);
  if (c.added) bits.push(`${c.added} added`);
  if (c.suggested) bits.push(`${c.suggested} suggested`);
  if (c.missing) bits.push(`${c.missing} missing`);
  if (c.checking) bits.push(`${c.checking} checking`);
  return bits.length ? `5 parts · ${bits.join(' · ')}` : '5 parts';
}

export type PartTag = { kind: 'checking' } | { kind: 'tag'; outline: boolean; text: string };

export function partTag(p: PartRow): PartTag {
  switch (p.state) {
    case 'checking':
      return { kind: 'checking' };
    case 'found':
      return { kind: 'tag', outline: false, text: '✓ found' };
    case 'approved':
      return { kind: 'tag', outline: false, text: '✓ approved' };
    case 'suggested':
      return { kind: 'tag', outline: true, text: 'suggested' };
    default:
      return isResolved(p) ? { kind: 'tag', outline: false, text: '✓ added' } : { kind: 'tag', outline: true, text: 'missing' };
  }
}

export function unresolvedCount(parts: readonly PartRow[] | null): number {
  return (parts ?? []).filter((p) => !isResolved(p)).length;
}

/** Index of the first part that needs the founder, or -1. */
export function firstUnresolved(parts: readonly PartRow[] | null): number {
  return (parts ?? []).findIndex((p) => !isResolved(p));
}

/** Suggestions and sample answers that “Use all N suggestions” would resolve. */
export function openSuggestions(parts: readonly PartRow[] | null): number {
  return (parts ?? []).filter((p) => p.state === 'suggested' || (!isResolved(p) && !!p.sample)).length;
}

export function partValues(parts: readonly PartRow[]): AskParts {
  const v = { challenge: '', tried: '', needs: '', by: '', offers: '' } as AskParts;
  for (const p of parts) v[p.key] = partValue(p);
  return v;
}

/**
 * A subject from the founder's own challenge when no compiler wrote one (port of the prototype's rule): drop a
 * leading “our/we/my/I”, cut on a word boundary to fit “, 20 min?” in 45 characters, never end on a filler word.
 */
export function subjectFromChallenge(challenge: string): string {
  let t = String(challenge || '').trim().replace(/^(our|we|my|i)\s+/i, '');
  if (!t) return '';
  if (t.length > 36) t = t.slice(0, 37).replace(/\s+\S*$/, '');
  t = t.replace(/(\s+(at|the|a|an|of|for|to|in|on|with|and|or|is|are|from|by))+$/i, '').replace(/[,;:.\s]+$/, '');
  const s = `${upper1(t)}, 20 min?`;
  return s.length <= SUBJECT_MAX ? s : s.slice(0, SUBJECT_MAX);
}

/** The ask exactly as it would be sent: approved parts, the subject, the text members read. */
export function compiledAskOf(state: Pick<ComposeState, 'text' | 'parts' | 'subject' | 'topic'>): CompiledAsk | null {
  if (!state.parts) return null;
  const parts = partValues(state.parts);
  const added = state.parts.filter((p) => p.state !== 'found').map((p) => p.key);
  return { parts, subject: state.subject.trim(), text: assembleAskText(state.text.trim(), parts, added), price: null, topic: state.topic };
}

export function isReady(state: Pick<ComposeState, 'phase' | 'parts' | 'stale'>): boolean {
  return state.phase === 'compiled' && !state.stale && !!state.parts && unresolvedCount(state.parts) === 0;
}

/** Inserts a one-sentence edit after the line it extends (prototype “Use this edit”), or appends it. */
export function withEdit(text: string, edit: { context: string; add: string }): string {
  const tail = edit.context.slice(-18);
  const at = text.indexOf(tail);
  return at >= 0 ? `${text.slice(0, at + tail.length)} ${edit.add}${text.slice(at + tail.length)}` : `${text.trim()} ${edit.add}`;
}

export function textProblem(text: string): 'empty' | 'over' | null {
  if (!text.trim()) return 'empty';
  return text.length > ASK_TEXT_MAX ? 'over' : null;
}

/* ---------- reducer ---------- */

export type ComposeAction =
  | { type: 'boot'; state: ComposeState }
  | { type: 'net'; net: Network }
  | { type: 'realOpen'; open: boolean }
  | { type: 'text'; text: string }
  | { type: 'fill'; text: string }
  | { type: 'checkStart'; text: string }
  | { type: 'checkExample'; text: string; rows: PartRow[]; subject: string; topic: string | null }
  | { type: 'checkPart'; i: number; row: PartRow }
  | { type: 'checkDone'; rows: PartRow[]; subject: string; topic: string | null; draftId: string | null }
  | { type: 'checkRefused'; kind: CompileRefusalKind; text: string }
  | { type: 'checkSlow' }
  | { type: 'checkDown'; kind: DownKind; until: string | null; samples: Record<PartKey, string> | null; subject: string | null; text: string }
  | { type: 'checkLimited'; retryAt: string | null }
  | { type: 'checkOffline' }
  | { type: 'checkFailed' }
  | { type: 'partUse'; i: number }
  | { type: 'partEdit'; i: number }
  | { type: 'partInput'; i: number; value: string }
  | { type: 'partSample'; i: number }
  | { type: 'useAll' }
  | { type: 'subject'; value: string }
  | { type: 'sendStart' }
  | { type: 'sendFailed'; note: Extract<Note, { key: 'send' }> | { key: 'offline' } }
  | { type: 'queued' }
  | { type: 'clearNote'; key: NoteKey };

function withNote(notes: readonly Note[], note: Note): Note[] {
  return [...notes.filter((n) => n.key !== note.key), note].sort((a, b) => NOTE_ORDER.indexOf(a.key) - NOTE_ORDER.indexOf(b.key));
}
function without(notes: readonly Note[], ...keys: NoteKey[]): Note[] {
  return notes.filter((n) => !keys.includes(n.key));
}
function bump(flash: readonly number[], i: number): number[] {
  return flash.map((n, j) => (j === i ? n + 1 : n));
}
function setRow(parts: readonly PartRow[], i: number, next: PartRow): PartRow[] {
  return parts.map((p, j) => (j === i ? next : p));
}

/** In the manual form the subject follows the challenge until the founder edits it. */
function followSubject(state: ComposeState, parts: readonly PartRow[]): string {
  if (!state.subjectAuto || state.subjectEdited) return state.subject;
  const challenge = parts.find((p) => p.key === 'challenge');
  return challenge ? subjectFromChallenge(partValue(challenge)) : state.subject;
}

const CHECK_NOTES: NoteKey[] = ['refused', 'slow', 'down', 'limited', 'offline', 'failed', 'stale', 'send'];

export function composeReducer(state: ComposeState, action: ComposeAction): ComposeState {
  switch (action.type) {
    case 'boot':
      return action.state;
    case 'net':
      return { ...state, net: action.net, realOpen: false, notes: without(state.notes, 'send') };
    case 'realOpen':
      return { ...state, realOpen: action.open };
    case 'text': {
      const notes = without(state.notes, 'refused', 'send');
      // Editing after a check: the 5 parts no longer describe the text. Send waits for a new check.
      if (state.phase === 'compiled' && !state.stale) return { ...state, text: action.text, stale: true, realOpen: false, notes: withNote(notes, { key: 'stale' }) };
      return { ...state, text: action.text, realOpen: false, notes };
    }
    case 'fill':
      return { ...initialCompose(state.net, action.text) };
    case 'checkStart':
      return {
        ...state,
        manual: manualBackup(state),
        phase: 'compiling',
        source: 'live',
        checked: action.text,
        parts: checkingRows(),
        stale: false,
        subject: '',
        subjectEdited: false,
        subjectAuto: false,
        draftId: null,
        topic: null,
        realOpen: false,
        notes: without(state.notes, ...CHECK_NOTES),
      };
    case 'checkExample':
      return {
        ...state,
        manual: null,
        phase: 'compiled',
        source: 'example',
        checked: action.text,
        parts: action.rows,
        stale: false,
        subject: action.subject,
        subjectEdited: false,
        subjectAuto: false,
        draftId: null,
        topic: action.topic,
        realOpen: false,
        notes: without(state.notes, ...CHECK_NOTES),
        flash: action.rows.map((_, i) => (state.flash[i] ?? 0) + 1),
      };
    case 'checkPart': {
      if (state.phase !== 'compiling' || !state.parts) return state;
      return { ...state, parts: setRow(state.parts, action.i, action.row), flash: bump(state.flash, action.i) };
    }
    case 'checkDone':
      return {
        ...state,
        manual: null,
        phase: 'compiled',
        source: 'live',
        parts: action.rows,
        subject: action.subject,
        subjectEdited: false,
        subjectAuto: false,
        draftId: action.draftId,
        topic: action.topic,
        notes: without(state.notes, 'slow'),
        flash: action.rows.map((r, i) => (state.parts?.[i]?.state === 'checking' ? (state.flash[i] ?? 0) + 1 : (state.flash[i] ?? 0))),
      };
    case 'checkRefused':
      return {
        ...state,
        manual: null,
        phase: 'compose',
        source: null,
        checked: action.text,
        parts: null,
        stale: false,
        subject: '',
        notes: withNote(without(state.notes, ...CHECK_NOTES), { key: 'refused', kind: action.kind }),
      };
    case 'checkSlow':
      return state.phase === 'compiling' ? { ...state, notes: withNote(state.notes, { key: 'slow' }) } : state;
    case 'checkDown': {
      // Parts the compiler resolved before it stopped stay; then whatever the founder already typed by hand.
      const typed = manualBackup(state);
      const parts = manualRows(state.phase === 'compiling' ? state.parts : null, action.samples, typed?.parts ?? null);
      const keepSubject = !!typed?.subjectEdited;
      const base: ComposeState = {
        ...state,
        phase: 'compiled',
        source: 'manual',
        checked: action.text,
        parts,
        stale: false,
        subject: keepSubject && typed ? typed.subject : (action.subject ?? ''),
        subjectEdited: keepSubject,
        subjectAuto: !keepSubject && action.subject === null,
        draftId: null,
        topic: null,
        manual: null,
        notes: withNote(without(state.notes, ...CHECK_NOTES), { key: 'down', kind: action.kind, until: action.until }),
      };
      return { ...base, subject: followSubject(base, parts) };
    }
    case 'checkLimited':
      return { ...state, phase: state.phase === 'compiling' ? 'compose' : state.phase, parts: state.phase === 'compiling' ? null : state.parts, notes: withNote(without(state.notes, 'slow'), { key: 'limited', retryAt: action.retryAt }) };
    case 'checkOffline':
      return { ...state, phase: state.phase === 'compiling' ? 'compose' : state.phase, parts: state.phase === 'compiling' ? null : state.parts, notes: withNote(without(state.notes, 'slow'), { key: 'offline' }) };
    case 'checkFailed':
      return { ...state, phase: state.phase === 'compiling' ? 'compose' : state.phase, parts: state.phase === 'compiling' ? null : state.parts, notes: withNote(without(state.notes, 'slow'), { key: 'failed' }) };
    case 'partUse': {
      const p = state.parts?.[action.i];
      if (!state.parts || !p || p.state !== 'suggested') return state;
      return { ...state, parts: setRow(state.parts, action.i, { ...p, state: 'approved' }) };
    }
    case 'partEdit': {
      const p = state.parts?.[action.i];
      if (!state.parts || !p || p.state !== 'suggested') return state;
      return { ...state, parts: setRow(state.parts, action.i, { ...p, state: 'editing', value: p.text }) };
    }
    case 'partInput': {
      const p = state.parts?.[action.i];
      if (!state.parts || !p || (p.state !== 'missing' && p.state !== 'editing')) return state;
      const parts = setRow(state.parts, action.i, { ...p, value: action.value });
      return { ...state, parts, subject: followSubject(state, parts) };
    }
    case 'partSample': {
      const p = state.parts?.[action.i];
      if (!state.parts || !p || !p.sample || (p.state !== 'missing' && p.state !== 'editing')) return state;
      const parts = setRow(state.parts, action.i, { ...p, value: p.sample });
      return { ...state, parts, subject: followSubject(state, parts) };
    }
    case 'useAll': {
      if (!state.parts) return state;
      const parts = state.parts.map((p): PartRow => {
        if (p.state === 'suggested') return { ...p, state: 'approved' };
        if (!isResolved(p) && p.sample) return { ...p, value: p.sample };
        return p;
      });
      return { ...state, parts, subject: followSubject(state, parts) };
    }
    case 'subject':
      return { ...state, subject: action.value, subjectEdited: true };
    case 'sendStart':
      return { ...state, sending: true, notes: without(state.notes, 'send', 'offline') };
    case 'sendFailed':
      return { ...state, sending: false, notes: withNote(state.notes, action.note) };
    case 'queued':
      return { ...state, notes: withNote(state.notes, { key: 'queued' }) };
    case 'clearNote':
      return { ...state, notes: without(state.notes, action.key) };
  }
}
