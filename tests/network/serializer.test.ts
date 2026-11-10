import { describe, expect, it } from 'vitest';
import { lastCheckpoint, nextCheckpoint } from '@/lib/oti/time';
import { rng } from '@/lib/oti/text';
import { ceilCheckpoint, isCheckpoint } from '@/lib/server/checkpoints';
import { askerStatusLine, serializeForAsker, type AskSnapshot, type SnapshotDecision, type SnapshotOffer } from '@/lib/server/serializer';
import type { AskerAskView, CompiledAsk, OfferState, ReasonCode, Verdict } from '@/lib/types';

/**
 * The asker serializer (docs/CONTRACT.md §d) is the privacy boundary of the REAL network. Fixtures here carry every
 * field an asker must never see (member ids, emails, labels, caps, usage, pauses, reasons, rules, latencies,
 * confidences), and every test checks that none of it comes out.
 */

const H = 3_600_000;
const SENT = Date.parse('2026-11-09T21:04:00-08:00');
const GATED = SENT + 2104;

const SECRET = {
  id: (n: number) => `7d0a4f3c-4c1a-4a4e-9d3e-${String(n).padStart(12, '0')}`,
  email: (n: number) => `secret-member-${n}@SECRET.example`,
  label: (n: number) => `m-SECRET${n}`,
  reason: 'SECRET_REASON No line in your rules covers this ask.',
  rules: 'SECRET_RULES Happy to talk about Postgres. Only with numbers.',
};
const FORBIDDEN_VALUES = [/SECRET/, /7d0a4f3c-4c1a/, /@SECRET/];
// `reason` appears once, legitimately: closed.reason, the ask's own close reason (checked below).
const FORBIDDEN_KEYS = ['member_id', 'email', 'label', 'cap', 'used', 'paused', 'paused_until', 'reason_code', 'no_reason', 'no_note', 'rules', 'latency_ms', 'ms', 'confidence', 'skip', 'na', 'city', 'model', 'gates_ran'];

const VIEW_KEYS = ['answer', 'as_of', 'cells', 'closed', 'compiled', 'gates_failed', 'id', 'intro', 'matched_line', 'network', 'next_checkpoint', 'no_match', 'offered', 'outcome', 'people_interrupted', 'questions', 'sent_at', 'subject', 'trace', 'withdrawn_at'];

const COMPILED: CompiledAsk = {
  parts: {
    challenge: '2 enterprise deals have sat in procurement for 5 months',
    tried: '14 buyer calls; 2 deals reached procurement',
    needs: 'someone who has closed a first enterprise deal through procurement',
    by: 'Nov 20',
    offers: 'our procurement checklist',
  },
  subject: 'Enterprise deals stuck 5 months, 20 min?',
  text: 'Selling staffing software to hospital groups, our first enterprise customers. 14 buyer calls; 2 deals have sat in procurement for 5 months.',
  price: null,
  topic: 'Enterprise sales, US',
};

const iso = (ms: number) => new Date(ms).toISOString();

function decision(position: number, verdict: Verdict | null, reason_code: ReasonCode | null, extra: Partial<SnapshotDecision> = {}): SnapshotDecision {
  return {
    position,
    attempt: 1,
    verdict,
    error_kind: verdict === null ? 'timeout' : null,
    reason_code,
    question_id: null,
    created_at: iso(SENT + 500 + position * 20),
    // everything below must never reach an asker
    member_id: SECRET.id(position),
    email: SECRET.email(position),
    label: SECRET.label(position),
    reason: SECRET.reason,
    rules: SECRET.rules,
    latency_ms: 1184,
    confidence: 0.91,
    cap: 2,
    used: 1,
    ...extra,
  };
}

function offer(position: number, cell: number, state: OfferState, offeredAt: number, respondedAt: number | null, extra: Partial<SnapshotOffer> = {}): SnapshotOffer {
  return {
    position,
    cell,
    state,
    offered_at: iso(offeredAt),
    expires_at: iso(offeredAt + 72 * H),
    responded_at: respondedAt === null ? null : iso(respondedAt),
    answer: null,
    matched: null,
    member_id: SECRET.id(cell),
    email: SECRET.email(cell),
    label: SECRET.label(cell),
    cap: 2,
    used: 2,
    paused_until: iso(SENT + 99 * H),
    no_reason: 'not_my_area',
    no_note: 'SECRET note',
    ...extra,
  };
}

/** Maya's ask: 40 members, 7 skipped by SQL, accepts at 3, 17, 25, a question at 8, declines elsewhere. */
function base(overrides: Partial<AskSnapshot['ask']> = {}, offers: SnapshotOffer[] = [offer(1, 17, 'pending', GATED, null)]): AskSnapshot {
  const skips: Record<number, string> = { 0: 'self', 5: 'at_cap', 9: 'at_cap', 12: 'paused', 21: 'repeat_pair', 30: 'at_cap', 38: 'paused' };
  const members = Array.from({ length: 40 }, (_, position) => ({ position, skip: skips[position] ?? null, member_id: SECRET.id(position), email: SECRET.email(position), cap: 2, used: 2 }));
  const decisions: SnapshotDecision[] = [];
  const codes: ReasonCode[] = ['topic', 'topic', 'no_rule', 'stage', 'topic', 'proof', 'region', 'topic', 'rule_says_no'];
  for (const m of members) {
    if (m.skip) continue;
    if (m.position === 3 || m.position === 17 || m.position === 25) decisions.push(decision(m.position, 'accept', 'match'));
    else if (m.position === 8) decisions.push(decision(m.position, 'ask_back', 'proof', { question_id: 'q_price1' }));
    else if (m.position === 33) decisions.push(decision(m.position, null, null));
    else decisions.push(decision(m.position, 'decline', codes[m.position % codes.length] as ReasonCode));
  }
  return {
    ask: {
      id: 'a_91xQ2k',
      subject: COMPILED.subject,
      compiled: { ...COMPILED, secret_field: 'SECRET compiled extra' } as unknown as CompiledAsk,
      status: 'open',
      close_reason: null,
      deadline: '2026-11-20',
      network_size: 40,
      created_at: iso(SENT - 60_000),
      sent_at: iso(SENT),
      gated_at: iso(GATED),
      closed_at: null,
      withdrawn_at: null,
      asker_id: SECRET.id(999),
      idempotency_key: 'SECRET key',
      ...overrides,
    },
    members,
    decisions,
    questions: [
      { id: 'q_price1', type: 'price', text: 'What do you charge per customer, per year?', gates: 1, answer: null, answered_at: null, created_at: iso(SENT + 700), member_id: SECRET.id(8) },
    ],
    offers,
    intro: null,
  };
}

/** Every key anywhere in a value. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

function assertNoLeak(view: AskerAskView) {
  expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
  const json = JSON.stringify(view);
  for (const re of FORBIDDEN_VALUES) expect(json).not.toMatch(re);
  const keys = keysDeep(view);
  for (const k of FORBIDDEN_KEYS) expect(keys.has(k)).toBe(false);
  for (const c of view.cells) expect(['offered', 'next', 'question', 'nothistime']).toContain(c);
  if (view.closed) expect(Object.keys(view.closed).sort()).toEqual(['at', 'offered_count', 'reason']);
  if (view.closed) expect(['all_passed', 'deadline', 'solved', 'answer_timeout', 'asker_closed']).toContain(view.closed.reason);
  if (view.offered) expect(Object.keys(view.offered).sort()).toEqual(['in_line', 'position', 'reply_by']);
  for (const q of view.questions) expect(Object.keys(q).sort()).toEqual(['answer', 'answered_at', 'gates', 'id', 'text', 'type']);
  if (view.no_match) {
    for (const [k, n] of Object.entries(view.no_match.why)) if (k !== 'other') expect(n).toBeGreaterThanOrEqual(3);
  }
}

describe('serializeForAsker: the fixtures', () => {
  const NOW = new Date('2026-11-10T15:30:00-08:00');

  it('an open ask: 4 states, the exact reply-by for the first holder, the 4-line trace, nothing else', () => {
    const view = serializeForAsker(base(), NOW);
    assertNoLeak(view);
    expect(view.outcome).toBe('offered');
    expect(view.offered).toEqual({ reply_by: iso(GATED + 72 * H), position: 1, in_line: 3 });
    expect(view.cells[17]).toBe('offered');
    expect(view.cells[3]).toBe('next');
    expect(view.cells[25]).toBe('next');
    expect(view.cells[8]).toBe('question');
    expect(view.cells.filter((c) => c === 'nothistime')).toHaveLength(36);
    expect(view.people_interrupted).toBe(1);
    expect(view.matched_line).toBeNull();
    expect(view.questions).toEqual([{ id: 'q_price1', type: 'price', text: 'What do you charge per customer, per year?', gates: 1, answer: null, answered_at: null }]);
    expect(view.compiled).toEqual(COMPILED);
    expect(view.as_of).toBe(iso(Date.parse('2026-11-10T09:00:00-08:00')));
    expect(view.next_checkpoint).toBe(iso(Date.parse('2026-11-10T21:00:00-08:00')));
    expect(view.trace).toEqual([
      '+0 ms     ask a_91xQ2k · compiled 5/5 · 22 words · REAL network · 40 members',
      '+2104 ms  gates done',
      '+2104 ms  offered to 1 person · reply window ends Thu Nov 12, 21:04 PT',
      '+2104 ms  people interrupted 1',
    ]);
    expect(askerStatusLine(view)).toBe('offered · reply by Thu Nov 12, 21:04 PT');
  });

  it('the line a member opted to show, as their own words at the offsets code found; never without the opt-in', () => {
    const rules = 'Happy to talk to B2B founders selling to enterprise customers in the US.';
    const shown = serializeForAsker(base({}, [offer(1, 17, 'pending', GATED, null, { matched: { rules, cited: [{ text: 'b2b founders selling to enterprise customers', found: true, start: 17, end: 61 }] } })]), NOW);
    expect(shown.matched_line).toBe('B2B founders selling to enterprise customers');
    const hidden = serializeForAsker(base(), NOW);
    expect(hidden.matched_line).toBeNull();
  });

  it('a pass and an expiry at the same instant read exactly the same, before and after their checkpoint', () => {
    const at = Date.parse('2026-11-10T11:13:00-08:00');
    const pass = base({}, [offer(1, 17, 'passed', GATED, at), offer(2, 3, 'pending', at, null)]);
    const expiry = base({}, [offer(1, 17, 'expired', GATED, at), offer(2, 3, 'pending', at, null)]);
    for (const now of [NOW, new Date('2026-11-10T21:00:01-08:00'), new Date('2026-11-12T08:00:00-08:00')]) {
      expect(serializeForAsker(pass, now)).toEqual(serializeForAsker(expiry, now));
    }
  });

  it('a No after the last checkpoint changes nothing until the next one; then the reply-by is rounded up to a checkpoint', () => {
    const passAt = Date.parse('2026-11-10T11:13:00-08:00');
    const moved = base({}, [offer(1, 17, 'passed', GATED, passAt), offer(2, 3, 'pending', passAt, null)]);
    expect(serializeForAsker(moved, NOW)).toEqual(serializeForAsker(base(), NOW));
    const after = serializeForAsker(moved, new Date('2026-11-10T21:00:00-08:00'));
    assertNoLeak(after);
    expect(after.offered).toEqual({ reply_by: iso(Date.parse('2026-11-13T21:00:00-08:00')), position: 2, in_line: 3 });
    expect(isCheckpoint(after.offered!.reply_by)).toBe(true);
    expect(after.cells[17]).toBe('nothistime');
    expect(after.cells[3]).toBe('offered');
    expect(after.people_interrupted).toBe(2);
    expect(askerStatusLine(after)).toBe('offered to the next person in line (2 of 3) · reply by Fri Nov 13, 21:00 PT');
  });

  it('a 2-line answer shows at its checkpoint, stamped with that checkpoint, without the member’s name', () => {
    const at = Date.parse('2026-11-10T10:02:00-08:00');
    const snap = base({ status: 'answered' }, [offer(1, 17, 'answered', GATED, at, { answer: 'Ask for the technical annex first.' })]);
    const before = serializeForAsker(snap, new Date('2026-11-10T20:59:59-08:00'));
    expect(before.outcome).toBe('offered');
    expect(before.answer).toBeNull();
    const after = serializeForAsker(snap, new Date('2026-11-10T21:00:00-08:00'));
    assertNoLeak(after);
    expect(after.outcome).toBe('answered');
    expect(after.answer).toEqual({ text: 'Ask for the technical annex first.', at: iso(Date.parse('2026-11-10T21:00:00-08:00')) });
  });

  it('intro made shows at once, with the name, the one line and the scheduling link', () => {
    const at = Date.parse('2026-11-10T11:16:00-08:00');
    const snap = base({ status: 'intro' }, [offer(1, 17, 'ok', GATED, at)]);
    snap.intro = { member_name: 'Priya Shah', member_line: 'Closed the first 20 enterprise customers at a healthcare software company.', scheduling_url: 'https://cal.com/priya-shah/20min', sent_at: iso(at + 900), created_at: iso(at), member_id: SECRET.id(17), email: SECRET.email(17) };
    const view = serializeForAsker(snap, new Date(at + 60_000));
    assertNoLeak(view);
    expect(view.outcome).toBe('intro');
    expect(view.intro).toEqual({ member_name: 'Priya Shah', member_line: 'Closed the first 20 enterprise customers at a healthcare software company.', sent_at: iso(at + 900), scheduling_url: 'https://cal.com/priya-shah/20min' });
    expect(view.cells.filter((c) => c === 'offered')).toEqual(['offered']);
    expect(view.cells.filter((c) => c === 'next')).toHaveLength(0);
  });

  it('intro made settles the whole line at once, even when the No before it is not due to show yet', () => {
    const passAt = Date.parse('2026-11-10T11:00:00-08:00');
    const okAt = Date.parse('2026-11-10T11:30:00-08:00');
    const snap = base({ status: 'intro' }, [offer(1, 17, 'passed', GATED, passAt), offer(2, 3, 'ok', passAt, okAt)]);
    snap.intro = { member_name: 'Priya Shah', member_line: 'x', scheduling_url: null, sent_at: iso(okAt + 800), created_at: iso(okAt) };
    const view = serializeForAsker(snap, new Date(okAt + 1000));
    expect(view.people_interrupted).toBe(2);
    expect(view.cells[3]).toBe('offered');
    expect(view.cells[17]).toBe('nothistime');
    expect(view.intro?.sent_at).toBe(iso(okAt + 800));
  });

  it('an OK whose intro email has not gone out yet reads as the offer still waiting: no intro, no name', () => {
    const okAt = Date.parse('2026-11-10T11:16:00-08:00');
    const snap = base({ status: 'intro' }, [offer(1, 17, 'ok', GATED, okAt)]);
    snap.intro = { member_name: 'Priya Shah', member_line: 'Closed the first 20 enterprise customers at a healthcare software company.', scheduling_url: null, sent_at: null, created_at: iso(okAt) };
    for (const at of [okAt + 1000, Date.parse('2026-11-10T21:00:01-08:00'), okAt + 80 * 3_600_000]) {
      const view = serializeForAsker(snap, new Date(at));
      assertNoLeak(view);
      expect(view.outcome).toBe('offered');
      expect(view.intro).toBeNull();
      expect(view.offered).toMatchObject({ position: 1 });
      expect(JSON.stringify(view)).not.toContain('Priya');
    }
    // The moment the email is out, the intro shows (at once, not at a checkpoint).
    const sent = { ...snap, intro: { ...snap.intro, sent_at: iso(okAt + 5 * 60_000) } };
    const view = serializeForAsker(sent, new Date(okAt + 5 * 60_000 + 1000));
    expect(view.outcome).toBe('intro');
    expect(view.intro).toMatchObject({ member_name: 'Priya Shah', sent_at: iso(okAt + 5 * 60_000) });
  });

  it('no match: coarse reasons over the whole network, buckets under 3 and SQL skips folded into other', () => {
    const snap = base({ status: 'no_match', closed_at: iso(GATED) }, []);
    snap.decisions = snap.decisions.map((d) => ({ ...d, verdict: d.verdict === null ? null : 'decline', reason_code: d.reason_code === 'match' ? 'topic' : d.reason_code, question_id: null }));
    snap.questions = [];
    const view = serializeForAsker(snap, NOW);
    assertNoLeak(view);
    expect(view.outcome).toBe('no_match');
    const why = view.no_match!.why;
    expect(Object.values(why).reduce((a, b) => a + (b ?? 0), 0)).toBe(40);
    expect(why.other).toBeGreaterThanOrEqual(7); // the 7 SQL skips and the failed gate are in other
    expect(view.no_match!.suggestion).toBeNull();
    expect(view.cells.every((c) => c === 'nothistime')).toBe(true);
  });

  it('fewer than 3 gates ran: no reasons at all', () => {
    const snap = base({ status: 'no_match', network_size: 4 }, []);
    snap.members = [0, 1, 2, 3].map((position) => ({ position, skip: position < 2 ? 'at_cap' : null }));
    snap.decisions = [decision(2, 'decline', 'stage'), decision(3, 'decline', 'stage')];
    snap.questions = [];
    expect(serializeForAsker(snap, NOW).no_match).toEqual({ why: { other: 4 }, suggestion: null });
  });

  it('closed after everyone passed: the time is the checkpoint it became visible at', () => {
    const p1 = Date.parse('2026-11-10T10:00:00-08:00');
    const p2 = Date.parse('2026-11-10T13:00:00-08:00');
    const snap = base({ status: 'closed', close_reason: 'all_passed', closed_at: iso(p2) }, [offer(1, 17, 'passed', GATED, p1), offer(2, 3, 'passed', p1, p2), offer(3, 25, 'expired', p2, p2)]);
    const before = serializeForAsker(snap, NOW);
    expect(before.outcome).toBe('offered');
    expect(before.offered?.position).toBe(1);
    const after = serializeForAsker(snap, new Date('2026-11-10T21:00:00-08:00'));
    assertNoLeak(after);
    expect(after.closed).toEqual({ reason: 'all_passed', offered_count: 3, at: iso(Date.parse('2026-11-10T21:00:00-08:00')) });
    expect(after.cells.every((c) => c === 'nothistime')).toBe(true);
  });

  it('withdrawn: the asker’s own action, exact and at once', () => {
    const w = Date.parse('2026-11-10T12:00:00-08:00');
    const view = serializeForAsker(base({ status: 'withdrawn', withdrawn_at: iso(w) }, [offer(1, 17, 'withdrawn', GATED, w)]), new Date(w + 1));
    assertNoLeak(view);
    expect(view.outcome).toBe('withdrawn');
    expect(view.withdrawn_at).toBe(iso(w));
    expect(view.cells.every((c) => c === 'nothistime')).toBe(true);
  });

  it('while gating: accepts and questions show as they land, everything else (pending, declined or skipped) reads the same', () => {
    const snap = base({ status: 'gating', gated_at: null }, []);
    snap.decisions = snap.decisions.filter((d) => d.position < 20);
    const view = serializeForAsker(snap, new Date(SENT + 1000));
    assertNoLeak(view);
    expect(view.outcome).toBe('gating');
    expect(view.cells[3]).toBe('next');
    expect(view.cells[8]).toBe('question');
    expect(view.cells[25]).toBe('nothistime'); // not answered yet: indistinguishable from a decline or a skip
    expect(view.cells[5]).toBe('nothistime'); // skipped at cap
    expect(view.trace).toEqual(['+0 ms     ask a_91xQ2k · compiled 5/5 · 22 words · REAL network · 40 members']);
  });
});

/* ========================================================================== *
 * Property tests over simulated histories
 * ========================================================================== */

interface History {
  size: number;
  members: { position: number; skip: string | null }[];
  decisions: SnapshotDecision[];
  questions: AskSnapshot['questions'];
  /** The offer chain: each with its response (or none). */
  chain: { cell: number; offeredAt: number; state: OfferState; respondedAt: number | null; answer: string | null }[];
  closeAt: number | null;
}

function simulate(seed: number): History {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
  const size = Math.floor(r() * 46);
  const members = Array.from({ length: size }, (_, position) => ({ position, skip: r() < 0.2 ? pick(['self', 'paused', 'at_cap', 'repeat_pair']) : null }));
  const decisions: SnapshotDecision[] = [];
  const accepts: number[] = [];
  let askBack = false;
  for (const m of members) {
    if (m.skip) continue;
    const v = r();
    if (v < 0.15) {
      decisions.push(decision(m.position, 'accept', 'match'));
      accepts.push(m.position);
    } else if (v < 0.2) {
      decisions.push(decision(m.position, 'ask_back', 'proof', { question_id: 'q_rand1' }));
      askBack = true;
    } else if (v < 0.25) decisions.push(decision(m.position, null, null));
    else decisions.push(decision(m.position, 'decline', pick(['topic', 'stage', 'proof', 'region', 'no_rule', 'rule_says_no'] as ReasonCode[])));
  }
  const questions: AskSnapshot['questions'] = askBack ? [{ id: 'q_rand1', type: 'deal_size', text: 'How large is the contract, per year?', gates: 1, answer: null, answered_at: null, created_at: iso(SENT + 600) }] : [];
  // shuffle the line
  for (let i = accepts.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [accepts[i], accepts[j]] = [accepts[j] as number, accepts[i] as number];
  }
  const chain: History['chain'] = [];
  let t = GATED;
  let closeAt: number | null = null;
  for (let k = 0; k < accepts.length; k++) {
    const offeredAt = t;
    const last = k === accepts.length - 1;
    const roll = r();
    if (roll < 0.15 && k > 0) {
      chain.push({ cell: accepts[k] as number, offeredAt, state: 'pending', respondedAt: null, answer: null });
      break;
    }
    const wait = Math.floor(r() * 80 * H);
    if (wait >= 72 * H) {
      chain.push({ cell: accepts[k] as number, offeredAt, state: 'expired', respondedAt: offeredAt + 72 * H, answer: null });
      t = offeredAt + 72 * H;
    } else {
      const final = roll < 0.25 ? 'answered' : 'passed';
      chain.push({ cell: accepts[k] as number, offeredAt, state: final, respondedAt: offeredAt + wait, answer: final === 'answered' ? 'Two short lines.' : null });
      t = offeredAt + wait;
      if (final === 'answered') break;
    }
    if (last && !askBack) closeAt = t;
  }
  return { size, members, decisions, questions, chain, closeAt };
}

/** The ask as the database would hold it at instant `t` (only member-side events after the send). */
function snapshotAt(h: History, t: number): AskSnapshot {
  const offers: SnapshotOffer[] = [];
  h.chain.forEach((o, i) => {
    if (o.offeredAt > t) return;
    const responded = o.respondedAt !== null && o.respondedAt <= t;
    offers.push(offer(i + 1, o.cell, responded ? o.state : 'pending', o.offeredAt, responded ? o.respondedAt : null, { answer: responded ? o.answer : null }));
  });
  const last = offers[offers.length - 1];
  let status: AskSnapshot['ask']['status'] = 'open';
  if (!h.chain.length) status = h.questions.length ? 'open' : 'no_match';
  else if (last?.state === 'answered') status = 'answered';
  else if (h.closeAt !== null && h.closeAt <= t) status = 'closed';
  const snap = base({ status, network_size: h.size, close_reason: status === 'closed' ? 'all_passed' : null, closed_at: status === 'closed' ? iso(h.closeAt as number) : status === 'no_match' ? iso(GATED) : null }, offers);
  snap.members = h.members;
  snap.decisions = h.decisions;
  snap.questions = h.questions;
  return snap;
}

describe('serializeForAsker: properties over 400 simulated histories', () => {
  const seeds = Array.from({ length: 400 }, (_, i) => 1_000 + i * 7919);

  it('never leaks, never emits a fifth state, and every member-side time it shows is a checkpoint', () => {
    for (const seed of seeds) {
      const h = simulate(seed);
      const r = rng(seed ^ 0x5bd1e995);
      for (let k = 0; k < 4; k++) {
        const now = GATED + Math.floor(r() * 12 * 24 * H);
        const view = serializeForAsker(snapshotAt(h, now), new Date(now));
        assertNoLeak(view);
        expect(view.cells).toHaveLength(h.size);
        expect(view.people_interrupted).toBeLessThanOrEqual(h.chain.length);
        if (view.offered && view.offered.position > 1) expect(isCheckpoint(view.offered.reply_by)).toBe(true);
        if (view.answer) expect(isCheckpoint(view.answer.at)).toBe(true);
        if (view.closed) expect(isCheckpoint(view.closed.at)).toBe(true);
        if (view.no_match) expect(Object.values(view.no_match.why).reduce((a, b) => a + (b ?? 0), 0)).toBe(h.size);
      }
    }
  });

  it('what members did after the last checkpoint is invisible: the view equals the view of the ask as it stood at that checkpoint', () => {
    let compared = 0;
    for (const seed of seeds) {
      const h = simulate(seed);
      const r = rng(seed ^ 0x2545f491);
      for (let k = 0; k < 6; k++) {
        const now = GATED + Math.floor(r() * 10 * 24 * H);
        const cp = lastCheckpoint(now).getTime();
        if (cp <= GATED) continue;
        const atNow = serializeForAsker(snapshotAt(h, now), new Date(now));
        const atCheckpoint = serializeForAsker(snapshotAt(h, cp), new Date(now));
        expect(atNow).toEqual(atCheckpoint);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(1500);
  });

  it('a pass and an expiry at the same instant are indistinguishable at every moment', () => {
    for (const seed of seeds.slice(0, 200)) {
      const h = simulate(seed);
      const flipped: History = { ...h, chain: h.chain.map((o) => (o.state === 'passed' ? { ...o, state: 'expired' as const } : o.state === 'expired' ? { ...o, state: 'passed' as const } : o)) };
      const r = rng(seed ^ 0x68e31da4);
      for (let k = 0; k < 4; k++) {
        const now = new Date(GATED + Math.floor(r() * 12 * 24 * H));
        expect(serializeForAsker(snapshotAt(flipped, now.getTime()), now)).toEqual(serializeForAsker(snapshotAt(h, now.getTime()), now));
      }
    }
  });

  it('the view changes only at checkpoints between member events (no minute-level timing)', () => {
    for (const seed of seeds.slice(0, 120)) {
      const h = simulate(seed);
      const r = rng(seed ^ 0x1b873593);
      const start = GATED + Math.floor(r() * 6 * 24 * H);
      const cp = nextCheckpoint(start).getTime();
      // two instants inside the same checkpoint window give the same view (as_of/next_checkpoint included)
      const a = start + Math.floor(r() * (cp - start));
      const b = start + Math.floor(r() * (cp - start));
      if (lastCheckpoint(a).getTime() !== lastCheckpoint(b).getTime()) continue;
      expect(serializeForAsker(snapshotAt(h, b), new Date(b))).toEqual(serializeForAsker(snapshotAt(h, a), new Date(a)));
    }
  });
});

describe('checkpoints', () => {
  it('ceilCheckpoint rounds up to 09:00 or 21:00 Pacific time (PT) and keeps exact checkpoints', () => {
    expect(ceilCheckpoint('2026-11-10T09:00:00-08:00').toISOString()).toBe(iso(Date.parse('2026-11-10T09:00:00-08:00')));
    expect(ceilCheckpoint('2026-11-10T09:00:00.001-08:00').toISOString()).toBe(iso(Date.parse('2026-11-10T21:00:00-08:00')));
    expect(ceilCheckpoint('2026-11-10T22:15:00-08:00').toISOString()).toBe(iso(Date.parse('2026-11-11T09:00:00-08:00')));
    expect(ceilCheckpoint('2026-12-31T23:59:00-08:00').toISOString()).toBe(iso(Date.parse('2027-01-01T09:00:00-08:00')));
    expect(isCheckpoint('2026-11-10T21:00:00-08:00')).toBe(true);
    expect(isCheckpoint('2026-11-10T21:00:01-08:00')).toBe(false);
  });
});
