/**
 * Port of prototype/check-data.mjs: every check, against the typed SAMPLE data in lib/sample, plus the recorded
 * files generated from it (data/recorded/*.json).
 */
import { describe, expect, it } from 'vitest';
import { findClause, norm } from '@/lib/oti/clause';
import { applyCap } from '@/lib/oti/cap';
import { loadSampleNetworkRecordings, PRESET_RECORDINGS, validateRecordedFile } from '@/lib/recorded';
import {
  AUTHORED_VERDICTS,
  COST,
  EXAMPLE_BOARD,
  OFFER_SAMPLE,
  ONE_TAP_EDITS,
  PRESETS,
  PROTOTYPE_RUN_ESTIMATES,
  SAMPLE_ASKS,
  SAMPLE_FANOUTS,
  SAMPLE_MEMBER_NAMES,
  SAMPLE_MEMBERS,
  SAMPLE_NETWORK_ASKS,
  memberCitation,
} from '@/lib/sample';

const words = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9$ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

describe('presets and their authored verdicts (check-data.mjs §1, §2)', () => {
  for (const p of PRESETS) {
    const gates = AUTHORED_VERDICTS[p.id];

    it(`${p.id}: 12 verdicts, in arrival order`, () => {
      expect(gates.map((g) => g.ask_id)).toEqual(SAMPLE_ASKS.map((a) => a.id));
    });

    it(`${p.id}: every cited clause is in the rules (after normalisation)`, () => {
      for (const g of gates) for (const c of g.cited) expect(norm(p.rules).includes(norm(c)), `${g.ask_id}: “${c}”`).toBe(true);
    });

    it(`${p.id}: findClause returns the member's own words for every quote`, () => {
      for (const g of gates)
        for (const c of g.cited) {
          const r = findClause(p.rules, c);
          expect(r, `${g.ask_id}: “${c}”`).not.toBeNull();
          expect(norm(p.rules.slice(r!.start, r!.end))).toBe(norm(c).replace(/^["']+|["']+$/g, ''));
        }
    });

    it(`${p.id}: accepts cite, questions follow the ask_back rules`, () => {
      for (const g of gates) {
        if (g.verdict === 'accept') expect(g.cited.length).toBeGreaterThanOrEqual(1);
        if (g.verdict === 'ask_back') {
          expect(g.question).not.toBeNull();
          expect(g.question!.text.length).toBeLessThanOrEqual(100);
          expect(/https?:|\//.test(g.question!.text)).toBe(false);
        }
      }
    });

    it(`${p.id}: trap asks are always declined`, () => {
      for (const a of SAMPLE_ASKS.filter((x) => x.trap)) expect(gates.find((g) => g.ask_id === a.id)?.verdict, a.id).toBe('decline');
    });

    it(`${p.id}: at least 1 accept and 1 question`, () => {
      expect(gates.filter((g) => g.verdict === 'accept').length).toBeGreaterThanOrEqual(1);
      expect(gates.filter((g) => g.verdict === 'ask_back').length).toBeGreaterThanOrEqual(1);
    });

    it(`${p.id}: one-tap add-line edits cite the line they add`, () => {
      for (const e of ONE_TAP_EDITS[p.id]) {
        if (e.kind !== 'add') continue;
        for (const [id, f] of Object.entries(e.expected_flips)) for (const c of f!.cited) expect(norm(`${p.rules}\n${e.line}`).includes(norm(c)), `${id}`).toBe(true);
      }
    });
  }

  it('counts match the copy: Engineer 2 reach · 1 over cap · 1 question · 8 declined; Health and Founder 1 · 0 · 1 · 10', () => {
    const counts = (id: (typeof PRESETS)[number]['id']) => {
      const gates = AUTHORED_VERDICTS[id];
      const rows = SAMPLE_ASKS.map((a) => ({ ask_id: a.id, day: a.day, gate: { verdict: gates.find((g) => g.ask_id === a.id)!.verdict, decided_by: 'gate' as const } }));
      const { results } = applyCap(rows, 2);
      const c: Record<string, number> = {};
      for (const r of results) c[r.display] = (c[r.display] ?? 0) + 1;
      return c;
    };
    expect(counts('engineer')).toEqual({ reach: 2, held: 1, ask: 1, decline: 8 });
    expect(counts('health')).toEqual({ ask: 1, reach: 1, decline: 10 });
    expect(counts('founder')).toEqual({ ask: 1, reach: 1, decline: 10 });
  });
});

describe('the 12 asks (check-data.mjs §3)', () => {
  it('subjects are at most 45 characters', () => {
    for (const a of SAMPLE_ASKS) expect(a.subject.length, a.id).toBeLessThanOrEqual(45);
  });

  it('every trap has trap spans, and every span is an exact substring of the ask', () => {
    for (const a of SAMPLE_ASKS) {
      if (a.trap) expect(a.trap_spans.length, a.id).toBeGreaterThan(0);
      for (const s of a.trap_spans) expect(a.text.includes(s), `${a.id}: “${s}”`).toBe(true);
    }
    expect(SAMPLE_ASKS.filter((a) => a.trap).map((a) => a.trap)).toEqual(['wrong stage', 'investor', 'injection', 'polite spam']);
  });
});

describe('S4 suggested edits (check-data.mjs §4)', () => {
  const health = PRESETS.find((p) => p.id === 'health')!;
  const askWords = words(SAMPLE_ASKS.find((a) => a.id === 'a02')!.text).join(' ');
  for (const [k, e] of Object.entries(OFFER_SAMPLE.suggested_edits)) {
    it(`${k}: additive, never 6+ words from the ask, never a company name, honest expected line`, () => {
      expect(norm(health.rules).includes(norm(e.context)), 'context is one of Ana’s rules').toBe(true);
      const w = words(e.add);
      for (let i = 0; i + 6 <= w.length; i++) expect(askWords.includes(w.slice(i, i + 6).join(' '))).toBe(false);
      for (const a of SAMPLE_ASKS) expect(norm(e.add).includes(norm(a.company))).toBe(false);
      // Hand-written data is never presented as a test run (docs/CONTRACT.md §e).
      expect(e.expected).toMatch(/^Expected on the 12 sample asks \(written by hand, not a model run\): \d+ changes? \(/);
      expect(e.expected).not.toMatch(/^Tested/);
    });
  }
});

describe('the sample network (check-data.mjs §5)', () => {
  it('every member an offer can reach has a fictional name for after OK', () => {
    for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) for (const label of sa.accept) expect(SAMPLE_MEMBER_NAMES[label], `${sa.id}: ${label}`).toBeDefined();
  });

  it('39 sample members per fan-out; subjects fit', () => {
    expect(SAMPLE_MEMBERS).toHaveLength(39);
    for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) {
      expect(SAMPLE_FANOUTS[sa.id]).toHaveLength(39);
      expect(sa.subject.length).toBeLessThanOrEqual(45);
    }
  });

  it('fan-out counts match the S6 receipt (33 gates ran, 7 not checked: 5 at cap, 2 paused)', () => {
    for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) {
      const rows = SAMPLE_FANOUTS[sa.id];
      const na = rows.filter((r) => r.state === 'na');
      expect(na.filter((r) => r.na === 'at_cap')).toHaveLength(5);
      expect(na.filter((r) => r.na === 'paused')).toHaveLength(2);
      expect(rows.filter((r) => r.state !== 'na')).toHaveLength(32); // + your gate = 33
      expect(rows.filter((r) => r.state === 'accept')).toHaveLength(2);
      expect(rows.filter((r) => r.state === 'ask_back')).toHaveLength(1);
    }
  });

  it('accept citations are exact substrings of that member’s rules', () => {
    for (const m of SAMPLE_MEMBERS) expect(findClause(m.rules, memberCitation(m)), m.label).not.toBeNull();
  });

  it('every suggested part cites phrases from the partial sample text', () => {
    for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) {
      for (const p of sa.compiledPartial) {
        if (p.state === 'found') expect(sa.partial.includes(p.text), `${sa.id} ${p.key}`).toBe(true);
        if (p.state === 'suggested') for (const f of p.from) expect(sa.partial.includes(f), `${sa.id} ${p.key}: “${f}”`).toBe(true);
        if (p.state === 'missing') expect(p.question && p.sample).toBeTruthy();
      }
    }
  });
});

describe('one cost constant (check-data.mjs §6)', () => {
  it('the prototype’s run estimates agree with COST.perGate within 10%', () => {
    for (const p of PRESETS) {
      const r = PROTOTYPE_RUN_ESTIMATES[p.id];
      expect(Math.abs(r.cost_usd / 12 - COST.perGate) / COST.perGate, p.id).toBeLessThan(0.1);
    }
  });
});

describe('example board numbers (check-data.mjs §7)', () => {
  it('unanswered demand lists only topics with 3+ distinct askers', () => {
    for (const d of EXAMPLE_BOARD.demand) expect(d[3], d[0]).toBeGreaterThanOrEqual(3);
  });
  it('gate checks fit asks × members + reruns', () => {
    const fn = Object.fromEntries(EXAMPLE_BOARD.funnel.map((r) => [r[0], r[1]]));
    expect(Number(fn['Gate checks'])).toBeLessThanOrEqual(Number(fn['Asks sent']) * Number(fn['Members with rules']) + 3);
  });
});

describe('recorded files (data/recorded)', () => {
  it('are valid and labelled by their real source', async () => {
    expect(validateRecordedFile(PRESET_RECORDINGS, 'presets')).toEqual([]);
    expect(validateRecordedFile(await loadSampleNetworkRecordings(), 'sample-network')).toEqual([]);
  });

  it('authored files match lib/sample exactly (regenerate with `npm run recordings:authored`)', async () => {
    const SAMPLE_NETWORK_RECORDINGS = await loadSampleNetworkRecordings();
    if (PRESET_RECORDINGS.source !== 'authored') return; // a model recording is checked by BE1's rubric-hash test
    for (const p of PRESETS) {
      const run = PRESET_RECORDINGS.runs[p.id];
      expect(run.gates.map((g) => [g.ask_id, g.verdict, g.cited.map((c) => c.text), g.reason_code, g.reason, g.question, g.flags])).toEqual(
        AUTHORED_VERDICTS[p.id].map((v) => [v.ask_id, v.verdict, v.cited, v.reason_code, v.reason, v.question, v.flags]),
      );
      for (const g of run.gates) for (const c of g.cited) expect(p.rules.slice(c.start, c.end)).toBe(p.rules.slice(findClause(p.rules, c.text)!.start, findClause(p.rules, c.text)!.end));
    }
    if (SAMPLE_NETWORK_RECORDINGS.source === 'authored') {
      for (const sa of Object.values(SAMPLE_NETWORK_ASKS)) {
        expect(SAMPLE_NETWORK_RECORDINGS.runs[sa.id].members.map((m) => [m.label, m.state, m.na, m.reason_code])).toEqual(
          SAMPLE_FANOUTS[sa.id].map((r) => [r.label, r.state, r.na, r.reason_code]),
        );
      }
    }
  });
});
