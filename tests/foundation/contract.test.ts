import { describe, expect, it } from 'vitest';
import { askFacts, assembleAskText, isYcApplicationAsk, validateAsk, YC_APPLICATION_REFUSAL } from '@/lib/oti/ask';
import { sharesWords, suggestRuleEdit, topicPhrase } from '@/lib/oti/rule-edits';
import { PRESET_RECORDINGS, presetRun, recordedGateEvent, recordedLabel } from '@/lib/recorded';
import { realAskersMode } from '@/lib/env';
import { OFFER_SAMPLE, PRESETS, SAMPLE_ASKS, SAMPLE_NETWORK_ASKS } from '@/lib/sample';
import type { CompiledAsk } from '@/lib/types';

const a01 = SAMPLE_ASKS.find((a) => a.id === 'a01')!;
const a02 = SAMPLE_ASKS.find((a) => a.id === 'a02')!;

describe('askFacts: one card everywhere (ux-spec Revision 3)', () => {
  it('reads Problem, Needs (“20 minutes with …”), Tried, By, Offers, then Price, as on the sample offer', () => {
    const facts = askFacts(a02.parts, '$18k a year per hospital (Maya told your gate)');
    expect(facts).toEqual(OFFER_SAMPLE.facts);
  });

  it('drops empty parts and never invents a price', () => {
    expect(askFacts({ ...a01.parts, tried: '  ' }).map(([k]) => k)).toEqual(['Problem', 'Needs', 'By', 'Offers']);
  });
});

describe('assembleAskText: the ask members read', () => {
  it('appends only the parts the founder added, in a fixed order', () => {
    const sa = SAMPLE_NETWORK_ASKS.engineer;
    const parts = { challenge: 'x', tried: 'y', needs: 'someone who has run Postgres past 100M rows', by: 'Nov 21', offers: 'our load-test harness' };
    expect(assembleAskText(sa.partial, parts, ['needs', 'by', 'offers'])).toBe(
      `${sa.partial} Need 20 minutes with someone who has run Postgres past 100M rows, before Nov 21. Offer: our load-test harness.`,
    );
    expect(assembleAskText(a01.text, a01.parts, [])).toBe(a01.text);
    expect(assembleAskText('No period here', { ...a01.parts }, ['offers'])).toBe('No period here. Offer: our load-test harness.');
  });
});

describe('validateAsk: the server never trusts the client’s parts', () => {
  const ok: CompiledAsk = { parts: a01.parts, subject: a01.subject, text: a01.text, price: null, topic: a01.topic };

  it('accepts a complete ask', () => {
    expect(validateAsk(a01.text, ok)).toEqual({ ok: true });
  });

  it('refuses missing parts, long subjects and over-long text', () => {
    expect(validateAsk(a01.text, { ...ok, parts: { ...ok.parts, by: '' } })).toMatchObject({ ok: false, reason: 'invalid', field: 'by' });
    expect(validateAsk(a01.text, { ...ok, subject: 'x'.repeat(46) })).toMatchObject({ ok: false, field: 'subject' });
    expect(validateAsk('x'.repeat(601), ok)).toMatchObject({ ok: false, field: 'text' });
    expect(validateAsk(a01.text, null)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('refuses YC-application asks in any field, with the spec’s copy', () => {
    const yc = 'Need 20 minutes with a YC alum to review our YC application before the batch deadline.';
    expect(isYcApplicationAsk(yc)).toBe(true);
    expect(isYcApplicationAsk(a01.text)).toBe(false);
    expect(validateAsk(a01.text, { ...ok, parts: { ...ok.parts, needs: 'someone to review our Y Combinator application' } })).toEqual({
      ok: false,
      reason: 'yc_application',
      message: YC_APPLICATION_REFUSAL,
    });
  });
});

describe('suggestRuleEdit: templated, additive, never copies the ask', () => {
  const health = PRESETS.find((p) => p.id === 'health')!.rules;

  it('Not my area adds “No asks about <topic>.”; Wrong stage adds the stage line', () => {
    const area = suggestRuleEdit('not_my_area', { rules: health, matchedLine: health.split('\n')[0]!, topic: a02.topic, askText: a02.text, companies: [a02.company] });
    expect(area).toEqual({ reason: 'not_my_area', context: health.split('\n')[0], add: 'No asks about hospital procurement.' });
    const stage = suggestRuleEdit('wrong_stage', { rules: health, matchedLine: null, topic: a02.topic, askText: a02.text });
    expect(stage?.add).toBe('Only after a first paying customer.');
  });

  it('suggests nothing for reasons that are not about the rules, or when the rules already say it', () => {
    for (const reason of ['not_specific', 'no_time', 'other'] as const) {
      expect(suggestRuleEdit(reason, { rules: health, matchedLine: null, topic: a02.topic, askText: a02.text })).toBeNull();
    }
    expect(suggestRuleEdit('wrong_stage', { rules: `${health}\nOnly after a first paying customer.`, matchedLine: null, topic: null, askText: a02.text })).toBeNull();
    expect(suggestRuleEdit('not_my_area', { rules: health, matchedLine: null, topic: null, askText: a02.text })).toBeNull();
  });

  it('never names a company and never copies 6+ words of the ask', () => {
    expect(suggestRuleEdit('not_my_area', { rules: health, matchedLine: null, topic: 'Oakline Health deals', askText: a02.text, companies: ['Oakline Health'] })).toBeNull();
    expect(sharesWords('No asks about public hospital procurement committee in the US.', a02.text)).toBe(true);
    expect(topicPhrase('Hospital procurement, US')).toBe('hospital procurement');
    expect(topicPhrase('First SOC 2 audit')).toBe('first SOC 2 audit');
  });
});

describe('honesty of recorded data', () => {
  it('labels hand-written preset rows as authored, with no latency or confidence', () => {
    const run = presetRun('engineer');
    const ev = recordedGateEvent(run.gates[0]!, 0);
    if (PRESET_RECORDINGS.source === 'authored') {
      expect(ev.source).toBe('authored');
      expect(ev.ms).toBeNull();
      expect(ev.confidence).toBeNull();
      const label = recordedLabel(PRESET_RECORDINGS, { gates: 12, wall_ms: run.wall_ms, cost_usd: run.cost_usd });
      expect(label).toBe('Example verdicts, written by hand · not a model run');
      expect(label).not.toMatch(/Recorded|claude-|\$|\d+(\.\d+)? s\b/);
    } else {
      expect(ev.source).toBe('recorded');
    }
    expect(recordedGateEvent(run.gates[0]!, 0, { source: 'model' }).source).toBe('recorded');
  });
});

describe('who may ask the REAL network', () => {
  it('is open when REAL_ASKERS is unset, empty or *, and an allowlist otherwise (fails closed)', () => {
    expect(realAskersMode(undefined)).toBe('open');
    expect(realAskersMode('')).toBe('open');
    expect(realAskersMode(' * ')).toBe('open');
    expect(realAskersMode('alan@example.com')).toBe('allowlist');
    expect(realAskersMode('not-an-email')).toBe('allowlist');
  });
});

describe('isSameOrigin (route handlers get no automatic CSRF check)', () => {
  it('passes same-origin and header-less requests, refuses cross-site ones', async () => {
    const { isSameOrigin } = await import('@/lib/http');
    const req = (headers: Record<string, string>) => new Request('http://127.0.0.1:3200/api/asks', { method: 'POST', headers });
    expect(isSameOrigin(req({}))).toBe(true);
    expect(isSameOrigin(req({ origin: 'http://127.0.0.1:3200', host: '127.0.0.1:3200' }))).toBe(true);
    expect(isSameOrigin(req({ origin: 'https://ok-to-intro.vercel.app', host: 'internal:3000', 'x-forwarded-host': 'ok-to-intro.vercel.app' }))).toBe(true);
    expect(isSameOrigin(req({ origin: 'https://evil.example', host: '127.0.0.1:3200' }))).toBe(false);
    expect(isSameOrigin(req({ origin: 'null', host: '127.0.0.1:3200' }))).toBe(false);
    expect(isSameOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
});
