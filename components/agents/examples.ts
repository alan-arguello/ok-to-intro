/**
 * The /agents examples: three transcripts, one example result per tool, the error results and the hook lines. Every
 * receipt here is rendered by lib/receipts.ts (the formatter the MCP server uses) from SAMPLE data in lib/sample and
 * data/recorded; the Claude Code turns around them are illustrative, and the page labels them as example
 * transcripts, not recordings (docs/CONTRACT.md §e.5). Example data is fictional, so example receipts carry SAMPLE in
 * line 1 and use clock times from one fixed example timeline, never an invented duration.
 *
 * Pure and deterministic (times are fixed instants formatted in the network's zone): the page renders it at build.
 */

import sampleNetworkJson from '@/data/recorded/sample-network.json';
import { applyCap } from '@/lib/oti/cap';
import { hex4 } from '@/lib/oti/text';
import { assembleAskText } from '@/lib/oti/ask';
import { NETWORK_TZ, toMs, zonedParts, zonedTimeToUtc } from '@/lib/oti/time';
import {
  alreadySentLine,
  answerReceipt,
  type DraftPartView,
  draftReceipt,
  draftRefusedReceipt,
  ERRORS,
  type FanoutQuestionView,
  hookLines,
  myAsksReceipt,
  outcomeReceipt,
  pendingReceipt,
  type PendingInput,
  receiptOnly,
  respondReceipt,
  type SampleSendView,
  sendRealReceipt,
  sendSampleReceipt,
  setRulesReceipt,
  type TryRowResult,
  tryRulesReceipt,
} from '@/lib/receipts';
import { PRESET_RECORDINGS, recordedGateEvent, type SampleNetworkFile } from '@/lib/recorded';
import type { ToolName } from '@/lib/mcp/catalog';
import { SAMPLE_ASKS } from '@/lib/sample/asks';
import { SAMPLE_MEMBERS, SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { presetById } from '@/lib/sample/presets';
import { INSTALL_MCP_COMMAND, MCP_SERVER_ID } from '@/lib/site';
import type { PresetId, QuestionType, SampleNetworkAskId } from '@/lib/types';
import { PART_KEYS } from '@/lib/types';

/* ---------- one fixed example timeline (Mexico City): Lucía's ask, Mon Nov 9 ---------- */

const SENT_AT = OFFER_SAMPLE.sent_iso; // Mon Nov 9, 21:04 CST
const REPLY_BY = OFFER_SAMPLE.reply_by_iso; // Thu Nov 12, 21:04 CST
const at = (hhmm: string, day = '2026-11-09') => `${day}T${hhmm}:00-06:00`;
const SEEN_AT = at('21:10'); // the member opens Claude Code: 71 h left
const RESPOND_AT = at('21:16');
const ANSWER_AT = at('21:12');
const RULES_AT = at('21:20');
const CHECKIN_AT = at('21:22');
const LIMIT_AT = at('10:42');

/** `days` local days after `iso` in Mexico City, at `hour`:00 there (the check-in schedule). */
function localDay(iso: string, days: number, hour: number): string {
  const p = zonedParts(toMs(iso), NETWORK_TZ);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return new Date(zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, 0, NETWORK_TZ)).toISOString();
}

/* ---------- try_rules: a preset's recorded file, through the same receipt ---------- */

function presetResults(preset: PresetId): TryRowResult[] {
  const run = PRESET_RECORDINGS.runs[preset];
  return SAMPLE_ASKS.map((a, i) => {
    const gate = run.gates.find((g) => g.ask_id === a.id);
    return gate ? { kind: 'gate', decision: recordedGateEvent(gate, i, PRESET_RECORDINGS) } : { kind: 'error', error: 'timeout' };
  });
}

function presetSource(): 'recorded' | 'authored' {
  return PRESET_RECORDINGS.source === 'model' ? 'recorded' : 'authored';
}

function tryExample(receiptOnlyLines: boolean): string {
  const engineer = presetById('engineer');
  const source = presetSource();
  return tryRulesReceipt({
    rules: engineer.rules,
    cap: engineer.cap,
    results: presetResults('engineer'),
    source,
    wall_ms: source === 'recorded' ? PRESET_RECORDINGS.runs.engineer.wall_ms : null,
    recorded_at: source === 'recorded' ? PRESET_RECORDINGS.recorded_at : null,
    model: source === 'recorded' ? PRESET_RECORDINGS.model : null,
    why_not_live: null,
    join_open: true,
    receipt_only: receiptOnlyLines,
  });
}

/* ---------- draft_ask: the sample asks' hand-written parts ---------- */

function samplePartViews(id: SampleNetworkAskId, cite: Partial<Record<string, string>> = {}): DraftPartView[] {
  const sa = Object.values(SAMPLE_NETWORK_ASKS).find((s) => s.id === id);
  return PART_KEYS.map((key) => {
    const p = sa?.compiledPartial.find((x) => x.key === key);
    if (!p || p.state === 'missing') return { key, state: 'missing', text: '', from: null };
    if (p.state === 'suggested') return { key, state: 'suggested', text: p.text, from: cite[key] ?? (p.from[0] ? `“${p.from[0]}”` : 'your message') };
    return { key, state: 'found', text: p.text, from: cite[key] ?? 'your message' };
  });
}

/** The sample ask's parts once the user answered the missing ones (cited to their file). */
function readyParts(id: SampleNetworkAskId, from: string): DraftPartView[] {
  const sa = Object.values(SAMPLE_NETWORK_ASKS).find((s) => s.id === id);
  return samplePartViews(id).map((p) => {
    if (p.state !== 'missing') return p;
    const sample = sa?.compiledPartial.find((x) => x.key === p.key)?.sample ?? '';
    return { key: p.key, state: 'added', text: sample, from };
  });
}

function readyText(id: SampleNetworkAskId): string {
  const sa = Object.values(SAMPLE_NETWORK_ASKS).find((s) => s.id === id);
  if (!sa) return '';
  const parts = { challenge: '', tried: '', needs: '', by: '', offers: '' };
  const added: (keyof typeof parts)[] = [];
  for (const p of sa.compiledPartial) {
    parts[p.key] = p.state === 'missing' ? (p.sample ?? '') : p.text;
    if (p.state !== 'found') added.push(p.key);
  }
  return assembleAskText(sa.partial, parts, added);
}

/* ---------- send_ask on SAMPLE: the sample-network file, with no rules of the caller's (you: null) ---------- */

const SAMPLE_NETWORK = sampleNetworkJson as unknown as SampleNetworkFile;

/** What BE2's SAMPLE fan-out returns for a sample ask sent from Claude Code: 39 members from the file, 1 example member. */
export function exampleSampleSend(id: SampleNetworkAskId, offeredAt: string): SampleSendView {
  const run = SAMPLE_NETWORK.runs[id];
  const rows = SAMPLE_MEMBERS.map((m) => run.members.find((r) => r.label === m.label));
  const count = (state: string, na: string | null = null) => rows.filter((r) => r?.state === state && (na === null || r?.na === na)).length;
  const fromModel = SAMPLE_NETWORK.source === 'model';
  const questions = new Map<QuestionType, FanoutQuestionView>();
  for (const r of rows) {
    if (r?.state !== 'ask_back' || !r.question) continue;
    const cur = questions.get(r.question.type);
    if (cur) cur.gates += 1;
    else questions.set(r.question.type, { qid: `q_${hex4(`${id}:${r.question.type}`)}`, type: r.question.type, text: r.question.text, gates: 1 });
  }
  const accepted = count('accept');
  return {
    id,
    total: SAMPLE_MEMBERS.length + 1,
    accepted,
    questions: count('ask_back'),
    // The 40th cell, without rules of the caller's, is a hand-written sample member that declines (BE2 fillerCell).
    declined: count('decline') + 1,
    at_cap: count('na', 'at_cap'),
    paused: count('na', 'paused'),
    failed: count('failed'),
    ran: fromModel ? rows.filter((r) => r && r.state !== 'na').length : 0,
    members: fromModel ? 'recorded' : 'authored',
    fortieth: 'example',
    recorded_at: SAMPLE_NETWORK.recorded_at,
    offer: accepted ? { expires_at: new Date(toMs(offeredAt) + 72 * 3_600_000).toISOString() } : null,
    failed_closed: false,
    question_list: [...questions.values()],
    wall_ms: null,
  };
}

/* ---------- pending_for_me: Lucía's ask reaching Ana (fictional) ---------- */

const ORVELLA = SAMPLE_ASKS.find((a) => a.id === 'a02');
const OFFER_ID = 'o_3Fp9';

function pendingExample(receiptOnlyLines: boolean): string {
  const a = OFFER_SAMPLE.asker;
  const input: PendingInput = {
    offers: [
      {
        offer_id: OFFER_ID,
        title: OFFER_SAMPLE.title,
        asker: { name: a.name, first: a.first, company: a.company, stage: a.stage, city: a.city },
        matched: OFFER_SAMPLE.matched,
        ask_text: ORVELLA?.text ?? '',
        price: '$18k a year per hospital',
        expires_at: REPLY_BY,
      },
    ],
    questions: [],
    checkins: [],
    cap: { cap: OFFER_SAMPLE.member.cap, used: 1, month: '2026-11-01' },
    now: toMs(SEEN_AT),
    example: true,
    receipt_only: receiptOnlyLines,
  };
  return pendingReceipt(input);
}

function respondExample(action: 'ok' | 'answer' | 'no'): string {
  return respondReceipt({
    offer_id: OFFER_ID,
    action,
    at: RESPOND_AT,
    asker: { name: OFFER_SAMPLE.asker.name, first: OFFER_SAMPLE.asker.first },
    scheduling_url: `https://${OFFER_SAMPLE.member.scheduling}`,
    cap: OFFER_SAMPLE.member.cap,
    nth: 1,
    emailed: true,
    checkins: action === 'ok' ? { d1: localDay(RESPOND_AT, 1, 10), d14: localDay(RESPOND_AT, 14, 10) } : null,
    example: true,
  });
}

/* ---------- transcripts ---------- */

/** U user · C Claude · T tool call · R receipt line · O option · P permission prompt · H hook line · S shell · B blank. */
export type RowKind = 'U' | 'C' | 'T' | 'R' | 'O' | 'P' | 'H' | 'S' | 'B';
export interface TranscriptRow {
  kind: RowKind;
  text: string;
}
export interface Transcript {
  rows: TranscriptRow[];
  /** Rows after this index sit behind “Show the rest …” (the Ask transcript). */
  cut: number | null;
}

const row = (kind: RowKind, text = ''): TranscriptRow => ({ kind, text });
const receiptRows = (text: string): TranscriptRow[] => receiptOnly(text).map((l) => row('R', l));
const call = (tool: ToolName) => row('T', `${MCP_SERVER_ID} - ${tool} (MCP)`);
const approval = (tool: ToolName) => row('P', `[${MCP_SERVER_ID} · ${tool} needs your approval]`);

function askTranscript(): Transcript {
  const sa = SAMPLE_NETWORK_ASKS.health;
  const draftId = 'd_4Hn8';
  const missing = draftReceipt({
    id: draftId,
    parts: samplePartViews('sa_health', { challenge: 'notes/pipeline.md line 9', tried: 'notes/pipeline.md line 8', needs: 'your message' }),
    subject: sa.subject,
    text: '',
    network: 'sample',
    example: true,
    receipt_only: true,
  });
  const ready = draftReceipt({
    id: draftId,
    parts: readyParts('sa_health', 'notes/pipeline.md line 12'),
    subject: sa.subject,
    text: readyText('sa_health'),
    network: 'sample',
    example: true,
    receipt_only: true,
  });
  const send = exampleSampleSend('sa_health', SENT_AT);
  const q = send.question_list[0];
  const rows: TranscriptRow[] = [
    row('U', '/ask need someone who has bought software for a public hospital in Mexico'),
    row('B'),
    row('C', 'I read README.md and notes/pipeline.md (not .env or keys).'),
    row('B'),
    call('draft_ask'),
    ...receiptRows(missing),
  ];
  const cut = rows.length;
  rows.push(
    row('B'),
    row('C', 'Deadline and offer back are missing. Use these?'),
    row('O', '1. Before Nov 20; offer our tender templates (notes/pipeline.md line 12)'),
    row('O', '2. I’ll type them'),
    row('O', '3. Cancel'),
    row('U', '1'),
    row('B'),
    call('draft_ask'),
    ...receiptRows(ready),
    row('B'),
    approval('send_ask'),
    row('U', 'Yes'),
    row('B'),
    call('send_ask'),
    ...receiptRows(sendSampleReceipt({ ...send, at: SENT_AT, receipt_only: true })),
  );
  if (q) {
    rows.push(
      row('B'),
      row('C', 'Your docs/pricing.md line 4 says HOSPITAL_ANNUAL = 18000.'),
      row('B'),
      row('C', 'Send this answer to the gate that asked?'),
      row('O', '1. “$18k a year per hospital” (docs/pricing.md line 4)'),
      row('O', '2. Edit'),
      row('O', '3. Skip'),
      row('U', '1'),
      row('B'),
      approval('answer_question'),
      row('U', 'Yes'),
      row('B'),
      call('answer_question'),
      ...receiptRows(
        answerReceipt({
          ask_id: send.id,
          network: 'sample',
          question: q.text,
          answer: '$18k a year per hospital',
          reran: q.gates,
          accepted: q.gates,
          // As answerSampleQuestion does: when no gate held the ask, the rerun accept is offered now.
          offered_now: !send.offer,
          authored: send.members === 'authored',
          wall_ms: null,
        }),
      ),
      row('B'),
      row('C', 'You’ll learn who it is only if they say OK, by Thu Nov 12.'),
    );
  }
  return { rows, cut };
}

function askedTranscript(): Transcript {
  const hook = hookLines({
    offers: [{ offer_id: OFFER_ID, expires_at: REPLY_BY }],
    questions: [],
    checkins: [],
    cap: { cap: 2, used: 1 },
    now: toMs(SEEN_AT),
  });
  const first = OFFER_SAMPLE.asker.first;
  const rows: TranscriptRow[] = [
    ...hook.map((l) => row('H', l)),
    row('U', '/ask'),
    row('B'),
    call('pending_for_me'),
    ...receiptRows(pendingExample(true)),
    row('B'),
    row('C', `Reply to ${first}’s ask?`),
    row('O', '1. OK to intro: intro email to you both with your scheduling link'),
    row('O', `2. Answer in 2 lines: ${first} gets your lines without your name`),
    row('O', `3. No: private; ${first} isn’t told`),
    row('U', '1'),
    row('B'),
    approval('respond'),
    row('U', 'Yes'),
    row('B'),
    call('respond'),
    ...receiptRows(respondExample('ok')),
  ];
  return { rows, cut: null };
}

function tryTranscript(): Transcript {
  const rules = presetById('engineer').rules.split('\n').join(' ');
  return {
    rows: [row('S', INSTALL_MCP_COMMAND), row('B'), row('U', `Run my rules through ${MCP_SERVER_ID}: ${rules}`), row('B'), call('try_rules'), ...receiptRows(tryExample(true))],
    cut: null,
  };
}

export type DemoKey = 'ask' | 'asked' | 'try';

export function transcripts(): Record<DemoKey, Transcript> {
  return { ask: askTranscript(), asked: askedTranscript(), try: tryTranscript() };
}

/* ---------- one example result per tool ---------- */

export function toolExamples(): Record<ToolName, string[]> {
  const eng = SAMPLE_NETWORK_ASKS.engineer;
  const health = presetById('health');
  const healthDisplay = applyCap(
    SAMPLE_ASKS.map((a, i) => {
      const r = presetResults('health')[i];
      return { ask_id: a.id, day: a.day, gate: r && r.kind === 'gate' ? { verdict: r.decision.verdict, decided_by: r.decision.decided_by } : null };
    }),
    health.cap,
  ).results.map((r) => r.display);
  const n = (k: string) => healthDisplay.filter((d) => d === k).length;
  const source = presetSource();
  return {
    try_rules: [tryExample(false)],
    draft_ask: [
      draftReceipt({ id: 'd_7Kx2', parts: samplePartViews('sa_eng'), subject: eng.subject, text: '', network: 'sample', example: true }),
      draftReceipt({ id: 'd_7Kx2', parts: readyParts('sa_eng', 'the user'), subject: eng.subject, text: readyText('sa_eng'), network: 'sample', example: true }),
      draftRefusedReceipt('vague', eng.vague),
      draftRefusedReceipt('yc_application', ''),
    ],
    send_ask: [
      sendSampleReceipt({ ...exampleSampleSend('sa_eng', SENT_AT), at: SENT_AT }),
      sendRealReceipt({
        id: 'a_91xQ2k',
        total: 40,
        counts: { offered: 1, next: 1, question: 1, nothistime: 37 },
        offer: { reply_by: REPLY_BY },
        people_interrupted: 1,
        question_list: [{ qid: 'q_5Hd2', type: 'price', text: 'What do you charge per hospital, per year?', gates: 1 }],
        failed: 0,
        failed_closed: false,
        wall_ms: null,
        example_at: SENT_AT,
      }),
    ],
    answer_question: [
      answerReceipt({
        ask_id: 'a_91xQ2k',
        network: 'real',
        question: 'What do you charge per hospital, per year?',
        answer: '$18k a year per hospital',
        reran: 1,
        accepted: 1,
        offered_now: false,
        authored: false,
        wall_ms: null,
        example_at: ANSWER_AT,
      }),
    ],
    my_asks: [
      myAsksReceipt(
        [
          { id: 'a_91xQ2k', subject: OFFER_SAMPLE.subject, outcome: 'offered', status: `offered · reply by Thu Nov 12, 21:04 CST` },
          {
            id: 'a_7c2dWe',
            subject: 'First SOC 2 in 60 days, 20 min?',
            outcome: 'question',
            status: 'a gate has a question for you',
            question: { id: 'q_8kM3', type: 'deal_size', text: SAMPLE_NETWORK_ASKS.founder.ask_back[0]?.[1].text ?? 'How large is the bank contract, per year?' },
          },
          { id: 'a_3k9pZr', subject: 'Postgres p95 at 40M rows, 20 min?', outcome: 'intro', status: 'intro made · Sun Nov 8, 16:30 CST' },
        ],
        { example: true },
      ),
    ],
    pending_for_me: [pendingExample(false), pendingReceipt({ offers: [], questions: [], checkins: [], cap: { cap: 2, used: 1, month: '2026-11-01' }, now: toMs(SEEN_AT), example: true })],
    respond: [respondExample('ok'), respondExample('answer'), respondExample('no')],
    set_rules: [
      setRulesReceipt({
        version: 4,
        at: RULES_AT,
        lines: health.rules.split('\n').length,
        cap: health.cap,
        show_matched: false,
        guests: false,
        test: { reach: n('reach'), held: n('held'), ask: n('ask'), declined: n('decline') + n('code'), failed: n('failed'), source },
        example: true,
      }),
    ],
    record_outcome: [outcomeReceipt({ checkin_id: 'c_88', at: CHECKIN_AT, kind: 'd1', role: 'member', answer: { kind: 'd1', rating: 4 }, reminder_at: null, example: true })],
  };
}

/** The isError examples, then the one result that looks like an error but isn't (the idempotent repeat). */
export function errorExamples(): string[] {
  return [
    ERRORS.needsToken('send_ask on the real network'),
    '',
    ERRORS.rateLimited(LIMIT_AT),
    '',
    ERRORS.tooManyOpen(['a_91xQ2k', 'a_7c2dWe', 'a_3k9pZr']),
    '',
    ERRORS.modelSlow(),
    '',
    '# not an error: the idempotent repeat',
    alreadySentLine('a_91xQ2k', SENT_AT),
  ].flatMap((l) => l.split('\n'));
}

/** What the SessionStart hook prints when 3 things wait (fictional ids and names). */
export function hookExample(): string[] {
  return hookLines({
    offers: [{ offer_id: OFFER_ID, expires_at: REPLY_BY }],
    questions: [{ question_id: 'q_5Hd2', ask_id: 'a_91xQ2k', type: 'price' }],
    checkins: [{ checkin_id: 'c_88', kind: 'd1', other_name: OFFER_SAMPLE.member.name }],
    cap: { cap: 2, used: 1 },
    now: toMs(SEEN_AT),
  });
}
