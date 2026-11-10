import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetBudgetForTests } from '@/lib/server/budget';
import { runGate } from '@/lib/server/gate';
import { __setModelFetchForTests } from '@/lib/server/live';
import { PERSONAL_GATE_ADDENDUM, runPersonalGate } from '@/lib/server/personal-gate-prompt';
import { GATE_RUBRIC } from '@/lib/server/rubric';
import { fakeFetch, reply, verdict } from './fake-api';

const RULES = 'Happy to talk with teams hiring product engineers.\nFor founder asks, only if they have paying users.';
const ASK = { text: 'We’re hiring product engineers and saw your application. Could we set up a call this week to talk about the role?' };

type Block = { type: string; text: string; cache_control?: unknown };

describe('personal gate request', () => {
  let api: ReturnType<typeof fakeFetch>;
  beforeEach(() => {
    api = fakeFetch();
    __setModelFetchForTests(api.fetch);
    __resetBudgetForTests();
  });
  afterEach(() => {
    __setModelFetchForTests(null);
    __resetBudgetForTests();
  });

  it('sends the personal-gate block after the cached rubric, and the default request never carries it', async () => {
    api.next(reply(() => verdict({ verdict: 'accept', cited: ['teams hiring product engineers'] })));
    const personal = await runPersonalGate({ rules: RULES, ask: ASK });
    expect(personal.ok && personal.decision.verdict).toBe('accept');
    api.next(reply(() => verdict({ verdict: 'decline' })));
    await runGate({ rules: RULES, ask: ASK });
    expect(api.requests).toHaveLength(2);

    const withBlock = api.requests[0]!.body.system as Block[];
    const byDefault = api.requests[1]!.body.system as Block[];
    expect(withBlock).toHaveLength(3);
    expect(withBlock[0]).toEqual({ type: 'text', text: GATE_RUBRIC, cache_control: { type: 'ephemeral' } });
    expect(withBlock[1]).toEqual({ type: 'text', text: PERSONAL_GATE_ADDENDUM });
    expect(withBlock[2]!.text).toContain(RULES);

    expect(byDefault).toHaveLength(2);
    expect(JSON.stringify(api.requests[1]!.body)).not.toContain('PERSONAL GATE');
    // Apart from that one block, both paths send the same request.
    expect({ ...api.requests[0]!.body, system: [withBlock[0], withBlock[2]] }).toEqual(api.requests[1]!.body);
  });
});
