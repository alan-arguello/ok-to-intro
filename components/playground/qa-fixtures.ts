/**
 * QA states for `/rules?state=<name>` (the prototype's names, lib/qa.ts `QA_STATES.playground`). The page imports this
 * module dynamically, only when QA is enabled and a state is in the URL, so it never ships to a normal visit.
 *
 * States that show a live run (done-live, partial-timeout, all-*, lost-stream, running) can't call the model, so
 * they render example verdicts in the live layout: the run's source line says “QA fixture, not a model call”, rows
 * carry no latency and say “example”, and the run is never stored.
 */

import type { QaState } from '@/lib/qa';
import { PRESET_RECORDINGS, recordedGateEvent } from '@/lib/recorded';
import type { SampleAskKey } from '@/lib/types';
import type { PlaygroundEngine } from './engine';
import { ASKS, type RowGate } from './model';

const EXTRA_LINE = 'No asks about crypto.';
const DECLINE_ALL_RULES = 'Happy to talk about robotics hardware.\nNo fundraising asks.\nNo asks to review a deck.';
const ACCEPT_ALL_RULES = 'Happy to help any founder who asks.';
/** 1,040 characters: the Engineer preset plus nine lines (too-long). */
const LONG_RULES = [
  'Happy to talk to founders about churn, activation or support load.',
  'Only if they have real usage: a customer count, a churn rate or a ticket count.',
  'No fundraising asks.',
  'No asks to review a deck.',
  'Also happy to talk about onboarding emails, help centers or customer success hiring when usage is real.',
  'Happy to look at a churn cohort if you share the numbers, the plan mix and what you already tried.',
  'Only if the ask says what you tried and what broke; a link to a dashboard is fine.',
  'No asks to join an advisory board, no recruiting asks and no requests to try a product.',
  'Prefer asks that name a deadline in the next 30 days and offer something back, even a write-up.',
  'No cold sales pitches for observability, hosting or security tools, even when they are framed as a question.',
  'Happy to talk with founders anywhere in North America, in English or Spanish, at most 3 calls every month.',
  'No asks about pricing, go-to-market or hiring; those go to other people in the network who know them better.',
  'No asks that open with praise and skip the problem.',
].join('\n');

/** Rows that answered first in the frozen `running` state (7 of 12, not in arrival order). */
const FROZEN_RESOLVED: SampleAskKey[] = ['a02', 'a05', 'a12', 'a01', 'a08', 'a10', 'a03'];

type GateMap = Record<SampleAskKey, RowGate>;

function blank(id: SampleAskKey, i: number): RowGate {
  return {
    i,
    ask_id: id,
    verdict: 'decline',
    model_verdict: 'decline',
    cited: [],
    decided_by: 'gate',
    reason_code: 'no_rule',
    reason: '',
    question: null,
    flags: [],
    confidence: null,
    ms: null,
    source: 'fixture',
  };
}

/** The Engineer preset's example verdicts as fixture rows. */
function engineerGates(): GateMap {
  const out = {} as GateMap;
  PRESET_RECORDINGS.runs.engineer.gates.forEach((g, i) => {
    out[g.ask_id] = { ...recordedGateEvent(g, i, PRESET_RECORDINGS), source: 'fixture', ms: null, confidence: null };
  });
  return out;
}

function declineAll(): GateMap {
  const out = {} as GateMap;
  ASKS.forEach((a, i) => {
    const g = blank(a.id, i);
    g.reason = `${a.topic}. No line in these rules covers it.`;
    if (a.id === 'a12') {
      g.cited = [{ text: 'No asks to review a deck.', found: false }];
      g.reason_code = 'rule_says_no';
      g.reason = 'Asks for feedback on a pitch deck.';
    }
    if (a.trap === 'investor') {
      g.flags = ['asker_not_founder'];
      g.reason = 'Asks which founders you would back: reads as an investor looking for deal flow, not a founder asking for help.';
    }
    if (a.trap === 'injection') {
      g.flags = ['instruction_in_ask'];
      g.reason = `${a.topic}. No line in these rules covers it. The ask told the gate what to answer and what to quote. It was read as text, not followed.`;
    }
    out[a.id] = g;
  });
  return out;
}

function acceptAll(): GateMap {
  const out = {} as GateMap;
  ASKS.forEach((a, i) => {
    out[a.id] = {
      ...blank(a.id, i),
      verdict: 'accept',
      model_verdict: 'accept',
      cited: [{ text: 'any founder who asks', found: false }],
      reason_code: 'match',
      reason: 'A founder asking for help, which this line accepts from any founder.',
    };
  });
  return out;
}

/** Applies a QA state once (the engine ignores a second call). Quotes are checked by the real clause finder. */
export function applyQaState(engine: PlaygroundEngine, state: QaState<'playground'>): void {
  engine.qa(() => {
    const rules = () => engine.getState().rules;
    switch (state) {
      case 'not-run':
        return;
      case 'running':
        engine.qaFrozen(engineerGates(), FROZEN_RESOLVED);
        return;
      case 'done-recorded':
        engine.recordedRun();
        return;
      case 'done-live':
        engine.qaInstant(engineerGates());
        return;
      case 'stale':
        engine.recordedRun();
        engine.setRules(`${rules()}\n${EXTRA_LINE}`);
        return;
      case 'cap-changed':
        engine.recordedRun();
        engine.setCap(1);
        return;
      case 'partial-timeout':
        engine.qaInstant(engineerGates(), { fail: ['a09'] });
        return;
      case 'empty-rules':
        engine.setRules('');
        return;
      case 'too-long':
        engine.setRules(LONG_RULES);
        return;
      case 'all-declined':
        engine.setRules(DECLINE_ALL_RULES);
        engine.qaInstant(declineAll());
        return;
      case 'all-accepted':
        engine.setRules(ACCEPT_ALL_RULES);
        engine.qaInstant(acceptAll());
        return;
      case 'rate-limited':
        engine.qaSetDegraded('limited');
        engine.recordedRun();
        engine.blockLive();
        return;
      case 'api-down':
        engine.qaSetDegraded('down');
        engine.recordedRun();
        return;
      case 'budget':
        engine.qaSetDegraded('budget');
        engine.recordedRun();
        return;
      case 'offline':
        engine.qaSetDegraded('offline');
        engine.recordedRun();
        return;
      case 'lost-stream':
        engine.qaInstant(engineerGates(), { lostAfter: 7 });
        return;
    }
  });
}

/** For tests: the fixture data, so the QA states can be checked against the real clause finder. */
export const QA_FIXTURE_RULES = { EXTRA_LINE, DECLINE_ALL_RULES, ACCEPT_ALL_RULES, LONG_RULES } as const;
