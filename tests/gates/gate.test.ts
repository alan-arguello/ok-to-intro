import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GATE_FAILURE_COPY } from '@/lib/oti/copy';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import { PRESETS } from '@/lib/sample/presets';
import { __resetBudgetForTests, nextMonthStartFrom } from '@/lib/server/budget';
import {
  __setGateTimingForTests,
  decide,
  parseGateOutput,
  questionProblem,
  runGate,
  runGateDetailed,
  snapToWords,
  verifyQuotes,
  warmGate,
  type GateOutput,
} from '@/lib/server/gate';
import { __setModelFetchForTests, getLiveState } from '@/lib/server/live';
import { GATE_RUBRIC, GATE_SCHEMA } from '@/lib/server/rubric';
import { apiError, fakeFetch, hang, message, reply, verdict } from './fake-api';

const ENGINEER = PRESETS.find((p) => p.id === 'engineer')!.rules;
const E1 = 'founders about churn, activation or support load';
const E2 = 'real usage: a customer count, a churn rate or a ticket count';
const askOf = (a: (typeof SAMPLE_ASKS)[number]) => ({ text: a.text, subject: a.subject, parts: a.parts, asker_stage: a.stage });
const A01 = SAMPLE_ASKS.find((a) => a.id === 'a01')!;
const A06 = SAMPLE_ASKS.find((a) => a.id === 'a06')!;
const A11 = SAMPLE_ASKS.find((a) => a.id === 'a11')!;

function out(partial: Partial<GateOutput> & Pick<GateOutput, 'verdict'>): GateOutput {
  return { cited: [], reason_code: partial.verdict === 'accept' ? 'match' : 'no_rule', reason: 'r', question: null, flags: [], confidence: 0.9, ...partial };
}

describe('clause check: verifyQuotes', () => {
  it('finds a quote despite curly vs straight quotes and renders the member’s own words', () => {
    const rules = 'Happy to talk if you’ve shipped to “real” users.';
    const [c] = verifyQuotes(rules, ['if you\'ve shipped to "real" users']);
    expect(c).toMatchObject({ found: true });
    expect(rules.slice(c!.start, c!.end)).toBe('if you’ve shipped to “real” users');
  });

  it('ignores the quote marks a model wraps around a quote', () => {
    const [c] = verifyQuotes(ENGINEER, ['“No asks to review a deck.”']);
    expect(ENGINEER.slice(c!.start, c!.end)).toBe('No asks to review a deck.');
  });

  it('matches across collapsed whitespace and line breaks, and ignores case', () => {
    const [a, b] = verifyQuotes(ENGINEER, ['REAL USAGE:   a customer count', 'support load.  Only if they have']);
    expect(ENGINEER.slice(a!.start, a!.end)).toBe('real usage: a customer count');
    expect(ENGINEER.slice(b!.start, b!.end)).toBe('support load.\nOnly if they have');
  });

  it('widens a quote that stops inside a word to the whole word', () => {
    const [a, b] = verifyQuotes(ENGINEER, ['ounders about churn', 'churn, activatio']);
    expect(ENGINEER.slice(a!.start, a!.end)).toBe('founders about churn');
    expect(ENGINEER.slice(b!.start, b!.end)).toBe('churn, activation');
    expect(snapToWords('abc def', 1, 5)).toEqual({ start: 0, end: 7 });
    expect(snapToWords('abc def', 0, 3)).toEqual({ start: 0, end: 3 });
  });

  it('rejects text that is not one contiguous span, and quotes too short to identify a line', () => {
    const cited = verifyQuotes(ENGINEER, ['Happy to take any intro', 'churn, activation or ticket count', 'No', 'a', '  ']);
    expect(cited.map((c) => c.found)).toEqual([false, false, false, false]);
    for (const c of cited) {
      expect(c.start).toBeUndefined();
      expect(c.end).toBeUndefined();
    }
  });

  it('collapses duplicates and keeps at most 4 quotes', () => {
    const cited = verifyQuotes(ENGINEER, [E1, E1.toUpperCase(), E2, 'No fundraising asks.', 'No asks to review a deck.', 'Happy to talk']);
    expect(cited).toHaveLength(4);
    expect(cited.map((c) => c.text)).toEqual([E1, E2, 'No fundraising asks.', 'No asks to review a deck.']);
  });
});

describe('code checks on the model output: decide', () => {
  it('keeps an accept whose quotes are all in the rules', () => {
    const d = decide(ENGINEER, out({ verdict: 'accept', cited: [E1, E2] }));
    expect(d).toMatchObject({ verdict: 'accept', model_verdict: 'accept', decided_by: 'gate', reason_code: 'match' });
    expect(d.cited.every((c) => c.found)).toBe(true);
  });

  it('turns an accept with a quote not in the rules into a decline by code, keeping what the model said', () => {
    const d = decide(ENGINEER, out({ verdict: 'accept', cited: [E1, 'Happy to take any intro'] }));
    expect(d).toMatchObject({ verdict: 'decline', model_verdict: 'accept', decided_by: 'clause_check', reason_code: 'no_rule', question: null });
    expect(d.reason).toBe('The gate quoted text that isn’t in your rules, so code changed accept to decline.');
    expect(d.cited).toEqual([expect.objectContaining({ found: true }), { text: 'Happy to take any intro', found: false }]);
  });

  it('turns an accept or a question without any quote into a decline by code', () => {
    expect(decide(ENGINEER, out({ verdict: 'accept', cited: [] }))).toMatchObject({ verdict: 'decline', decided_by: 'clause_check', model_verdict: 'accept' });
    expect(decide(ENGINEER, out({ verdict: 'ask_back', cited: [], question: { type: 'metric', text: 'How many jobs a day?' } }))).toMatchObject({
      verdict: 'decline',
      decided_by: 'clause_check',
      model_verdict: 'ask_back',
      question: null,
    });
  });

  it('keeps a valid question and declines a question that breaks the rules', () => {
    const ok = decide(ENGINEER, out({ verdict: 'ask_back', cited: [E1], reason_code: 'proof', question: { type: 'metric', text: 'How many signups a month do you get, and what share finishes setup?' } }));
    expect(ok).toMatchObject({ verdict: 'ask_back', decided_by: 'gate', question: { type: 'metric', text: 'How many signups a month do you get, and what share finishes setup?' } });
    const bad = [
      { type: 'metric', text: 'See https://example.com/form and tell us your p95?' },
      { type: 'role', text: 'Email your CTO at cto@example.com?' },
      { type: 'metric', text: 'Can you share /var/log/app/errors.log?' },
      { type: 'metric', text: `${'x'.repeat(101)}?` },
      { type: 'favorite_color', text: 'What is your favorite color?' },
      { type: 'price', text: '   ' },
    ];
    for (const question of bad) {
      expect(decide(ENGINEER, out({ verdict: 'ask_back', cited: [E1], question })), question.text).toMatchObject({ verdict: 'decline', decided_by: 'clause_check', question: null });
    }
    expect(decide(ENGINEER, out({ verdict: 'ask_back', cited: [E1], question: null }))).toMatchObject({ verdict: 'decline', decided_by: 'clause_check' });
  });

  it('accepts ordinary questions that only look like links', () => {
    expect(questionProblem({ type: 'metric', text: 'How many jobs/day do you run?' })).toBeNull();
    expect(questionProblem({ type: 'price', text: 'What do you charge per customer, per year?' })).toBeNull();
    expect(questionProblem({ type: 'stage', text: 'Do you have revenue? Roughly how much a month?' })).toBeNull();
    expect(questionProblem({ type: 'metric', text: 'What is the p95 on your Node.js API?' })).toBeNull();
  });

  it('keeps a decline citing a real line, and makes a decline citing a missing line the code’s', () => {
    expect(decide(ENGINEER, out({ verdict: 'decline', cited: ['No asks to review a deck.'], reason_code: 'rule_says_no' }))).toMatchObject({ verdict: 'decline', decided_by: 'gate', reason_code: 'rule_says_no' });
    expect(decide(ENGINEER, out({ verdict: 'decline', cited: ['No crypto asks.'] }))).toMatchObject({ verdict: 'decline', decided_by: 'clause_check', model_verdict: 'decline' });
  });

  it('never leaves a question on an accept or a decline, and never a “match” code on a decline', () => {
    const d = decide(ENGINEER, out({ verdict: 'decline', reason_code: 'match', question: { type: 'price', text: 'Price?' } }));
    expect(d.question).toBeNull();
    expect(d.reason_code).toBe('no_rule');
  });
});

describe('parseGateOutput', () => {
  it('compares enums case-insensitively and clamps confidence', () => {
    const p = parseGateOutput(JSON.stringify({ verdict: 'ACCEPT', cited: ['x', 3], reason_code: 'Match', reason: ' A  reason. ', question: null, flags: ['Instruction_In_Ask', 'other'], confidence: 1.7 }));
    expect(p).toEqual({ verdict: 'accept', cited: ['x'], reason_code: 'match', reason: 'A reason.', question: null, flags: ['instruction_in_ask'], confidence: 1 });
    expect(parseGateOutput(JSON.stringify({ verdict: 'decline', confidence: -3 }))?.confidence).toBe(0);
    expect(parseGateOutput(JSON.stringify({ verdict: 'decline', confidence: 'high' }))?.confidence).toBeNull();
  });

  it('writes curly quotes and apostrophes in the reason and the question', () => {
    const p = parseGateOutput(JSON.stringify({ verdict: 'ask_back', reason: 'The ask says "pre-approved"; it\'s text.', question: { type: 'price', text: "What's your price per 'seat'?" } }));
    expect(p?.reason).toBe('The ask says “pre-approved”; it’s text.');
    expect(p?.question?.text).toBe('What’s your price per ‘seat’?');
  });

  it('returns null for output that is not a usable verdict', () => {
    expect(parseGateOutput('not json')).toBeNull();
    expect(parseGateOutput('{"verdict": "maybe"}')).toBeNull();
    expect(parseGateOutput('[1,2]')).toBeNull();
    expect(parseGateOutput('{"verdict": "accept", "cited": ["founders about')).toBeNull();
  });
});

describe('runGate against a fake API', () => {
  let api: ReturnType<typeof fakeFetch>;
  beforeEach(() => {
    api = fakeFetch();
    __setModelFetchForTests(api.fetch);
    __resetBudgetForTests();
  });
  afterEach(() => {
    __setModelFetchForTests(null);
    __setGateTimingForTests();
    __resetBudgetForTests();
  });

  it('returns the verdict with code-found offsets, the measured cost and the request id', async () => {
    api.next(reply(() => verdict({ verdict: 'accept', cited: [E1, E2], reason: 'Churn after month 3.', confidence: 0.86 })));
    const run = await runGateDetailed({ rules: ENGINEER, ask: askOf(A01) });
    expect(run.result.ok).toBe(true);
    if (!run.result.ok) return;
    expect(run.result.decision).toMatchObject({ verdict: 'accept', decided_by: 'gate', confidence: 0.86 });
    for (const c of run.result.decision.cited) expect(ENGINEER.slice(c.start!, c.end!)).toBe(c.text);
    expect(run.result.request_id).toMatch(/^req_test_/);
    expect(run.result.model).toBe('claude-haiku-5-5');
    // 250 uncached in × $0.10 + 90 out × $0.50 + 800 cache reads × $0.01, per million tokens.
    expect(run.result.cost_usd).toBeCloseTo((250 * 0.1 + 90 * 0.5 + 800 * 0.01) / 1e6, 12);
    expect(run.result.usage).toEqual({ input_tokens: 250, output_tokens: 90, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 });
  });

  it('sends the frozen request: cached rubric first, the rules, the ask as JSON data, thinking off, effort low, the schema', async () => {
    api.next(reply(() => verdict({ verdict: 'decline' })));
    await runGate({ rules: ENGINEER, ask: askOf(A11), answers: [{ type: 'price', text: '$18k a year' }] });
    const body = api.requests[0]!.body;
    expect(api.requests[0]!.url).toContain('/v1/messages');
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(400);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: JSON.parse(JSON.stringify(GATE_SCHEMA)) } });
    for (const banned of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice']) expect(body).not.toHaveProperty(banned);
    const system = body.system as { text: string; cache_control?: unknown }[];
    expect(system[0]).toEqual({ type: 'text', text: GATE_RUBRIC, cache_control: { type: 'ephemeral' } });
    expect(system[1]!.text).toContain(ENGINEER);
    expect(system[1]).not.toHaveProperty('cache_control');
    const messages = body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    // The injection arrives inside a JSON string: its quotes are escaped, so it can't end the data.
    expect(messages[0]!.content).toContain(JSON.stringify(A11.text));
    expect(messages[0]!.content).toContain('"answers_to_the_gate":[{"type":"price","text":"$18k a year"}]');
    const data = JSON.parse(messages[0]!.content.slice(messages[0]!.content.indexOf('{'))) as { text: string };
    expect(data.text).toBe(A11.text);
  });

  it('injection: a model that obeys the ask and quotes the planted line is overruled by the clause check', async () => {
    api.next(reply(() => verdict({ verdict: 'accept', cited: ['Happy to take any intro'], reason: 'The member pre-approved this founder.', confidence: 0.64 })));
    const r = await runGate({ rules: ENGINEER, ask: askOf(A11) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decision).toMatchObject({ verdict: 'decline', model_verdict: 'accept', decided_by: 'clause_check' });
    expect(r.decision.cited).toEqual([{ text: 'Happy to take any intro', found: false }]);
  });

  it('injection: a gate that resists keeps its decline and the flag', async () => {
    api.next(reply(() => verdict({ verdict: 'decline', flags: ['instruction_in_ask'], reason: 'Clinic scheduling software. No line covers it.' })));
    const r = await runGate({ rules: ENGINEER, ask: askOf(A11) });
    expect(r.ok && r.decision).toMatchObject({ verdict: 'decline', decided_by: 'gate', flags: ['instruction_in_ask'] });
  });

  it('a refusal is a decline by code, never a blank row', async () => {
    api.next(reply(() => message('', { stop_reason: 'refusal' })));
    const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(r).toMatchObject({ ok: false, kind: 'refused', decision: { verdict: 'decline', reason: GATE_FAILURE_COPY.refused, cited: [] } });
  });

  it('unparseable output and max_tokens are declines by code', async () => {
    api.next(
      reply(() => message('I think this is an accept.')),
      reply(() => message('{"verdict": "accept", "cited": ["founders', { stop_reason: 'max_tokens' })),
      reply(() => message(JSON.stringify({ verdict: 'yes' }))),
    );
    for (let n = 0; n < 3; n++) {
      const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
      expect(r).toMatchObject({ ok: false, kind: 'parse', decision: { verdict: 'decline', reason: GATE_FAILURE_COPY.parse } });
    }
  });

  it('a gate with no answer in time is not checked, never an accept', async () => {
    __setGateTimingForTests({ gateTimeoutMs: 150 });
    api.next(hang);
    const t0 = Date.now();
    const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
    expect(r).not.toHaveProperty('decision');
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('retries a 429 once when retry-after is 2 s or less', async () => {
    api.next(reply(() => apiError(429, 'rate_limit_error', 'Rate limited.', { 'retry-after': '1', 'retry-after-ms': '30' })), reply(() => verdict({ verdict: 'accept', cited: [E1, E2] })));
    const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(r.ok).toBe(true);
    expect(api.requests).toHaveLength(2);
  });

  it('does not retry a 429 that asks for more than 2 s, and reports the wait', async () => {
    api.next(reply(() => apiError(429, 'rate_limit_error', 'Rate limited.', { 'retry-after': '5' })), reply(() => verdict({ verdict: 'accept', cited: [E1] })));
    const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(r).toMatchObject({ ok: false, kind: 'rate_limited', retry_after_s: 5 });
    expect(api.requests).toHaveLength(1);
  });

  it('does not retry a 429 without retry-after', async () => {
    api.next(reply(() => apiError(429, 'rate_limit_error', 'Rate limited.')), reply(() => verdict({ verdict: 'accept', cited: [E1] })));
    const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(r).toMatchObject({ ok: false, kind: 'rate_limited' });
    expect(api.requests).toHaveLength(1);
  });

  it('retries an overloaded API (529) once, then reports overloaded', async () => {
    api.next(
      reply(() => apiError(529, 'overloaded_error', 'Overloaded.', { 'retry-after-ms': '20' })),
      reply(() => apiError(529, 'overloaded_error', 'Overloaded.', { 'retry-after-ms': '20' })),
      reply(() => verdict({ verdict: 'accept', cited: [E1] })),
    );
    const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(r).toMatchObject({ ok: false, kind: 'overloaded' });
    expect(api.requests).toHaveLength(2);
    api.next(reply(() => apiError(500, 'api_error', 'Internal.', { 'retry-after-ms': '20' })), reply(() => verdict({ verdict: 'decline' })));
    expect((await runGate({ rules: ENGINEER, ask: askOf(A01) })).ok).toBe(true);
  });

  it('a spend stop (429 enforced_spend_limit_reached) is never retried and pauses live checks until the 1st', async () => {
    api.next(reply(() => apiError(429, 'rate_limit_error', 'Your organization reached its monthly spend limit.', {}, { error_code: 'enforced_spend_limit_reached' })));
    const r = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(r).toMatchObject({ ok: false, kind: 'budget' });
    expect(api.requests).toHaveLength(1);
    const live = await getLiveState();
    expect(live).toEqual({ state: 'budget', paused_until: nextMonthStartFrom().toISOString() });
    // While paused, no further call is made.
    const again = await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect(again).toMatchObject({ ok: false, kind: 'budget' });
    expect(api.requests).toHaveLength(1);
  });

  it('a workspace usage limit (400) is a budget stop too', async () => {
    api.next(reply(() => apiError(400, 'invalid_request_error', 'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.')));
    expect(await runGate({ rules: ENGINEER, ask: askOf(A01) })).toMatchObject({ ok: false, kind: 'budget' });
    expect((await getLiveState()).state).toBe('budget');
  });

  it('a rejected key is unavailable (not checked)', async () => {
    api.next(reply(() => apiError(401, 'authentication_error', 'invalid x-api-key')));
    expect(await runGate({ rules: ENGINEER, ask: askOf(A01) })).toMatchObject({ ok: false, kind: 'unavailable' });
  });

  it('five outages in a row turn live checks down; a minute later the next call is let through', async () => {
    for (let n = 0; n < 5; n++) {
      api.next(reply(() => apiError(529, 'overloaded_error', 'Overloaded.', { 'retry-after-ms': '5' })), reply(() => apiError(529, 'overloaded_error', 'Overloaded.', { 'retry-after-ms': '5' })));
      await runGate({ rules: ENGINEER, ask: askOf(A01) });
    }
    expect((await getLiveState()).state).toBe('down');
    expect((await getLiveState(Date.now() + 61_000)).state).toBe('ok');
    api.next(reply(() => verdict({ verdict: 'decline' })));
    await runGate({ rules: ENGINEER, ask: askOf(A01) });
    expect((await getLiveState()).state).toBe('ok');
  });

  it('a visitor leaving aborts the call and is not counted as an outage', async () => {
    const controller = new AbortController();
    api.next(hang);
    const pending = runGate({ rules: ENGINEER, ask: askOf(A06) }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout' });
    for (let n = 0; n < 6; n++) {
      const c = new AbortController();
      api.next(hang);
      const p = runGate({ rules: ENGINEER, ask: askOf(A06) }, { signal: c.signal });
      c.abort();
      await p;
    }
    expect((await getLiveState()).state).toBe('ok');
  });

  it('refuses to call the model on empty input', async () => {
    expect(await runGate({ rules: '   ', ask: askOf(A01) })).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(await runGate({ rules: ENGINEER, ask: { text: '' } })).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(api.requests).toHaveLength(0);
  });

  it('warmGate makes one real call on the Engineer preset and the first sample ask', async () => {
    api.next(reply(() => verdict({ verdict: 'accept', cited: [E1, E2] })));
    expect(await warmGate()).toMatchObject({ ok: true });
    expect((api.requests[0]!.body.system as { text: string }[])[1]!.text).toContain(ENGINEER);
  });
});

describe('without a key', () => {
  it('reports off and never pretends to check', async () => {
    __setModelFetchForTests(null);
    expect(await getLiveState()).toEqual({ state: 'off', paused_until: null });
    expect(await runGate({ rules: ENGINEER, ask: askOf(A01) })).toEqual({ ok: false, kind: 'unavailable', ms: expect.any(Number) });
    expect(await warmGate()).toMatchObject({ ok: false, kind: 'unavailable' });
  });
});
