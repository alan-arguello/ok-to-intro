import 'server-only';
import { z } from 'zod';
import {
  capVerdict,
  GATE_ANSWER_MAX,
  GATE_ASK_MAX,
  GATE_ASKER_NAME_MAX,
  GATE_CAP_MAX,
  GATE_CAP_MIN,
  GATE_EMAIL_MAX,
  GATE_HEADLINE_MAX,
  GATE_NAME_MAX,
  GATE_SLUG_RE,
  isValidSlug,
  LOOSE_EMAIL_RE,
  type PersonalVerdict,
} from '@/lib/oti/personal-gate';
import { RULES_MAX } from '@/lib/oti/text';
import { capMonth, NETWORK_TZ, zonedTimeToUtc } from '@/lib/oti/time';
import { getAdminClient } from '@/lib/supabase/admin';
import type { Json, PersonalGateAskRow, PersonalGateRow } from '@/lib/supabase/database.types';
import type { QuestionType } from '@/lib/types';
import { hashOwnerToken, newOwnerToken, ownerTokenMatches } from './gate-token';
import { runPersonalGate } from './personal-gate-prompt';
import { checkRateLimit } from './ratelimit';

/**
 * Personal gates (/g/<slug>): one owner's rules and monthly cap behind a public link, no accounts. Every query goes
 * through the service-role client and is scoped here: the public page reads name and headline only (never the rules
 * or the token hash); the inbox reads asks only after the owner token matches the stored SHA-256 (constant time).
 * Nothing here sends email.
 */

const DB_TIMEOUT_MS = 8_000;
const timeout = () => AbortSignal.timeout(DB_TIMEOUT_MS);

export type NotSetUp = { ok: false; reason: 'not_configured' };
const NOT_SET_UP: NotSetUp = { ok: false, reason: 'not_configured' };

function db() {
  const res = getAdminClient();
  return res.ok ? res.client : null;
}

export function gatesConfigured(): boolean {
  return getAdminClient().ok;
}

/* ---------- create ---------- */

export const createGateSchema = z.object({
  name: z.string().trim().min(1).max(GATE_NAME_MAX),
  headline: z
    .string()
    .trim()
    .max(GATE_HEADLINE_MAX)
    .optional()
    .transform((v) => (v ? v : null)),
  slug: z.string().trim().toLowerCase().regex(GATE_SLUG_RE),
  rules: z.string().trim().min(1).max(RULES_MAX),
  cap: z.coerce.number().int().min(GATE_CAP_MIN).max(GATE_CAP_MAX),
});

export type CreateGateResult =
  | { ok: true; slug: string; token: string }
  | NotSetUp
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'taken' }
  | { ok: false; reason: 'rate_limited'; retry_at: string }
  | { ok: false; reason: 'db_down' };

export async function createGate(input: unknown, rateKey: string | null): Promise<CreateGateResult> {
  const client = db();
  if (!client) return NOT_SET_UP;
  const parsed = createGateSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '');
    const message =
      field === 'name'
        ? 'Add your name (up to 60 characters).'
        : field === 'slug'
          ? 'Links use 3 to 40 lowercase letters, numbers or hyphens.'
          : field === 'headline'
            ? 'Keep the headline under 120 characters.'
            : field === 'rules'
              ? 'Your rules need 1 to 1,000 characters.'
              : 'Check the form and try again.';
    return { ok: false, reason: 'invalid', message };
  }
  const limit = await checkRateLimit(rateKey, 'gate_create');
  if (!limit.ok) return { ok: false, reason: 'rate_limited', retry_at: limit.retry_at };

  const token = newOwnerToken();
  const g = parsed.data;
  try {
    const { error } = await client
      .from('personal_gates')
      .insert({ slug: g.slug, name: g.name, headline: g.headline, rules: g.rules, cap: g.cap, owner_token_hash: hashOwnerToken(token) })
      .abortSignal(timeout());
    if (error) {
      if (error.code === '23505') return { ok: false, reason: 'taken' };
      console.error(`[gates] create failed (${error.code ?? 'no code'})`);
      return { ok: false, reason: 'db_down' };
    }
  } catch {
    return { ok: false, reason: 'db_down' };
  }
  return { ok: true, slug: g.slug, token };
}

/* ---------- read ---------- */

export type PublicGate = Pick<PersonalGateRow, 'id' | 'slug' | 'name' | 'headline' | 'cap'>;

export type GateLookup = { ok: true; gate: PersonalGateRow } | NotSetUp | { ok: false; reason: 'not_found' | 'db_down' };

async function loadGate(slug: string): Promise<GateLookup> {
  const client = db();
  if (!client) return NOT_SET_UP;
  if (!isValidSlug(slug)) return { ok: false, reason: 'not_found' };
  try {
    const { data, error } = await client.from('personal_gates').select('*').eq('slug', slug).abortSignal(timeout()).maybeSingle();
    if (error) return { ok: false, reason: 'db_down' };
    if (!data) return { ok: false, reason: 'not_found' };
    return { ok: true, gate: data as PersonalGateRow };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

/** The public view: name, headline, cap. Never the rules or the token hash. */
export async function getPublicGate(slug: string): Promise<{ ok: true; gate: PublicGate } | Exclude<GateLookup, { ok: true }>> {
  const res = await loadGate(slug);
  if (!res.ok) return res;
  const { id, name, headline, cap } = res.gate;
  return { ok: true, gate: { id, slug: res.gate.slug, name, headline, cap } };
}

/** What the share image may show: name and headline, read alone (never the rules, the cap or the token hash). Never throws. */
export async function getGateCard(slug: string): Promise<{ name: string; headline: string | null } | null> {
  const client = db();
  if (!client || !isValidSlug(slug)) return null;
  try {
    const { data, error } = await client.from('personal_gates').select('name, headline').eq('slug', slug).abortSignal(timeout()).maybeSingle();
    return error || !data ? null : { name: data.name, headline: data.headline };
  } catch {
    return null;
  }
}

/** The UTC instant this cap month started (local midnight on the 1st, Pacific time). */
export function monthStart(now: Date = new Date()): Date {
  const m = capMonth(now);
  return new Date(zonedTimeToUtc(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1, 0, 0, NETWORK_TZ));
}

async function acceptedThisMonth(gateId: string, now: Date): Promise<number | null> {
  const client = db();
  if (!client) return null;
  try {
    const { count, error } = await client
      .from('personal_gate_asks')
      .select('id', { count: 'exact', head: true })
      .eq('gate_id', gateId)
      .eq('verdict', 'accept')
      .gte('created_at', monthStart(now).toISOString())
      .abortSignal(timeout());
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

/* ---------- ask ---------- */

export const askSchema = z.object({
  asker_name: z.string().trim().min(1).max(GATE_ASKER_NAME_MAX),
  asker_email: z.string().trim().min(3).max(GATE_EMAIL_MAX).regex(LOOSE_EMAIL_RE),
  text: z.string().trim().min(1).max(GATE_ASK_MAX),
  /** The rerun after a question: the gate's question and the asker's answer. */
  followup: z
    .object({
      type: z.string().min(1).max(40),
      question: z.string().max(200),
      answer: z.string().trim().min(1).max(GATE_ANSWER_MAX),
    })
    .optional(),
});

export type AskOutcome =
  | { ok: true; verdict: 'accept'; quote: string | null }
  | { ok: true; verdict: 'ask_back'; question: string; type: string }
  | { ok: true; verdict: 'decline'; reason: string }
  | { ok: true; verdict: 'over_cap' }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'rate_limited' | 'unavailable' | 'not_found' | 'not_configured' | 'db_down' };

export async function submitGateAsk(slug: string, input: unknown, rateKey: string | null, now: Date = new Date()): Promise<AskOutcome> {
  const found = await loadGate(slug);
  if (!found.ok) return { ok: false, reason: found.reason };
  const gate = found.gate;
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '');
    const message =
      field === 'asker_name'
        ? 'Add your name.'
        : field === 'asker_email'
          ? 'Check your email address.'
          : field === 'followup'
            ? 'Answer the question in up to 300 characters.'
            : 'Write your ask (up to 1,200 characters).';
    return { ok: false, reason: 'invalid', message };
  }
  const limit = await checkRateLimit(rateKey ? `${rateKey.slice(0, 40)}:${gate.id.slice(0, 8)}` : null, 'gate_ask');
  if (!limit.ok) return { ok: false, reason: 'rate_limited' };

  const a = parsed.data;
  const result = await runPersonalGate({
    rules: gate.rules,
    ask: { text: a.text },
    answers: a.followup ? [{ type: a.followup.type as QuestionType, text: a.followup.answer }] : undefined,
  });
  if (!result.ok && !result.decision) return { ok: false, reason: 'unavailable' };
  const decision = result.ok ? result.decision : result.decision!;

  let verdict: PersonalVerdict = decision.verdict;
  if (verdict === 'accept') {
    const used = await acceptedThisMonth(gate.id, now);
    if (used === null) return { ok: false, reason: 'db_down' };
    verdict = capVerdict('accept', used, gate.cap);
  }
  // A second question after an answer is not asked again: it counts as a decline.
  if (verdict === 'ask_back' && a.followup) verdict = 'decline';

  const cited = decision.cited.filter((q) => q.found).map((q) => q.text);
  const storedText = (a.followup ? `${a.text}\n\nAnswer to “${a.followup.question}”: ${a.followup.answer}` : a.text).slice(0, GATE_ASK_MAX);
  const reason = verdict === 'decline' && decision.verdict === 'ask_back' ? 'The answer didn’t settle the question.' : decision.reason || null;
  const client = db();
  if (!client) return { ok: false, reason: 'not_configured' };
  try {
    const { error } = await client
      .from('personal_gate_asks')
      .insert({
        gate_id: gate.id,
        asker_name: a.asker_name,
        asker_email: a.asker_email,
        text: storedText,
        verdict,
        cited: cited as unknown as Json,
        reason,
        question: decision.question?.text ?? null,
      })
      .abortSignal(timeout());
    if (error) {
      console.error(`[gates] ask insert failed (${error.code ?? 'no code'})`);
      return { ok: false, reason: 'db_down' };
    }
  } catch {
    return { ok: false, reason: 'db_down' };
  }

  switch (verdict) {
    case 'accept':
      return { ok: true, verdict, quote: cited[0] ?? null };
    case 'over_cap':
      return { ok: true, verdict };
    case 'ask_back':
      return { ok: true, verdict, question: decision.question?.text ?? '', type: decision.question?.type ?? 'other' };
    default:
      return { ok: true, verdict: 'decline', reason: reason ?? '' };
  }
}

/* ---------- inbox (owner token) ---------- */

export type InboxAsk = Pick<PersonalGateAskRow, 'id' | 'asker_name' | 'asker_email' | 'text' | 'verdict' | 'reason' | 'question' | 'created_at'> & { cited: string[] };

export type InboxResult =
  | { ok: true; gate: PublicGate; used: number; asks: InboxAsk[] }
  | NotSetUp
  | { ok: false; reason: 'not_found' | 'db_down' };

export async function loadInbox(slug: string, token: string | null | undefined, now: Date = new Date()): Promise<InboxResult> {
  const found = await loadGate(slug);
  if (!found.ok) return found.reason === 'not_configured' ? NOT_SET_UP : { ok: false, reason: found.reason };
  if (!ownerTokenMatches(token, found.gate.owner_token_hash)) return { ok: false, reason: 'not_found' };
  const client = db();
  if (!client) return NOT_SET_UP;
  try {
    const { data, error } = await client
      .from('personal_gate_asks')
      .select('id, asker_name, asker_email, text, verdict, cited, reason, question, created_at')
      .eq('gate_id', found.gate.id)
      .order('created_at', { ascending: false })
      .limit(500)
      .abortSignal(timeout());
    if (error) return { ok: false, reason: 'db_down' };
    const since = monthStart(now).getTime();
    const asks: InboxAsk[] = (data ?? []).map((r) => ({
      ...(r as Omit<InboxAsk, 'cited'>),
      cited: Array.isArray(r.cited) ? (r.cited as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    }));
    const used = asks.filter((r) => r.verdict === 'accept' && Date.parse(r.created_at) >= since).length;
    const { id, name, headline, cap } = found.gate;
    return { ok: true, gate: { id, slug: found.gate.slug, name, headline, cap }, used, asks };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}

export async function deleteGate(slug: string, token: string): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_configured' | 'db_down' }> {
  const found = await loadGate(slug);
  if (!found.ok) return { ok: false, reason: found.reason };
  if (!ownerTokenMatches(token, found.gate.owner_token_hash)) return { ok: false, reason: 'not_found' };
  const client = db();
  if (!client) return NOT_SET_UP;
  try {
    const { error } = await client.from('personal_gates').delete().eq('id', found.gate.id).abortSignal(timeout());
    return error ? { ok: false, reason: 'db_down' } : { ok: true };
  } catch {
    return { ok: false, reason: 'db_down' };
  }
}
