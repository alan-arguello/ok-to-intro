import 'server-only';
import { fmtWhen, NETWORK_TZ, toMs } from '@/lib/oti/time';
import { traceTime, wordCount } from '@/lib/oti/text';
import type {
  AskCloseReason,
  AskerAskView,
  AskerCellState,
  AskerOutcome,
  AskerQuestion,
  AskListItem,
  AskStatus,
  CitedQuote,
  CompiledAsk,
  OfferState,
  QuestionType,
  ReasonCode,
  Verdict,
} from '@/lib/types';
import { askerAsOf, memberEventVisibleAt, nextCheckpoint, roundedReplyBy } from './checkpoints';

/**
 * Owner: BE2. The asker serializer (docs/CONTRACT.md §d): the only path from a REAL ask's internal state to anything
 * an asker reads (the status page, GET /api/asks/[id] and its tail, “Your asks”, MCP receipts, the hook, /me/export).
 *
 * `serializeForAsker(snapshot, now)` is a pure function. It builds its output field by field from an explicit list,
 * never by spreading input, so whatever else a snapshot carries (caps, labels, member ids, reasons, rules) can't
 * reach an asker. What it guarantees:
 * - four cell states only: offered (holds the offer, said OK, or answered), next (accepted, in line), question
 *   (their gate's question waits on the asker), nothistime (everything else: declined, skipped by SQL, failed,
 *   passed, expired, withdrawn);
 * - no caps, usage, pauses, member ids or labels, decliners, per-member reasons, latencies, confidences, rules text,
 *   which member asked a question, or how many gates ran;
 * - coarse reasons only on no_match, counted over the whole network once 3 gates ran, buckets under 3 folded into
 *   `other` together with SQL skips and failures;
 * - a pass and an expiry read the same (both `nothistime`, both move the offer on, or close the ask);
 * - checkpoints: what a member did shows at the first 09:00 / 21:00 (Pacific time) after it happened, and the times an
 *   asker reads for it are that checkpoint; an intro shows at once; the asker's own actions show at once;
 * - a member's identity only after OK, once the intro email went out (until then the OK reads as the offer still
 *   waiting, so “The intro email went to you both” is always true); their matched line only if they turned it on.
 */

/* ========================================================================== *
 * The internal state (public.net__snapshot in 0002_network.sql)
 * ========================================================================== */

export interface SnapshotOffer {
  /** Line position: 1 = first in line, 2 = the next after a pass or an expiry, … */
  position: number;
  /** The holder's waffle position (cell index). */
  cell: number;
  state: OfferState;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  /** The member's 2-line answer (state `answered`). */
  answer: string | null;
  /** Present only when that member turned “Show askers the line that matched” on. */
  matched: { rules: string; cited: CitedQuote[] } | null;
  [internal: string]: unknown;
}

export interface SnapshotDecision {
  position: number;
  attempt: number;
  verdict: Verdict | null;
  error_kind: string | null;
  reason_code: ReasonCode | null;
  question_id: string | null;
  created_at: string;
  [internal: string]: unknown;
}

export interface SnapshotQuestion {
  id: string;
  type: QuestionType;
  text: string;
  gates: number;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  [internal: string]: unknown;
}

export interface AskSnapshot {
  ask: {
    id: string;
    subject: string;
    compiled: CompiledAsk;
    status: AskStatus;
    close_reason: AskCloseReason | null;
    deadline: string | null;
    network_size: number | null;
    created_at: string;
    sent_at: string | null;
    gated_at: string | null;
    closed_at: string | null;
    withdrawn_at: string | null;
    [internal: string]: unknown;
  };
  members: { position: number; skip: string | null; [internal: string]: unknown }[];
  decisions: SnapshotDecision[];
  questions: SnapshotQuestion[];
  offers: SnapshotOffer[];
  intro: { member_name: string; member_line: string; scheduling_url: string | null; sent_at: string | null; created_at: string; [internal: string]: unknown } | null;
}

/* ========================================================================== *
 * Serializer
 * ========================================================================== */

const iso = (ms: number) => new Date(ms).toISOString();

/** The member's own words for the first quote code found, or null. */
function matchedWords(m: SnapshotOffer['matched']): string | null {
  if (!m || typeof m.rules !== 'string' || !Array.isArray(m.cited)) return null;
  const q = m.cited.find((c) => c && c.found && typeof c.start === 'number' && typeof c.end === 'number' && c.end > c.start);
  if (!q || q.start === undefined || q.end === undefined) return null;
  const words = m.rules.slice(q.start, q.end).trim();
  return words || null;
}

function cleanCompiled(c: CompiledAsk): CompiledAsk {
  const p = c?.parts ?? ({} as CompiledAsk['parts']);
  return {
    parts: {
      challenge: String(p.challenge ?? ''),
      tried: String(p.tried ?? ''),
      needs: String(p.needs ?? ''),
      by: String(p.by ?? ''),
      offers: String(p.offers ?? ''),
    },
    subject: String(c?.subject ?? ''),
    text: String(c?.text ?? ''),
    price: typeof c?.price === 'string' ? c.price : null,
    topic: typeof c?.topic === 'string' ? c.topic : null,
  };
}

const NO_MATCH_BUCKETS = ['topic', 'stage', 'proof', 'region'] as const;
type Bucket = (typeof NO_MATCH_BUCKETS)[number];

function bucketOf(code: ReasonCode | null): Bucket | null {
  if (code === 'topic' || code === 'no_rule') return 'topic';
  if (code === 'stage' || code === 'proof' || code === 'region') return code;
  return null;
}

/**
 * Everything an asker may read about one REAL ask, as of `now`. Pure; see the file comment for what it guarantees.
 */
export function serializeForAsker(snapshot: AskSnapshot, now: Date = new Date()): AskerAskView {
  const nowMs = now.getTime();
  const gatedMs = snapshot.ask.gated_at ? toMs(snapshot.ask.gated_at) : null;
  const size = Math.max(0, Number.isFinite(snapshot.ask.network_size) && snapshot.ask.network_size !== null ? snapshot.ask.network_size : 0);

  // An intro is made, for the asker, once its email went out (“The intro email went to you both at 21:16”). Until
  // then the OK reads as the offer still waiting, exactly as before the member answered.
  const introSent = !!snapshot.intro && typeof snapshot.intro.sent_at === 'string' && !Number.isNaN(toMs(snapshot.intro.sent_at));
  const a: AskSnapshot['ask'] = snapshot.ask.status === 'intro' && !introSent ? { ...snapshot.ask, status: 'open' } : snapshot.ask;

  /* ---- offers as the asker can see them ---- */
  const offers = [...(snapshot.offers ?? [])]
    .map((o) => (o.state === 'ok' && !introSent ? { ...o, state: 'pending' as const, responded_at: null } : o))
    .sort((x, y) => x.position - y.position);
  // “Intro made” shows at once, and with it the whole line: it already says the ask was settled by someone.
  const settled = a.status === 'intro';
  const respVisibleAt = (o: SnapshotOffer): number => {
    if (!o.responded_at) return Number.POSITIVE_INFINITY;
    // An OK (the intro) and the asker's own withdrawal show at once; a pass, an expiry or an answer at a checkpoint.
    if (settled || o.state === 'ok' || o.state === 'withdrawn') return toMs(o.responded_at);
    return memberEventVisibleAt(o.responded_at, gatedMs);
  };
  let previous = Number.NEGATIVE_INFINITY;
  const timeline = offers.map((o) => {
    // An offer shows once it exists and once every earlier holder's response shows (so the next person in line never
    // appears before the No that moved the ask to them).
    const visibleAt = Math.max(toMs(o.offered_at), previous);
    previous = Math.max(previous, respVisibleAt(o));
    return { o, visibleAt };
  });
  const visible = timeline.filter((t) => t.visibleAt <= nowMs).map((t) => t.o);
  const seen = new Map<SnapshotOffer, OfferState>(visible.map((o) => [o, respVisibleAt(o) <= nowMs ? o.state : 'pending']));

  /* ---- decisions and questions ---- */
  const latestByPos = new Map<number, SnapshotDecision>();
  const firstByPos = new Map<number, SnapshotDecision>();
  for (const d of snapshot.decisions ?? []) {
    if (d.attempt === 1) firstByPos.set(d.position, d);
    const cur = latestByPos.get(d.position);
    if (!cur || d.attempt > cur.attempt) latestByPos.set(d.position, d);
  }
  const questions = snapshot.questions ?? [];
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const waitingOnAsker = (pos: number): boolean => {
    const d1 = firstByPos.get(pos);
    if (!d1 || d1.verdict !== 'ask_back' || !d1.question_id) return false;
    const q = questionById.get(d1.question_id);
    if (!q) return false;
    // Unanswered, or answered with this gate's one rerun still running.
    return q.answer === null || (latestByPos.get(pos)?.attempt ?? 1) === 1;
  };
  const anyWaiting = [...firstByPos.keys()].some(waitingOnAsker) || questions.some((q) => q.answer === null);

  /* ---- the ask's close, as the asker can see it ---- */
  const lastResponseVisible = offers.reduce((mx, o) => Math.max(mx, o.responded_at ? respVisibleAt(o) : mx), Number.NEGATIVE_INFINITY);
  const closeVisibleAt =
    a.status === 'closed' && a.closed_at
      ? a.close_reason === 'solved' || a.close_reason === 'asker_closed'
        ? toMs(a.closed_at)
        : Math.max(toMs(a.closed_at), lastResponseVisible)
      : Number.POSITIVE_INFINITY;

  /* ---- outcome ---- */
  const latest = visible[visible.length - 1] ?? null;
  let outcome: AskerOutcome;
  switch (a.status) {
    case 'ready':
    case 'queued':
    case 'gating':
    case 'withdrawn':
    case 'failed':
    case 'no_match':
    case 'intro':
      outcome = a.status;
      break;
    default: {
      if (a.status === 'closed' && closeVisibleAt <= nowMs) {
        outcome = 'closed';
        break;
      }
      // Open, answered, or a close the asker can't see yet: rebuild what they saw at the last checkpoint.
      if (latest) {
        let s = seen.get(latest) as OfferState;
        if ((s === 'passed' || s === 'expired' || s === 'withdrawn') && !anyWaiting) {
          // The move-on hasn't happened yet (it happens on the next read); keep showing the last holder.
          seen.set(latest, 'pending');
          s = 'pending';
        }
        outcome = s === 'pending' ? 'offered' : s === 'answered' ? 'answered' : s === 'ok' ? 'intro' : 'question';
      } else {
        outcome = anyWaiting ? 'question' : 'gating';
      }
    }
  }

  /* ---- cells: four states only ---- */
  const cells: AskerCellState[] = Array.from({ length: size }, () => 'nothistime' as const);
  const active = outcome === 'gating' || outcome === 'offered' || outcome === 'question' || outcome === 'answered';
  const offeredCells = new Set<number>();
  for (const o of visible) {
    const s = seen.get(o);
    if (o.cell >= 0 && o.cell < size) {
      offeredCells.add(o.cell);
      cells[o.cell] = s === 'ok' || s === 'answered' || (s === 'pending' && active) ? 'offered' : 'nothistime';
    }
  }
  if (active) {
    for (const [pos, d] of latestByPos) {
      if (pos < 0 || pos >= size || offeredCells.has(pos)) continue;
      if (d.verdict === 'accept') cells[pos] = 'next';
      else if (waitingOnAsker(pos)) cells[pos] = 'question';
    }
  }
  const inLine = cells.filter((c) => c === 'next').length;

  /* ---- the holder, their reply-by, their line if they shared it ---- */
  let offered: AskerAskView['offered'] = null;
  if (outcome === 'offered' && latest) {
    const exact = gatedMs !== null && toMs(latest.offered_at) <= gatedMs;
    offered = {
      reply_by: exact ? iso(toMs(latest.expires_at)) : roundedReplyBy(latest.expires_at).toISOString(),
      position: latest.position,
      in_line: latest.position + inLine,
    };
  }
  const engaged = [...visible].reverse().find((o) => {
    const s = seen.get(o);
    return s === 'ok' || s === 'answered' || (s === 'pending' && active);
  });
  const matched_line = engaged ? matchedWords(engaged.matched) : null;

  const answeredOffer = [...visible].reverse().find((o) => seen.get(o) === 'answered' && o.answer);
  const answer = answeredOffer ? { text: String(answeredOffer.answer), at: iso(respVisibleAt(answeredOffer)) } : null;

  const intro =
    outcome === 'intro' && snapshot.intro && introSent
      ? {
          member_name: String(snapshot.intro.member_name ?? ''),
          member_line: String(snapshot.intro.member_line ?? ''),
          sent_at: iso(toMs(snapshot.intro.sent_at as string)),
          scheduling_url: typeof snapshot.intro.scheduling_url === 'string' ? snapshot.intro.scheduling_url : null,
        }
      : null;

  /* ---- no match: coarse reasons over the whole network ---- */
  let no_match: AskerAskView['no_match'] = null;
  if (outcome === 'no_match') {
    const members = snapshot.members ?? [];
    const ran = members.filter((m) => m.skip === null).length;
    const why: Partial<Record<Bucket, number>> & { other: number } = { other: 0 };
    if (ran < 3) {
      why.other = size;
    } else {
      const counts: Record<Bucket, number> = { topic: 0, stage: 0, proof: 0, region: 0 };
      let other = Math.max(0, size - members.length); // members who deleted their data since
      for (const m of members) {
        const d = m.skip === null ? latestByPos.get(m.position) : undefined;
        const b = d && d.verdict === 'decline' ? bucketOf(d.reason_code) : null;
        if (b) counts[b] += 1;
        else other += 1;
      }
      for (const b of NO_MATCH_BUCKETS) {
        if (counts[b] >= 3) why[b] = counts[b];
        else other += counts[b];
      }
      why.other = other;
    }
    // REAL has no hand-written “what would change it”: a suggestion may only add true information, and only the
    // asker knows it. The page shows the reasons and “Edit and resend”.
    no_match = { why, suggestion: null };
  }

  const closed: AskerAskView['closed'] =
    outcome === 'closed' && a.close_reason && a.closed_at
      ? { reason: a.close_reason, offered_count: offers.length, at: iso(closeVisibleAt) }
      : null;

  const askerQuestions: AskerQuestion[] = questions.map((q) => ({
    id: String(q.id),
    type: q.type,
    text: String(q.text),
    gates: Number(q.gates) || 1,
    answer: q.answer === null ? null : String(q.answer),
    answered_at: q.answered_at ? iso(toMs(q.answered_at)) : null,
  }));

  /* ---- the raw trace (exactly ux-spec S2 “Raw trace for the asker on REAL”) ---- */
  const trace: string[] = [];
  if (a.sent_at && a.status !== 'ready' && a.status !== 'queued') {
    const sent = toMs(a.sent_at);
    const compiled = cleanCompiled(a.compiled);
    trace.push(`${traceTime(0)}ask ${a.id} · compiled 5/5 · ${wordCount(compiled.text)} words · REAL network · ${size} members`);
    if (gatedMs !== null) {
      const done = Math.max(0, gatedMs - sent);
      trace.push(`${traceTime(done)}gates done`);
      const first = offers.find((o) => o.position === 1 && toMs(o.offered_at) <= gatedMs);
      if (first) {
        trace.push(`${traceTime(Math.max(0, toMs(first.offered_at) - sent))}offered to 1 person · reply window ends ${fmtWhen(toMs(first.expires_at), NETWORK_TZ)}`);
        trace.push(`${traceTime(Math.max(0, toMs(first.offered_at) - sent))}people interrupted 1`);
      } else {
        trace.push(`${traceTime(done)}nothing offered`);
        trace.push(`${traceTime(done)}people interrupted 0`);
      }
    }
  }

  return {
    id: String(a.id),
    network: 'real',
    subject: String(a.subject),
    compiled: cleanCompiled(a.compiled),
    sent_at: a.sent_at ? iso(toMs(a.sent_at)) : null,
    outcome,
    as_of: askerAsOf(gatedMs, now).toISOString(),
    next_checkpoint: nextCheckpoint(now).toISOString(),
    cells,
    people_interrupted: visible.length,
    gates_failed: failedGateCount(snapshot),
    offered,
    questions: askerQuestions,
    matched_line,
    answer,
    intro,
    no_match,
    closed,
    withdrawn_at: outcome === 'withdrawn' && a.withdrawn_at ? iso(toMs(a.withdrawn_at)) : null,
    trace,
  };
}

/**
 * How many gates failed on the send (not checked, never an accept): a gate that answered with no verdict, or never
 * answered. The count alone (never how many ran), for S2's “2 gates failed and count as not checked, never as an
 * accept.” and “Nothing was sent to anyone. 9 gates failed, so nothing was offered.” after a reload. Ready for
 * `AskerAskView.gates_failed` once lib/types.ts has the field (docs/requests/be2-network.md).
 */
export function failedGateCount(snapshot: AskSnapshot): number {
  if (!snapshot.ask.gated_at) return 0;
  const decided = new Set((snapshot.decisions ?? []).filter((d) => d.attempt === 1 && d.verdict !== null).map((d) => d.position));
  return (snapshot.members ?? []).filter((m) => m.skip === null && !decided.has(m.position)).length;
}

/* ========================================================================== *
 * “Your asks”: one short status phrase per ask (S3 /me, MCP my_asks)
 * ========================================================================== */

/** “offered · reply by Thu Nov 12, 21:04 PT”. Server-side, so times read in the network's zone. */
export function askerStatusLine(view: AskerAskView): string {
  switch (view.outcome) {
    case 'ready':
      return 'ready to send';
    case 'queued':
      return 'queued · sends when one of your open asks closes';
    case 'gating':
      return 'checking members’ gates';
    case 'offered':
      return view.offered
        ? `offered${view.offered.position > 1 ? ` to the next person in line (${view.offered.position} of ${view.offered.in_line})` : ''} · reply by ${fmtWhen(toMs(view.offered.reply_by), NETWORK_TZ)}`
        : 'offered';
    case 'question':
      return 'a gate has a question for you';
    case 'answered':
      return 'answered in 2 lines · did that solve it?';
    case 'intro':
      return view.intro ? `intro made · ${fmtWhen(toMs(view.intro.sent_at), NETWORK_TZ)}` : 'intro made';
    case 'no_match':
      return 'no match · 0 people interrupted';
    case 'closed':
      return view.closed ? `closed · ${view.closed.offered_count === 1 ? '1 person was' : `${view.closed.offered_count} people were`} offered it` : 'closed';
    case 'failed':
      return 'nothing was sent to anyone · gates failed, your ask is saved';
    case 'withdrawn':
      return view.withdrawn_at ? `withdrawn · ${fmtWhen(toMs(view.withdrawn_at), NETWORK_TZ)}` : 'withdrawn';
  }
}

export function askListItem(view: AskerAskView, createdAt: string): AskListItem {
  return {
    id: view.id,
    subject: view.subject,
    network: 'real',
    outcome: view.outcome,
    status_line: askerStatusLine(view),
    created_at: new Date(toMs(createdAt)).toISOString(),
  };
}

/* ========================================================================== *
 * Shape check for what the database returns (a malformed snapshot is treated as db_down, never guessed)
 * ========================================================================== */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseSnapshot(json: unknown): AskSnapshot | null {
  if (!isObj(json) || !isObj(json.ask)) return null;
  const ask = json.ask as AskSnapshot['ask'];
  if (typeof ask.id !== 'string' || typeof ask.status !== 'string' || typeof ask.subject !== 'string' || !isObj(ask.compiled)) return null;
  const okTime = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
  for (const k of ['created_at', 'sent_at', 'gated_at', 'closed_at', 'withdrawn_at'] as const) if (!okTime(ask[k])) return null;
  const offers = arr(json.offers).filter(isObj) as unknown as SnapshotOffer[];
  for (const o of offers) {
    if (typeof o.position !== 'number' || typeof o.cell !== 'number' || typeof o.state !== 'string') return null;
    if (!okTime(o.offered_at) || !okTime(o.expires_at) || !okTime(o.responded_at)) return null;
  }
  return {
    ask: { ...ask, network_size: typeof ask.network_size === 'number' ? ask.network_size : null, close_reason: ask.close_reason ?? null },
    members: arr(json.members).filter(isObj) as unknown as AskSnapshot['members'],
    decisions: arr(json.decisions).filter(isObj) as unknown as SnapshotDecision[],
    questions: arr(json.questions).filter(isObj) as unknown as SnapshotQuestion[],
    offers,
    intro: isObj(json.intro) ? (json.intro as AskSnapshot['intro']) : null,
  };
}
