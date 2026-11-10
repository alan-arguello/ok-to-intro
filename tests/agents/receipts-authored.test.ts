import { describe, expect, it, vi } from 'vitest';
import { toolExamples, transcripts } from '@/components/agents/examples';
import { AUTHORED_FANOUT_LABEL, AUTHORED_LABEL } from '@/lib/oti/copy';
import { PRESET_RECORDINGS } from '@/lib/recorded';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/agents/receipts.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

describe('the /agents examples on hand-written recordings', () => {
  const examples = toolExamples();

  it('label the hand-written runs as such', () => {
    expect(PRESET_RECORDINGS.source).toBe('authored');
    const tryText = examples.try_rules[0] as string;
    expect(tryText).toContain(AUTHORED_LABEL);
    expect(tryText.split('\n')[0]).toBe('ok-to-intro · try_rules · 12 SAMPLE asks · cap 2 · example verdicts');
    expect(tryText).not.toMatch(/\blive\b|Recorded run/);
    const sample = examples.send_ask[0] as string;
    expect(sample.split('\n')[0]).toBe('ok-to-intro · ask sa_eng · sent · SAMPLE · example results');
    expect(sample).toContain(AUTHORED_FANOUT_LABEL);
    expect(sample).not.toMatch(/gates ran|replayed from a recorded run/);
  });

  it('show the hand-written verdicts: the Engineer quotes and question, the Health price question', () => {
    const tryText = examples.try_rules[0] as string;
    expect(tryText).toContain(' 1 reach    Tidewell Data    “founders about churn, activation or support load” +1');
    expect(tryText).toContain(' 6 ask      Fernby Labs      question: How many signups a month do you get, and what share finishes setup?');
    const health = transcripts().ask.rows.map((r) => r.text);
    expect(health).toContain('ok-to-intro · ask sa_health · sent · SAMPLE · example results');
    expect(health).toContain('40 members · 2 accepted · 1 question · 30 declined');
    expect(health.join('\n')).toContain('the gate that asked accepts with this answer (example results, written by hand) · next in line');
  });
});
