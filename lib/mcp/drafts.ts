import 'server-only';
import { assembleAskText, PART_MAX, validateAsk } from '@/lib/oti/ask';
import { norm } from '@/lib/oti/clause';
import { SUBJECT_MAX } from '@/lib/oti/text';
import { type DraftPartView, draftResolved, field, PART_LABEL } from '@/lib/receipts';
import { getAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { type AskParts, type CompiledAsk, type CompiledPart, PART_KEYS, type PartKey } from '@/lib/types';

/**
 * MCP drafts between stateless calls (draft_ask → draft_ask with draft_id and answers → send_ask with draft_id).
 * Stored in `public.drafts` (24 h, the daily cron deletes old rows) with the service role; without a database, a
 * module-level Map on this instance, so an unknown id answers “That draft expired. Call draft_ask again with the full
 * ask.” A draft holds the founder's raw text and the 5 parts: what the compiler found or suggested, then completed by
 * the user's answers (`added`), each with where it came from (“notes/pipeline.md line 9”, “your message”).
 */

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX = 500;
const DB_TIMEOUT_MS = 4_000;
export const DRAFT_ID_RE = /^d_[0-9A-Za-z]{3,16}$/;

/** A part as stored: the compiler's part plus whether the user supplied it and its source. */
export interface DraftPart extends CompiledPart {
  added?: boolean;
  from?: string | null;
}

export type DraftState = 'missing' | 'ready' | 'refused' | 'sent';

export interface DraftRecord {
  id: string;
  owner_id: string | null;
  network: 'sample' | 'real';
  raw: string;
  parts: DraftPart[];
  subject: string | null;
  topic: string | null;
  state: DraftState;
  ask_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export type LoadResult = { ok: true; draft: DraftRecord | null } | { ok: false; reason: 'db_down' };

/* ---------- the store ---------- */

const memory = new Map<string, DraftRecord>();

function pruneMemory(now: number) {
  for (const [k, v] of memory) if (Date.parse(v.expires_at) <= now) memory.delete(k);
  while (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}

function fromRow(row: Record<string, unknown>): DraftRecord | null {
  if (typeof row.id !== 'string' || typeof row.raw !== 'string' || !Array.isArray(row.parts)) return null;
  const state = row.state as DraftState;
  return {
    id: row.id,
    owner_id: typeof row.owner_id === 'string' ? row.owner_id : null,
    network: row.network === 'real' ? 'real' : 'sample',
    raw: row.raw,
    parts: (row.parts as unknown[]).filter((p): p is DraftPart => !!p && typeof p === 'object' && PART_KEYS.includes((p as DraftPart).key)),
    subject: typeof row.subject === 'string' ? row.subject : null,
    topic: typeof row.topic === 'string' ? row.topic : null,
    state: ['missing', 'ready', 'refused', 'sent'].includes(state) ? state : 'missing',
    ask_id: typeof row.ask_id === 'string' ? row.ask_id : null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    expires_at: String(row.expires_at ?? new Date(Date.now() + DRAFT_TTL_MS).toISOString()),
  };
}

/** For tests: forget the in-memory drafts. */
export function __resetDraftsForTests(): void {
  memory.clear();
}

export async function loadDraft(id: string, now: number = Date.now()): Promise<LoadResult> {
  if (!DRAFT_ID_RE.test(id)) return { ok: true, draft: null };
  const admin = getAdminClient();
  if (!admin.ok) {
    pruneMemory(now);
    const d = memory.get(id) ?? null;
    return { ok: true, draft: d && Date.parse(d.expires_at) > now ? structuredClone(d) : null };
  }
  try {
    const { data, error } = await admin.client.from('drafts').select('*').eq('id', id).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();
    // Any error reading a draft is our side (unreachable, timeout, or an unexpected query error), never “expired”.
    if (error) return { ok: false, reason: 'db_down' };
    const draft = data ? fromRow(data as unknown as Record<string, unknown>) : null;
    return { ok: true, draft: draft && Date.parse(draft.expires_at) > now ? draft : null };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

/** The SAMPLE draft a sent `sa_…` id came from (answer_question on a SAMPLE ask needs the ask as sent). */
export async function loadDraftByAsk(askId: string, now: number = Date.now()): Promise<LoadResult> {
  const admin = getAdminClient();
  if (!admin.ok) {
    pruneMemory(now);
    const d = [...memory.values()].find((x) => x.ask_id === askId) ?? null;
    return { ok: true, draft: d ? structuredClone(d) : null };
  }
  try {
    const { data, error } = await admin.client
      .from('drafts')
      .select('*')
      .eq('ask_id', askId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) return { ok: false, reason: 'db_down' };
    const row = Array.isArray(data) ? data[0] : null;
    const draft = row ? fromRow(row as unknown as Record<string, unknown>) : null;
    return { ok: true, draft: draft && Date.parse(draft.expires_at) > now ? draft : null };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

export async function saveDraft(d: DraftRecord): Promise<boolean> {
  const admin = getAdminClient();
  const record: DraftRecord = { ...d, updated_at: new Date().toISOString() };
  if (!admin.ok) {
    pruneMemory(Date.now());
    memory.set(d.id, structuredClone(record));
    return true;
  }
  try {
    const { error } = await admin.client
      .from('drafts')
      .upsert({
        id: record.id,
        owner_id: record.owner_id,
        network: record.network,
        raw: record.raw,
        parts: record.parts as unknown as Json,
        subject: record.subject,
        topic: record.topic,
        state: record.state,
        ask_id: record.ask_id,
        expires_at: record.expires_at,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    return !error;
  } catch {
    return false;
  }
}

/* ---------- parts ---------- */

/** Where a fact came from, as the agent cited it: `{ text: "14 buyer calls", from: "notes/pipeline.md line 8" }`. */
export interface SourceNote {
  text: string;
  from: string;
}

function sourceFor(text: string, sources: readonly SourceNote[]): string | null {
  const t = norm(text);
  if (!t) return null;
  const hit = sources.find((s) => {
    const n = norm(s.text);
    return n.length >= 3 && (n.includes(t) || t.includes(n));
  });
  return hit ? field(hit.from, 80) : null;
}

/** Applies the agent's sources to the compiler's parts: found parts cite a file when one holds them. */
export function partsFromCompile(parts: readonly CompiledPart[], sources: readonly SourceNote[]): DraftPart[] {
  return PART_KEYS.map((key) => {
    const p = parts.find((x) => x.key === key) ?? { key, state: 'missing' as const, text: '', source: [], question: null };
    const from = p.state === 'found' ? sourceFor(p.text, sources) : null;
    return { ...p, source: [...p.source], from: from ?? null };
  });
}

export interface AnswerProblem {
  key: PartKey;
  message: string;
}

/**
 * Merges the user's answers into the parts (each 1..200 characters, one line). An answer to any part replaces it and
 * marks it `added` (the user's words). Returns the problems for answers that couldn't be used.
 */
export function mergeAnswers(parts: DraftPart[], answers: Partial<Record<PartKey, string>> | undefined, sources: readonly SourceNote[]): { parts: DraftPart[]; problems: AnswerProblem[] } {
  const problems: AnswerProblem[] = [];
  const out = parts.map((p) => ({ ...p }));
  for (const key of PART_KEYS) {
    const raw = answers?.[key];
    if (typeof raw !== 'string') continue;
    const value = raw.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length > PART_MAX) {
      problems.push({ key, message: `Keep each part under ${PART_MAX} characters (${PART_LABEL[key]} has ${value.length}).` });
      continue;
    }
    const i = out.findIndex((p) => p.key === key);
    const prev = out[i];
    if (!prev) continue;
    out[i] = { ...prev, state: 'found', text: value, source: [], question: null, added: true, from: sourceFor(value, sources) ?? 'the user' };
  }
  return { parts: out, problems };
}

/** The receipt's view of the parts. */
export function partViews(parts: readonly DraftPart[]): DraftPartView[] {
  return PART_KEYS.map((key) => {
    const p = parts.find((x) => x.key === key);
    if (!p || (p.state === 'missing' && !p.text)) return { key, state: 'missing', text: '', from: null };
    if (p.added) return { key, state: 'added', text: p.text, from: p.from ?? 'the user' };
    if (p.state === 'suggested') {
      const words = p.source.find((s) => s.found && s.text)?.text;
      return { key, state: 'suggested', text: p.text, from: words ? `“${field(words, 80)}”` : 'your message' };
    }
    return { key, state: 'found', text: p.text, from: p.from ?? 'your message' };
  });
}

export function resolvedCount(parts: readonly DraftPart[]): number {
  return draftResolved(partViews(parts));
}

/** The part values (`needs` without “20 minutes with”, as CompiledAsk stores it). */
export function partValues(parts: readonly DraftPart[]): AskParts {
  const v: AskParts = { challenge: '', tried: '', needs: '', by: '', offers: '' };
  for (const p of parts) if (p.state !== 'missing' || p.added) v[p.key] = p.text.replace(/\s+/g, ' ').trim();
  return v;
}

/** The ask exactly as it would be sent: parts, subject and the text members read (the founder's text plus what was added). */
export function compiledOf(d: Pick<DraftRecord, 'raw' | 'parts' | 'subject' | 'topic'>): CompiledAsk {
  const parts = partValues(d.parts);
  // Parts the compiler found in the founder's text aren't repeated; suggested and added parts are appended.
  const added = d.parts.filter((p) => p.added || p.state === 'suggested').map((p) => p.key);
  const subject = (d.subject ?? '').trim().slice(0, SUBJECT_MAX);
  return { parts, subject, text: assembleAskText(d.raw.trim(), parts, added), price: null, topic: d.topic };
}

/** `ready` when all 5 parts are resolved and the ask passes the server-side check (validateAsk). */
export function draftStatus(d: Pick<DraftRecord, 'raw' | 'parts' | 'subject' | 'topic'>): { ready: boolean; problem: string | null } {
  if (resolvedCount(d.parts) < 5) return { ready: false, problem: null };
  const check = validateAsk(d.raw, compiledOf(d));
  return check.ok ? { ready: true, problem: null } : { ready: false, problem: check.message };
}

/** Missing part labels, e.g. “deadline and offer back”. */
export function missingLabels(parts: readonly DraftPart[]): string[] {
  return partViews(parts)
    .filter((p) => p.state === 'missing')
    .map((p) => PART_LABEL[p.key]);
}
