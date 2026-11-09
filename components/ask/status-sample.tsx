'use client';

/**
 * S2 · /ask/sa_… — a SAMPLE ask's status (port of prototype/ask-status.html + a.js `Status`). The fan-out comes from
 * BE2's POST /api/asks/sample and lives in this tab (sample-store.ts); nobody is emailed and nothing is stored on a
 * server. Askers see four states; “Show what askers never see” reveals the rest because everything here is
 * fictional. The sample loop: “Open it as the member” → /o/sample?ask=<id>, and coming back shows what you did there.
 * QA states (?state=…) render canonical example data, labelled as hand-written, without storing or sending anything.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Bar, Diff } from '@/components/kit/blocks';
import { Button, ButtonLink } from '@/components/kit/button';
import { cx } from '@/components/kit/cx';
import { OfferCard } from '@/components/kit/offer-card';
import { Cap, SampleTag, Tag } from '@/components/kit/pills';
import { Help } from '@/components/kit/forms';
import { SwitchRow } from '@/components/kit/switch';
import { Legend, Waffle, type WaffleCellData } from '@/components/kit/waffle';
import { announce } from '@/components/site/live-region';
import { readStore } from '@/lib/oti/storage';
import { bareSubject, fmtMs, wordCount } from '@/lib/oti/text';
import { fmtClock, fmtDay, fmtWhen, OFFER_WINDOW_MS } from '@/lib/oti/time';
import type { QaState } from '@/lib/qa';
import { SAMPLE_NETWORK_ASKS, isSampleNetworkAskId, sampleNetworkAskById } from '@/lib/sample/network';
import { PRODUCT_NAME } from '@/lib/site';
import type { FanoutCellEventSample, FanoutOfferEvent, SampleNetworkAskId } from '@/lib/types';
import {
  allPassedCopy,
  ANSWER_FAILED,
  fanoutDoneAnnouncement,
  answeredCopy,
  deadlineCopy,
  failedClosedCopy,
  LOST_STREAM,
  movedOnCopy,
  NO_MATCH_COPY,
  NOT_IN_TAB_CUSTOM,
  NEW_ASK_HREF,
  NOT_IN_TAB_SAMPLE,
  OFFERED_YOU_COPY,
  offeredCopy,
  OFFLINE_SEND,
  partialFailureCopy,
  QUESTION_OUTCOME_COPY,
  QUESTION_OUTCOME_LABEL,
  questionLine,
  rerunCopy,
  SEND_FAILED_TITLE,
  SOLVED_COPY,
  ST_COPY,
  streamingCopy,
  withdrawnCopy,
  withoutNothingSent,
  WRITE_AN_ASK,
} from './copy';
import {
  acceptsInLine,
  applyAnswer,
  applyLoop,
  cellClassOf,
  cellDetail,
  cellView,
  emptyRun,
  exampleCompiled,
  exampleRun,
  holderCell,
  interrupted,
  isClosed,
  isSettled,
  isTerminal,
  isWaiting,
  legendItems,
  memberName,
  moveOn,
  NETWORK_TOTAL,
  pendingQuestions,
  sourceLine,
  traceRows,
  waffleLabel,
  whyLine,
  youAsked,
  youCell,
  type SampleQuestion,
  type SampleRun,
} from './fanout-model';
import { subscribeReturn, useDocumentTitle, useOnline, usePlayground, useReducedMotion } from './hooks';
import { ensureSampleRun, offerArrivedHere, resendSampleRun, stopSampleRun } from './sample-runner';
import { getRun, putRun, syncSharedStore, updateRun, useSampleRun } from './sample-store';
import { AskerCard, AskFacts, OutcomeCard, OutcomeNotice, QuestionAnswered, QuestionPending, StatusHead, TraceBlock, WithdrawControl, YourAskTitle } from './status-parts';
import type { LiveInfo } from './types';

export interface SampleStatusProps {
  id: string;
  qaState: QaState<'askStatus'> | null;
  live: LiveInfo;
}

/** POST /api/asks/sample/answer answers SampleAnswerResult (BE2) or a FanoutRefusal body. */
type SampleAnswerReply = { ok?: boolean; reran?: number; accepted?: number; cells?: FanoutCellEventSample[]; offer?: FanoutOfferEvent | null; message?: string };

/* ---------- QA examples: computed once per page load, on the client (they read the playground and the clock) ---------- */

const exampleCache = new Map<string, SampleRun>();
const never = () => () => undefined;

function exampleFor(id: string, state: QaState<'askStatus'>): SampleRun {
  const key = `${id}|${state}`;
  let run = exampleCache.get(key);
  if (!run) {
    const canonical: SampleNetworkAskId = isSampleNetworkAskId(id) ? id : 'sa_eng';
    run = exampleRun(canonical, state, readStore('playground'), Date.now());
    exampleCache.set(key, run);
  }
  return run;
}

function useExample(id: string, state: QaState<'askStatus'> | null): SampleRun | null {
  return useSyncExternalStore(
    never,
    () => (state && state !== 'real' ? exampleFor(id, state) : null),
    () => null,
  );
}

/**
 * The sample answer for a question on a sample ask (lib/sample, hand-written): prefilled when the sample ask says
 * the founder's own text answers it (the Health price), otherwise behind “Use sample answer”. None for custom text.
 */
function sampleAnswerFor(run: SampleRun, q: SampleQuestion): { value: string; prefilled: boolean } | null {
  const sa = run.sample_ask_id ? sampleNetworkAskById(run.sample_ask_id) : null;
  if (!sa) return null;
  if (sa.youAskBack && sa.youAskBack.type === q.type) return { value: sa.youAskBack.sampleAnswer, prefilled: true };
  return { value: sa.askBackSample, prefilled: false };
}

export function SampleStatus({ id, qaState, live }: SampleStatusProps) {
  const stored = useSampleRun(id);
  const example = useExample(id, qaState);
  const [qaRun, setQaRun] = useState<SampleRun | null>(null);
  const run: SampleRun | null | undefined = qaState ? (qaRun ?? example ?? undefined) : stored;
  const liveOff = live.state !== 'ok' && live.state !== 'slow';

  const update = (fn: (r: SampleRun) => SampleRun) => {
    if (qaState) setQaRun((prev) => {
      const base = prev ?? example;
      return base ? fn(base) : prev;
    });
    else updateRun(id, fn);
  };

  // Send (or resume after a reload) a run that is waiting in this tab.
  const outcome = stored?.outcome;
  useEffect(() => {
    if (!qaState && (outcome === 'ready' || outcome === 'streaming')) ensureSampleRun(id);
  }, [qaState, id, outcome]);

  // The shared oti.sampleAsk follows the ask on screen (R renders /o/sample?ask=… from it).
  useEffect(() => {
    if (!qaState && stored && stored.outcome !== 'ready') syncSharedStore(stored);
  }, [qaState, stored]);

  // The sample loop: what the visitor did as the member on /o/sample (oti.sampleOffer), applied once.
  useEffect(() => {
    if (qaState) return;
    const check = () => {
      const r = getRun(id);
      const so = readStore('sampleOffer');
      if (!r || !so || so.ask_id !== id || so.at < r.sent_at || !isWaiting(r.outcome)) return;
      const next = applyLoop(r, { action: so.action, at: so.at, text: so.text }, Date.now());
      if (next !== r) {
        putRun(next);
        announce(next.outcome === 'intro' ? 'Intro made.' : next.outcome === 'answered' ? 'A member answered in 2 lines.' : next.outcome === 'moved-on' ? 'Offered to the next person in line.' : 'Closed.');
      }
    };
    check();
    return subscribeReturn(check);
  }, [qaState, id]);

  const subject = run ? run.compiled.subject : null;
  useDocumentTitle(subject ? `${bareSubject(subject)} · ${PRODUCT_NAME}` : null);

  if (run === undefined) return <StatusShell id={id} />;
  if (run === null) return <NotInTab id={id} />;
  return <SampleStatusView run={run} id={id} qaState={qaState} liveOff={liveOff} update={update} />;
}

/* ---------- before hydration, and when this tab has nothing ---------- */

function StatusShell({ id }: { id: string }) {
  const sa = sampleNetworkAskById(id);
  return (
    <div className="container">
      <div className="st-grid">
        <StatusHead network="sample" crumb={{ href: NEW_ASK_HREF, label: ST_COPY.newAsk }} title={sa ? sa.subject : 'Your sample ask'} meta="SAMPLE network · 40 members" />
      </div>
    </div>
  );
}

function NotInTab({ id }: { id: string }) {
  const sa = sampleNetworkAskById(id);
  const online = useOnline();
  const pg = usePlayground();
  if (!sa) {
    return (
      <div className="container">
        <div className="st-grid">
          <StatusHead network="sample" crumb={{ href: NEW_ASK_HREF, label: ST_COPY.newAsk }} title="Your sample ask" meta="SAMPLE network · 40 members" />
          <div className="st-status">
            <OutcomeNotice kind="plain" title={null} action={<ButtonLink href="/ask" variant="primary" primary>{WRITE_AN_ASK}</ButtonLink>}>
              {NOT_IN_TAB_CUSTOM}
            </OutcomeNotice>
          </div>
        </div>
      </div>
    );
  }
  const send = () => {
    if (!online) return;
    const you = pg && pg.rules?.trim() ? { rules: pg.rules, cap: Math.max(1, Math.min(5, Math.round(pg.cap) || 2)) } : null;
    stopSampleRun(sa.id);
    putRun(emptyRun({ id: sa.id, preset: sa.preset, sample_ask_id: sa.id, text: sa.complete, compiled: exampleCompiled(sa), you, sent_at: Date.now() }));
    announce('Sending to 40 sample members.');
  };
  return (
    <div className="container">
      <div className="st-grid">
        <StatusHead network="sample" crumb={{ href: NEW_ASK_HREF, label: ST_COPY.newAsk }} title={sa.subject} meta="SAMPLE network · 40 members" />
        <div className="st-status">
          <OutcomeNotice
            kind="plain"
            title={null}
            action={
              <Button variant="primary" primary aria-disabled={!online} onClick={send}>
                Send to 40 sample members
              </Button>
            }
          >
            {NOT_IN_TAB_SAMPLE}
          </OutcomeNotice>
        </div>
        <section className="st-ask" aria-labelledby="st-ask-title">
          <YourAskTitle />
          <AskFacts parts={exampleCompiled(sa).parts} />
        </section>
      </div>
    </div>
  );
}

/* ---------- the page ---------- */

interface ViewProps {
  run: SampleRun;
  id: string;
  qaState: QaState<'askStatus'> | null;
  liveOff: boolean;
  update: (fn: (r: SampleRun) => SampleRun) => void;
}

function SampleStatusView({ run, id, qaState, liveOff, update }: ViewProps) {
  const reduced = useReducedMotion();
  const online = useOnline();
  const [reveal, setReveal] = useState(false);
  const [pop, setPop] = useState<{ pos: number; left: number; top: number } | null>(null);
  const [qShown, setQShown] = useState(qaState === 'ask-back');
  const [answer, setAnswer] = useState<{ qid: string; value: string } | null>(null);
  const [answerState, setAnswerState] = useState<{ sending: boolean; error: string | null }>({ sending: false, error: null });
  const outcomeRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const sa = run.sample_ask_id ? sampleNetworkAskById(run.sample_ask_id) : null;
  const preset = SAMPLE_NETWORK_ASKS[run.preset];
  const total = run.plan?.total ?? run.cells.length ?? NETWORK_TOTAL;
  const streaming = run.outcome === 'streaming' || run.outcome === 'ready';
  const holder = holderCell(run);
  const you = youCell(run);
  const pending = pendingQuestions(run);
  const q = pending[0] ?? null;
  const lastAnswer = run.answers[run.answers.length - 1] ?? null;
  const waiting = isWaiting(run.outcome);
  const openHref = `/o/sample?ask=${encodeURIComponent(id)}`;
  const replyBy = (ms: number) => fmtWhen(ms);
  const replyByLabel = run.offered_at !== null ? replyBy(run.offered_at + OFFER_WINDOW_MS) : '';
  const youAskedQ = !!q && youAsked(run, q);
  const showQuestionCard = (!!q && (run.outcome === 'question' || qaState === 'ask-back' || youAskedQ || qShown) && (waiting || run.outcome === 'question')) || (!q && !!lastAnswer && (waiting || run.outcome === 'question'));
  const questionFirst = !!q && (run.outcome === 'question' || qaState === 'ask-back');
  const showQLine = !!q && !showQuestionCard && (waiting || run.outcome === 'question');
  const questionPending = !!q && showQuestionCard;
  const offeredWaiting = waiting && !!holder;

  // One announcement when a fan-out this page watched finishes (never per cell: ux-spec §9).
  const seen = useRef(run.outcome);
  useEffect(() => {
    const was = seen.current;
    seen.current = run.outcome;
    if (was === run.outcome || (was !== 'streaming' && was !== 'ready')) return;
    const line = fanoutDoneAnnouncement(run.outcome);
    if (line) announce(line);
  }, [run.outcome]);

  // Esc closes the popover and returns focus to its cell; a click elsewhere closes it.
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const cell = wrapRef.current?.querySelector<HTMLElement>(`.waffle > :nth-child(${pop.pos + 1})`);
      setPop(null);
      cell?.focus();
    };
    const onClick = (e: globalThis.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.st-waffle') && !t.closest('.st-pop')) setPop(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [pop]);

  /* ----- actions ----- */

  function focusOutcome() {
    requestAnimationFrame(() => outcomeRef.current?.focus());
  }
  function onWithdraw() {
    update((r) => ({ ...r, outcome: 'withdrawn', withdrawn_at: Date.now() }));
    announce('Withdrawn.');
    focusOutcome();
  }
  function onSolved() {
    update((r) => ({ ...r, outcome: 'closed', closed_at: Date.now() }));
    announce('Closed.');
    focusOutcome();
  }
  function onKeepOpen() {
    update((r) => moveOn(r, Date.now()));
    announce('Offered to the next person in line.');
    focusOutcome();
  }
  function onRetry() {
    if (qaState) {
      // QA: the example runs again to its natural result (no request; example data stays example data).
      const canonical: SampleNetworkAskId = isSampleNetworkAskId(id) ? id : 'sa_eng';
      update(() => exampleRun(canonical, 'offered', readStore('playground'), Date.now()));
      announce('Offered to 1 person. 1 person interrupted.');
      focusOutcome();
      return;
    }
    resendSampleRun(id);
    announce('Sending to 40 sample members again.');
  }
  const suggestion = q ? sampleAnswerFor(run, q) : null;
  const answerValue = q ? (answer?.qid === q.qid ? answer.value : suggestion?.prefilled ? suggestion.value : '') : '';

  async function onSendAnswer() {
    if (!q || answerState.sending) return;
    const value = answerValue.trim();
    if (!value) {
      document.getElementById('st-answer')?.focus();
      return;
    }
    setAnswerState({ sending: true, error: null });
    let res: Response | null = null;
    try {
      res = await fetch('/api/asks/sample/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        // Your own rules go along only when your gate asked: only the gates that asked rerun.
        body: JSON.stringify({ sample_ask_id: run.id, compiled: run.compiled, you: youAsked(run, q) ? run.you : null, question: { type: q.type, text: q.text }, answer: value }),
        cache: 'no-store',
      });
    } catch {
      res = null;
    }
    let body: SampleAnswerReply | null = null;
    try {
      body = res ? ((await res.json()) as SampleAnswerReply) : null;
    } catch {
      body = null;
    }
    const ok = !!res && res.ok && !!body && body.ok === true;
    if (!ok || !body) {
      setAnswerState({ sending: false, error: body && typeof body.message === 'string' && body.message ? body.message : ANSWER_FAILED });
      return;
    }
    const result = { reran: Number(body.reran) || 0, accepted: Number(body.accepted) || 0, cells: Array.isArray(body.cells) ? body.cells : [], offer: body.offer ?? null };
    update((r) => applyAnswer(r, q, value, result, Date.now()));
    setAnswerState({ sending: false, error: null });
    announce(rerunCopy(result.reran, result.accepted, !!result.offer && !run.offered.length));
    requestAnimationFrame(() => document.getElementById('st-question')?.focus({ preventScroll: true }));
  }
  function onOpenQuestion() {
    setQShown(true);
    requestAnimationFrame(() => {
      const inp = document.getElementById('st-answer');
      inp?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      inp?.focus({ preventScroll: true });
    });
  }
  function onCell(pos: number) {
    if (pop?.pos === pos) {
      setPop(null);
      return;
    }
    const wrap = wrapRef.current;
    const btn = wrap?.querySelector<HTMLElement>(`.waffle > :nth-child(${pos + 1})`);
    if (!wrap || !btn) return;
    const width = Math.min(280, wrap.clientWidth);
    const left = Math.max(0, Math.min(btn.offsetLeft + btn.offsetWidth / 2 - width / 2, wrap.clientWidth - width));
    setPop({ pos, left, top: btn.offsetTop + btn.offsetHeight + 6 });
  }

  /* ----- the waffle ----- */

  const hideProgress = reduced && streaming;
  const cells: WaffleCellData[] = Array.from({ length: total }, (_, pos) => {
    const c = run.cells[pos] ?? null;
    const view = hideProgress ? 'checking' : cellView(run, pos, reveal);
    const state = cellClassOf(view);
    return {
      state,
      you: !!c?.you && !hideProgress,
      label: reveal && c ? cellDetail(run, pos, liveOff) : undefined,
      pressed: reveal ? pop?.pos === pos : undefined,
    };
  });
  const legend = hideProgress ? [{ state: 'checking' as const, text: `${total} checking` }] : legendItems(run, reveal);
  const answered = run.cells.filter((c) => !!c).length;
  const n = streaming && !run.offer ? 0 : interrupted(run);
  const words = wordCount(run.compiled.text);
  const rows = traceRows(run, reveal, replyBy, words, liveOff);
  // The duration only when a gate actually ran (a live gate or a model recording); hand-written results take no time.
  const ran = run.plan?.sample_source === 'live' || run.plan?.sample_source === 'model' || (!!you && you.source === 'live' && you.state !== 'failed');
  const meta = `Sent ${fmtDay(run.sent_at)}, ${fmtClock(run.sent_at)} · SAMPLE network · ${total} members${run.done && !run.example && ran ? ` · ${fmtMs(run.done.wall_ms)}` : ''}`;

  /* ----- outcome ----- */

  const resendHref = sa ? `/ask?preset=${sa.preset}` : '/ask';
  const resend = (
    <div className="btn-row">
      <ButtonLink href={resendHref} size="sm" primary>
        {ST_COPY.editResend}
      </ButtonLink>
    </div>
  );
  let outcome: ReactNode;
  switch (run.outcome) {
    case 'ready':
    case 'streaming':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="checking" label="Checking">
          {streamingCopy(hideProgress ? null : answered, total)}
        </OutcomeCard>
      );
      break;
    case 'offered':
    case 'offered-you':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="offered" label="Offered · waiting">
          {holder?.you ? (
            <>
              {OFFERED_YOU_COPY}{' '}
              <Link className="link" href={openHref}>
                See what you’d get
              </Link>
              .
            </>
          ) : (
            offeredCopy(replyByLabel)
          )}
        </OutcomeCard>
      );
      break;
    case 'moved-on':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="offered" label="Offered · waiting">
          {movedOnCopy(run.offered.length, acceptsInLine(run), replyByLabel)}
        </OutcomeCard>
      );
      break;
    case 'question':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="notrun" label={QUESTION_OUTCOME_LABEL}>
          {QUESTION_OUTCOME_COPY}
        </OutcomeCard>
      );
      break;
    case 'answered':
      outcome = (
        <OutcomeCard
          ref={outcomeRef}
          pill="on"
          label="Answered in 2 lines"
          extra={
            <>
              <div className="btn-row">
                <Button variant="primary" primary onClick={onSolved}>
                  {ST_COPY.solved}
                </Button>
                <Button onClick={onKeepOpen}>{ST_COPY.keepOpen}</Button>
              </div>
              <p className="help st-help">{ST_COPY.answerHelp72}</p>
            </>
          }
        >
          {answeredCopy(run.member_answer ?? sa?.answeredSample ?? '')}
        </OutcomeCard>
      );
      break;
    case 'intro': {
      const name = memberName(holder);
      const links = (
        <p className="small st-links">
          <Link className="link" href={`/emails/intro?ask=${encodeURIComponent(id)}`}>
            {ST_COPY.introEmail}
          </Link>{' '}
          <Link className="link" href={`/c/sample?ask=${encodeURIComponent(id)}&role=${holder?.you ? 'member' : 'asker'}`}>
            {ST_COPY.checkin}
          </Link>
        </p>
      );
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="on" label="Intro made" extra={links}>
          {holder?.you
            ? 'You said OK as the member, so the intro email went to you both (sample, no email was sent). Reply-all to pick a time. Tomorrow we’ll ask each of you one question.'
            : `${name ? `${name.name} (${name.line})` : 'The member'} said OK. The intro email went to you both (sample, no email was sent). Reply-all to pick a time. Tomorrow we’ll ask you one question.`}
        </OutcomeCard>
      );
      break;
    }
    case 'no-match':
      outcome = (
        <OutcomeCard
          ref={outcomeRef}
          pill="decline"
          label="No match"
          extra={
            <>
              <p className="small st-why">{whyLine(run)}</p>
              {sa ? <p className="small">{sa.noMatchEdit.why}</p> : null}
              {resend}
              <p className="help st-help">{ST_COPY.resendWeek}</p>
            </>
          }
        >
          {NO_MATCH_COPY}
        </OutcomeCard>
      );
      break;
    case 'closed-all-passed':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="decline" label="Closed" extra={resend}>
          {allPassedCopy(run.offered.length)}
        </OutcomeCard>
      );
      break;
    case 'expired-deadline':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="decline" label="Closed">
          {deadlineCopy(run.compiled.parts.by, run.offered.length)}
        </OutcomeCard>
      );
      break;
    case 'closed':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="decline" label="Closed">
          {SOLVED_COPY}
        </OutcomeCard>
      );
      break;
    case 'withdrawn':
      outcome = (
        <OutcomeCard ref={outcomeRef} pill="paused" label="Withdrawn">
          {withdrawnCopy(fmtDay(run.withdrawn_at ?? run.sent_at), true)}
        </OutcomeCard>
      );
      break;
    case 'failed-closed':
      outcome = (
        <OutcomeNotice ref={outcomeRef} kind="error" title={SEND_FAILED_TITLE} action={<Button size="sm" primary onClick={onRetry}>Retry</Button>}>
          {failedClosedCopy(run.done?.gates_failed ?? null, run.done?.gates_ran ?? null)}
        </OutcomeNotice>
      );
      break;
    case 'refused': {
      const r = run.refusal;
      outcome = (
        <OutcomeNotice
          ref={outcomeRef}
          kind={r && (r.status === 429 || r.status === 503) ? 'warn' : 'error'}
          title={SEND_FAILED_TITLE}
          action={
            <div className="btn-row">
              <Button size="sm" primary aria-disabled={!online} onClick={() => online && onRetry()}>
                Try again
              </Button>
              <Link className="link" href="/ask">
                Edit your ask ›
              </Link>
            </div>
          }
        >
          {withoutNothingSent(r?.message ?? '') || 'The sample network didn’t take this ask.'}
        </OutcomeNotice>
      );
      break;
    }
    case 'lost':
    case 'offline':
      outcome = (
        <OutcomeNotice
          ref={outcomeRef}
          kind={run.outcome === 'offline' ? 'plain' : 'error'}
          title={SEND_FAILED_TITLE}
          action={
            <Button size="sm" primary aria-disabled={!online} onClick={() => online && onRetry()}>
              Try again
            </Button>
          }
        >
          {run.outcome === 'offline' ? OFFLINE_SEND : LOST_STREAM}
        </OutcomeNotice>
      );
      break;
  }

  /* ----- the question card ----- */

  let questionCard: ReactNode = null;
  if (showQuestionCard && q) {
    questionCard = (
      <QuestionPending
        question={q}
        value={answerValue}
        onValue={(v) => {
          setAnswer({ qid: q.qid, value: v });
          if (answerState.error) setAnswerState({ sending: false, error: null });
        }}
        onSend={() => void onSendAnswer()}
        sending={answerState.sending}
        error={answerState.error}
        prefilled={!!suggestion?.prefilled && answerValue === suggestion.value}
        sample={suggestion && !suggestion.prefilled ? suggestion.value : null}
        primary
      />
    );
  } else if (showQuestionCard && lastAnswer) {
    questionCard = <QuestionAnswered copy={rerunCopy(lastAnswer.reran, lastAnswer.accepted, lastAnswer.offer)} answer={lastAnswer.text} />;
  }

  /* ----- your gate, the side card ----- */

  let youLine: ReactNode;
  if (!you && streaming && run.you) {
    youLine = 'Your gate: checking…';
  } else if (!you) {
    youLine = (
      <>
        {ST_COPY.noRules}{' '}
        <Link className="link" href="/rules">
          {ST_COPY.noRulesLink}
        </Link>{' '}
        {ST_COPY.noRulesTail}
      </>
    );
  } else if (hideProgress) {
    youLine = 'Your gate: checking…';
  } else {
    const v = cellView(run, you.cell, false);
    const cite = you.cited ? ` Cited “${you.cited}” ✓` : '';
    if (v === 'offered') youLine = `Your gate: accepted and has the offer.${cite}`;
    else if (you.state === 'accept') youLine = `${run.answers.some((a) => a.you) && !isClosed(run.outcome) ? 'Your gate: reran on your answer and accepted; next in line.' : isClosed(run.outcome) ? 'Your gate: accepted.' : 'Your gate: accepted; next in line.'}${cite}`;
    else if (you.state === 'ask_back') youLine = `Your gate: asked a question first.${cite}`;
    else if (you.state === 'failed') youLine = liveOff ? 'Your gate: not checked. Live checks are off on this instance, so your rules didn’t run; that never counts as an accept.' : 'Your gate: not checked (no answer in time). A failed gate never counts as an accept.';
    else youLine = you.cited ? `Your gate: declined, citing “${you.cited}”.` : 'Your gate: declined. No line in your rules covers this ask.';
  }

  const memberView = reveal && !!holder && !isClosed(run.outcome);
  const noMatch = run.outcome === 'no-match';
  const closedish = ['closed-all-passed', 'expired-deadline', 'failed-closed', 'withdrawn', 'streaming', 'ready', 'refused', 'lost', 'offline'].includes(run.outcome);
  const fromLine = [preset.as.name, preset.as.company, preset.as.stage, preset.as.city].join(' · ');
  const showOpen = !!holder && !isClosed(run.outcome) && !noMatch && isSettled(run.outcome);
  const openPrimary = offeredWaiting && !questionPending;

  let side: ReactNode;
  if (noMatch) {
    side = sa ? (
      <aside className="st-side" aria-labelledby="st-side-title">
        <div className="split st-side__head">
          <h2 className="h3" id="st-side-title">
            {ST_COPY.sideChange}
          </h2>
          <SampleTag />
        </div>
        <div className="st-change" id="st-change">
          <Diff
            label="Suggested edit to your ask"
            lines={[
              { kind: 'ctx', text: sa.noMatchEdit.context },
              { kind: 'add', text: sa.noMatchEdit.add },
            ]}
          />
          <Help>{ST_COPY.changeHelp}</Help>
          <div className="btn-row">
            <ButtonLink href={`/ask?preset=${sa.preset}&edit=1`}>{ST_COPY.useEdit}</ButtonLink>
          </div>
        </div>
      </aside>
    ) : null;
  } else {
    const cap = holder?.cap ?? 2;
    const nth = holder ? holder.used + 1 : 1;
    side = (
      <aside className="st-side" aria-labelledby="st-side-title">
        <div className="split st-side__head">
          <h2 className="h3" id="st-side-title">
            {memberView ? ST_COPY.sideMember : ST_COPY.sideAsker}
          </h2>
          <SampleTag />
        </div>
        {memberView ? (
          <>
            <p className="small st-side-cap" id="st-side-cap">
              {ST_COPY.sideCaption}
            </p>
            <OfferCard
              titleId="st-card-title"
              kicker={
                <>
                  <Tag kind="attn">Ask for you</Tag>
                  <span>
                    {nth} of your {cap} this month
                  </span>
                  <Cap cap={cap} used={nth} hidden />
                </>
              }
              title={bareSubject(run.compiled.subject)}
              from={fromLine}
              match={
                holder?.cited ? (
                  <>
                    Matched your rule: <mark className="mark">“{holder.cited}”</mark>
                  </>
                ) : undefined
              }
              fine={`The founder sees your name only if you choose OK. A No is private. This counts as ${nth} of your ${cap} whatever you answer.`}
              facts={[]}
            />
          </>
        ) : (
          <AskerCard title={bareSubject(run.compiled.subject)} from={fromLine} matched={!closedish && !!holder} />
        )}
        {showOpen ? (
          <p className="st-open-row" id="st-open-row">
            <ButtonLink href={openHref} variant={openPrimary ? 'primary' : 'outline'} size="lg" className="hide-phone" primary={openPrimary} id="st-open">
              {ST_COPY.open}
            </ButtonLink>
            <Link className="link hide-desk" href={openHref} id="st-open-m">
              {ST_COPY.openPhone}
            </Link>
          </p>
        ) : null}
      </aside>
    );
  }

  const canWithdraw = !isTerminal(run.outcome) && !streaming && !['refused', 'lost', 'offline'].includes(run.outcome);
  // Your own gate not run because live checks are off is said once, on its own line (st-you), not as a failure.
  const youOff = !!you && you.state === 'failed' && liveOff ? 1 : 0;
  const failedGates = run.done ? run.done.gates_failed - youOff : 0;
  const ranGates = run.done && run.done.gates_ran !== null ? run.done.gates_ran - youOff : null;
  const partial = !!run.done && !run.done.failed_closed && failedGates > 0;
  const barAnswer = questionPending;
  const barOpen = !barAnswer && offeredWaiting;
  const popCell = pop ? cellDetail(run, pop.pos, liveOff) : null;
  const bump = n > 0 && offerArrivedHere(id);

  return (
    <>
      <div className="container">
        <div className="st-grid">
          <StatusHead network="sample" crumb={{ href: NEW_ASK_HREF, label: ST_COPY.newAsk }} title={run.compiled.subject} meta={meta} />

          <div className="st-status">
            {questionFirst ? questionCard : null}
            {outcome}
            {questionFirst ? null : questionCard}
          </div>

          <section className="panel st-fanout" aria-labelledby="st-fan-title">
            <div className="split st-fanout__head">
              <h2 className="h3" id="st-fan-title">
                {ST_COPY.fanout}
              </h2>
              <p className="small">
                {ST_COPY.interrupted}{' '}
                <b key={n} className={cx('st-count', n > 0 && 'orange-text', bump && 'st-bump')} id="st-interrupted">
                  {n}
                </b>
              </p>
            </div>
            <div className="st-waffle-wrap" id="st-waffle-wrap" ref={wrapRef} aria-busy={streaming ? true : undefined}>
              <Waffle className="st-waffle" id="st-waffle" cells={cells} label={waffleLabel(legend, total)} onCellClick={reveal && !streaming ? onCell : undefined} />
              {pop && popCell ? (
                <div className="popover st-pop" id="st-pop" aria-hidden="true" style={{ left: pop.left, top: pop.top }}>
                  {popCell}
                </div>
              ) : null}
            </div>
            <Legend items={legend} id="st-legend" />
            <p className="small st-you" id="st-you">
              {youLine}
            </p>
            {showQLine && q ? (
              <p className="small st-qline" id="st-qline">
                {questionLine(q.text, q.gates)}{' '}
                <Button variant="ghost" size="sm" id="st-qopen" onClick={onOpenQuestion}>
                  {ST_COPY.answerIt}
                </Button>
              </p>
            ) : null}
            {partial ? (
              <p className="small" id="st-partial">
                {partialFailureCopy(failedGates, ranGates)}
              </p>
            ) : null}
            <p className="meta" id="st-replay">
              {sourceLine(run, liveOff)}
            </p>
            <div className="st-reveal" id="st-reveal-row">
              <SwitchRow
                id="st-reveal"
                label={ST_COPY.revealLabel}
                checked={reveal}
                onChange={(on) => {
                  setReveal(on);
                  setPop(null);
                }}
              />
            </div>
            {reveal ? (
              <p className="small st-reveal-note" id="st-reveal-note">
                {ST_COPY.revealNote}
              </p>
            ) : null}
            <TraceBlock rows={rows} />
          </section>

          <section className="st-ask" aria-labelledby="st-ask-title">
            {canWithdraw ? <WithdrawControl onConfirm={onWithdraw} /> : <YourAskTitle />}
            <AskFacts parts={run.compiled.parts} />
          </section>

          {side}
        </div>
      </div>

      {barAnswer || barOpen ? (
        <Bar>
          {barAnswer ? (
            <Button
              variant="primary"
              className="st-bar-btn"
              id="st-bar-btn"
              primary
              busy={answerState.sending}
              onClick={() => {
                const inp = document.getElementById('st-answer') as HTMLInputElement | null;
                if (!inp || !inp.value.trim()) {
                  inp?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
                  inp?.focus({ preventScroll: true });
                  return;
                }
                void onSendAnswer();
              }}
            >
              {answerState.sending ? 'Sending…' : ST_COPY.sendAnswer}
            </Button>
          ) : (
            <ButtonLink href={openHref} variant="primary" className="st-bar-btn" id="st-bar-link" primary>
              {ST_COPY.open}
            </ButtonLink>
          )}
        </Bar>
      ) : null}
    </>
  );
}
