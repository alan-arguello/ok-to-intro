import { describe, expect, it } from 'vitest';
import { applyCap } from '@/lib/oti/cap';
import { looksLikeToken, newToken, publicId } from '@/lib/oti/ids';
import { bareSubject, fmtMs, fmtUsd, needsLine, plural, shuffled, traceTime } from '@/lib/oti/text';
import { DEGRADED_KINDS, resolveDegraded, resolveQaState } from '@/lib/qa';
import { isAuthored, recordedLabel, PRESET_RECORDINGS } from '@/lib/recorded';
import { __parseEnvForTests } from '@/lib/env';
import { hasSessionCookie } from '@/lib/supabase/cookie-hint';
import { AUTHORED_LABEL } from '@/lib/oti/copy';

describe('text helpers', () => {
  it('formats the way the prototype does', () => {
    expect(fmtMs(980)).toBe('980 ms');
    expect(fmtMs(1290)).toBe('1.3 s');
    expect(fmtUsd(0.0019)).toBe('$0.002');
    expect(fmtUsd(0.32)).toBe('$0.32');
    expect(plural(1, 'ask')).toBe('1 ask');
    expect(plural(2, 'person', 'people')).toBe('2 people');
    expect(traceTime(0)).toBe('+0 ms     ');
    expect(traceTime(1290)).toBe('+1290 ms  ');
    expect(bareSubject('Enterprise deals stuck 5 months, 20 min?')).toBe('Enterprise deals stuck 5 months');
  });

  it('reads Needs the same everywhere: “20 minutes with …”', () => {
    expect(needsLine('Someone who has cut early churn in a B2B product')).toBe('20 minutes with someone who has cut early churn in a B2B product');
    expect(needsLine('A founder who hired a first salesperson')).toBe('20 minutes with a founder who hired a first salesperson');
    expect(needsLine('CTO who made a first hire')).toBe('20 minutes with CTO who made a first hire');
    expect(needsLine('20 minutes with someone')).toBe('20 minutes with someone');
    expect(needsLine('')).toBe('');
  });

  it('shuffles deterministically', () => {
    expect(shuffled(40, 7)).toEqual(shuffled(40, 7));
    expect([...shuffled(40, 7)].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });
});

describe('applyCap', () => {
  const g = (verdict: 'accept' | 'decline' | 'ask_back') => ({ verdict, decided_by: 'gate' as const });
  it('lets the first N accepts of the month through and holds the rest', () => {
    const { results, reachDays } = applyCap(
      [
        { ask_id: 'a', day: 2, gate: g('accept') },
        { ask_id: 'b', day: 3, gate: g('decline') },
        { ask_id: 'c', day: 4, gate: g('accept') },
        { ask_id: 'd', day: 5, gate: g('accept') },
      ],
      2,
    );
    expect(results.map((r) => r.display)).toEqual(['reach', 'decline', 'reach', 'held']);
    expect(results[2]!.pos).toBe(2);
    expect(reachDays).toEqual([2, 4]);
  });

  it('keeps a later accept CHECKING while an earlier row could still take the slot (provisional)', () => {
    const { results } = applyCap(
      [
        { ask_id: 'a', day: 2, pending: true },
        { ask_id: 'b', day: 3, gate: g('accept') },
      ],
      1,
      true,
    );
    expect(results.map((r) => r.display)).toEqual(['checking', 'checking']);
  });

  it('shows failures as not checked, refusals and parse errors as declined by code, never as accepts', () => {
    const { results } = applyCap(
      [
        { ask_id: 'a', day: 1, error: 'timeout' },
        { ask_id: 'b', day: 2, error: 'refused' },
        { ask_id: 'c', day: 3, error: 'parse' },
        { ask_id: 'd', day: 4, gate: { verdict: 'decline', decided_by: 'clause_check' } },
        { ask_id: 'e', day: 5 },
      ],
      2,
    );
    expect(results.map((r) => r.display)).toEqual(['failed', 'code', 'code', 'code', 'notrun']);
  });
});

describe('ids and tokens', () => {
  it('mints prefixed public ids and 128-bit tokens', () => {
    expect(publicId('ask')).toMatch(/^a_[0-9A-Za-z]{6}$/);
    expect(publicId('offer', 8)).toMatch(/^o_[0-9A-Za-z]{8}$/);
    const t = newToken();
    expect(looksLikeToken(t)).toBe(true);
    expect(newToken()).not.toBe(t);
    expect(looksLikeToken('sample')).toBe(false);
  });
});

describe('QA states', () => {
  it('are honoured only when QA is enabled, and only for known names', () => {
    expect(resolveQaState('offer', 'ok-sent', true)).toBe('ok-sent');
    expect(resolveQaState('offer', 'ok-sent', false)).toBeNull();
    expect(resolveQaState('offer', 'made-up', true)).toBeNull();
    expect(resolveQaState('checkin', ['d1-saved', 'x'], true)).toBe('d1-saved');
    expect(resolveDegraded('down', true)).toBe('down');
    expect(resolveDegraded('down', false)).toBeNull();
    expect(DEGRADED_KINDS).toContain('off');
  });
});

describe('recorded labels', () => {
  it('never call authored data a model run', () => {
    expect(recordedLabel({ source: 'authored', recorded_at: '2026-11-09T09:00:00-08:00', model: 'claude-haiku-5-5' })).toBe(AUTHORED_LABEL);
    expect(recordedLabel({ source: 'model', recorded_at: '2026-11-09T09:00:00-08:00', model: 'claude-haiku-5-5' }, { gates: 12, wall_ms: 1910, cost_usd: 0.0019 })).toBe(
      'Recorded run · Nov 9, 09:00 · claude-haiku-5-5 · 12 gates in 1.9 s · $0.002',
    );
    expect(isAuthored(PRESET_RECORDINGS)).toBe(PRESET_RECORDINGS.source === 'authored');
  });
});

describe('env parsing', () => {
  it('never throws: missing and invalid values become undefined with a named problem', () => {
    const { env, problems } = __parseEnvForTests({ NEXT_PUBLIC_SUPABASE_URL: 'not a url', DAILY_BUDGET_USD: '12.5', REAL_ASKERS: 'Alan@Example.com, nope, alex@example.com', TOKEN_HMAC_SECRET: 'short' });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(env.DAILY_BUDGET_USD).toBe(12.5);
    expect(env.REAL_ASKERS).toEqual(['alan@example.com', 'alex@example.com']);
    expect(env.TOKEN_HMAC_SECRET).toBeUndefined();
    expect(problems.map((p) => p.key).sort()).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'TOKEN_HMAC_SECRET']);
    expect(JSON.stringify(problems)).not.toContain('short');
  });
});

describe('session cookie hint', () => {
  it('detects @supabase/ssr cookies, chunked or not', () => {
    expect(hasSessionCookie('a=1; sb-abcd1234-auth-token=base64-xyz')).toBe(true);
    expect(hasSessionCookie('sb-abcd1234-auth-token.0=base64-xyz; b=2')).toBe(true);
    expect(hasSessionCookie('sb-abcd1234-auth-token-code-verifier=x')).toBe(false);
    expect(hasSessionCookie('')).toBe(false);
  });
});
