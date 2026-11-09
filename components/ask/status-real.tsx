'use client';

/**
 * S2 · /ask/a_… — a REAL ask's status, owner only, rendered from BE2's serialized AskerAskView (four asker states,
 * checkpointed times; docs/CONTRACT.md §d). The send, end to end (§c): outcome `ready` → POST /api/asks/[id]/send
 * once and render the stream; 409 already_sent → read the view and tail it; `gating` → EventSource tail on
 * GET /api/asks/[id], closed on `end`; at `done`, re-read the view. Asker-visible changes land at 09:00/21:00 Mexico
 * City, so the page re-reads at `next_checkpoint` and when the tab comes back.
 */

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { Bar, Diff } from '@/components/kit/blocks';
import { Button, ButtonLink } from '@/components/kit/button';
import { cx } from '@/components/kit/cx';
import { Help } from '@/components/kit/forms';
import { RealTag } from '@/components/kit/pills';
import { Legend, Waffle } from '@/components/kit/waffle';
import { announce } from '@/components/site/live-region';
import { bareSubject, fmtMs, lower1, stripEnd } from '@/lib/oti/text';
import { fmtClock, fmtDay, fmtWhen } from '@/lib/oti/time';
import { postSse } from '@/lib/sse';
import { PRODUCT_NAME } from '@/lib/site';
import type { AskerAskView, AskerCellState, AskerQuestion, FanoutDoneEvent, FanoutEvent } from '@/lib/types';
import {
  allPassedCopy,
  ANSWER_FAILED,
  ACTION_FAILED,
  ANSWER_TIMEOUT_COPY,
  answeredCopy,
  ASKER_CLOSED_COPY,
  deadlineCopy,
  EXAMPLE_REAL_NOTE,
  failedClosedCopy,
  fanoutDoneAnnouncement,
  movedOnCopy,
  NO_MATCH_COPY,
  offeredCopy,
  partialFailureCopy,
  QUESTION_OUTCOME_COPY,
  QUESTION_OUTCOME_LABEL,
  QUEUED_COPY,
  REAL_SEND_OFFLINE,
  REAL_SEND_REFUSED,
  REAL_VIEW_LOST,
  questionLine,
  rerunCopy,
  SEND_FAILED_TITLE,
  SOLVED_COPY,
  ST_COPY,
  streamingCopy,
  withdrawnCopy,
  withoutNothingSent,
} from './copy';
import { realCellClass, realLegend, realWhyLine, splitTraceLine, waffleLabel } from './fanout-model';
import { subscribeReturn, useDocumentTitle, useReducedMotion, useViewerTz } from './hooks';
import { AskerCard, AskFacts, OutcomeCard, OutcomeNotice, QuestionAnswered, QuestionPending, StatusHead, TraceLines, WithdrawControl, YourAskTitle } from './status-parts';

export interface RealStatusProps {
  initial: AskerAskView;
  /** The asker's card “from” line (name · company · stage · city), from their profile. */
  from: string;
  /** The QA example (`?state=real`): no request is ever made; actions change only this page. */
  example?: boolean;
}

/** Sends started in this page load (React mounts twice in development; a send must go out once). */
const startedSends = new Set<string>();

interface SendState {
  phase: 'idle' | 'sending' | 'done' | 'refused';
  cells: (AskerCellState | null)[];
  done: FanoutDoneEvent | null;
  message: string | null;
  status: number | null;
}

type SendAction = { type: 'start' } | { type: 'event'; ev: FanoutEvent } | { type: 'refused'; status: number; message: string } | { type: 'reset' };

function sendReducer(s: SendState, a: SendAction): SendState {
  switch (a.type) {
    case 'start':
      return { phase: 'sending', cells: s.cells, done: null, message: null, status: null };
    case 'event': {
      const ev = a.ev;
      if (ev.event === 'plan') return { ...s, cells: new Array(Math.max(1, Math.min(500, Math.round(ev.data.total) || 0))).fill(null) };
      if (ev.event === 'cell') {
        const cells = s.cells.slice();
        const d = ev.data as { cell: number; state: AskerCellState };
        if (typeof d.cell === 'number' && d.cell >= 0) {
          while (cells.length <= d.cell) cells.push(null);
          cells[d.cell] = d.state;
        }
        return { ...s, cells };
      }
      if (ev.event === 'error') return { ...s, message: ev.data.message };
      if (ev.event === 'done') return { ...s, phase: 'done', done: ev.data };
      return s;
    }
    case 'refused':
      return { ...s, phase: 'refused', status: a.status, message: a.message };
    case 'reset':
      return { phase: 'idle', cells: [], done: null, message: null, status: null };
  }
}

async function readView(id: string): Promise<AskerAskView | null> {
  try {
    const res = await fetch(`/api/asks/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as AskerAskView;
    return v && typeof v === 'object' && v.id === id && Array.isArray(v.cells) ? v : null;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, body: json };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const TERMINAL = ['withdrawn', 'intro', 'closed', 'no_match', 'failed'];

export function RealStatus({ initial, from, example }: RealStatusProps) {
  const [view, setView] = useState(initial);
  const [send, dispatch] = useReducer(sendReducer, { phase: 'idle', cells: [], done: null, message: null, status: null });
  const [answer, setAnswer] = useState<{ qid: string; value: string } | null>(null);
  const [busy, setBusy] = useState<{ answer: boolean; withdraw: boolean; resolve: boolean }>({ answer: false, withdraw: false, resolve: false });
  const [errors, setErrors] = useState<{ answer: string | null; withdraw: string | null; resolve: string | null }>({ answer: null, withdraw: null, resolve: null });
  const [lastRerun, setLastRerun] = useState<{ qid: string; reran: number; accepted: number; offer: boolean } | null>(null);
  const [qShown, setQShown] = useState(false);
  const keys = useRef(new Map<string, string>());
  const outcomeRef = useRef<HTMLDivElement>(null);
  const tz = useViewerTz();
  const reduced = useReducedMotion();
  const id = view.id;

  const keyFor = (action: string) => {
    let k = keys.current.get(action);
    if (!k) {
      k = newKey();
      keys.current.set(action, k);
    }
    return k;
  };

  // Reads the view again (3 tries over about 4 s). When it can't, the page says so instead of spinning.
  const [stuck, setStuck] = useState(false);
  const reload = useCallback(async (): Promise<void> => {
    for (const wait of [0, 1_000, 3_000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const v = await readView(id);
      if (v) {
        setStuck(false);
        setView(v);
        return;
      }
    }
    setStuck(true);
  }, [id]);

  // 1. A created ask that hasn't been sent: send it once and render the stream; at done, read the view.
  //    `attempt` goes up when the asker presses Try again after a refused or lost send.
  const outcome = view.outcome;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (example || outcome !== 'ready') return;
    const key = `${id}#${attempt}`;
    if (startedSends.has(key)) return;
    startedSends.add(key);
    dispatch({ type: 'start' });
    void postSse<FanoutEvent>(`/api/asks/${encodeURIComponent(id)}/send`, {}, (ev) => dispatch({ type: 'event', ev })).then(async (res) => {
      if (res.ok) {
        // The fan-out runs on without this page (detached on the server): a cut stream means follow the view.
        if (!res.completed) dispatch({ type: 'reset' });
        await reload();
        return;
      }
      if ('aborted' in res) return;
      if ('offline' in res) {
        dispatch({ type: 'refused', status: 0, message: REAL_SEND_OFFLINE });
        return;
      }
      const body = (res.body ?? {}) as { error?: string; message?: string };
      if (res.status === 409) {
        // Sent from another tab or before a reload: read it and follow it.
        dispatch({ type: 'reset' });
        await reload();
        return;
      }
      dispatch({ type: 'refused', status: res.status, message: typeof body.message === 'string' && body.message ? body.message : REAL_SEND_REFUSED });
    });
  }, [example, outcome, id, attempt, reload]);

  // 2. A fan-out running elsewhere (another tab, a reload, or a stream that was cut): tail it. The server ends a
  //    tail after about 55 s; a fan-out still running then gets a new one, a few times at most.
  const [tailRound, setTailRound] = useState(0);
  useEffect(() => {
    if (example || outcome !== 'gating' || send.phase === 'sending' || typeof EventSource === 'undefined') return;
    let ended = false;
    let again: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(`/api/asks/${encodeURIComponent(id)}`);
    es.addEventListener('view', (e) => {
      try {
        const v = JSON.parse((e as MessageEvent<string>).data) as AskerAskView;
        if (v && v.id === id) setView(v);
      } catch {
        /* a malformed event is skipped */
      }
    });
    es.addEventListener('end', (e) => {
      ended = true;
      es.close();
      let reason = 'settled';
      try {
        reason = (JSON.parse((e as MessageEvent<string>).data) as { reason?: string }).reason ?? 'settled';
      } catch {
        /* no reason: treat as settled */
      }
      if (reason === 'timeout' && tailRound < 4) again = setTimeout(() => setTailRound((n) => n + 1), 2_000);
      else if (reason !== 'settled') void reload();
    });
    es.onerror = () => {
      if (!ended && es.readyState === EventSource.CLOSED) void reload();
    };
    return () => {
      ended = true;
      es.close();
      if (again) clearTimeout(again);
    };
  }, [example, outcome, id, send.phase, tailRound, reload]);

  // 3. Asker-visible changes land at checkpoints: read again then, and when the visitor comes back.
  const nextCheckpoint = view.next_checkpoint;
  useEffect(() => {
    if (example || TERMINAL.includes(outcome)) return;
    let last = 0;
    const refresh = () => {
      const now = Date.now();
      if (now - last < 20_000) return;
      last = now;
      void readView(id).then((v) => v && setView(v));
    };
    const wait = Date.parse(nextCheckpoint) - Date.now();
    const timer = Number.isFinite(wait) && wait > 0 && wait < 13 * 3_600_000 ? setTimeout(refresh, wait + 5_000) : null;
    const off = subscribeReturn(refresh);
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [example, outcome, id, nextCheckpoint]);

  useDocumentTitle(view.subject ? `${bareSubject(view.subject)} · ${PRODUCT_NAME}` : null);

  /* ----- actions ----- */

  async function act(kind: 'withdraw' | 'resolve', body: Record<string, unknown>, keyName: string, local: (v: AskerAskView) => AskerAskView) {
    if (busy[kind]) return;
    if (example) {
      setView(local(view));
      requestAnimationFrame(() => outcomeRef.current?.focus());
      return;
    }
    setBusy((b) => ({ ...b, [kind]: true }));
    setErrors((e) => ({ ...e, [kind]: null }));
    const res = await postJson(`/api/asks/${encodeURIComponent(id)}/${kind}`, { ...body, idempotency_key: keyFor(keyName) });
    setBusy((b) => ({ ...b, [kind]: false }));
    if (!res.ok) {
      setErrors((e) => ({ ...e, [kind]: typeof res.body?.message === 'string' && res.body.message ? res.body.message : ACTION_FAILED }));
      return;
    }
    const v = await readView(id);
    if (v) setView(v);
    else setView(local(view));
    requestAnimationFrame(() => outcomeRef.current?.focus());
  }

  function onWithdraw() {
    announce('Withdrawn.');
    void act('withdraw', {}, 'withdraw', (v) => ({ ...v, outcome: 'withdrawn', withdrawn_at: new Date().toISOString(), offered: null }));
  }
  function onResolve(solved: boolean) {
    void act('resolve', { solved }, `resolve:${solved}`, (v) => (solved ? { ...v, outcome: 'closed', closed: { reason: 'solved', offered_count: v.people_interrupted, at: new Date().toISOString() } } : v));
  }

  const pending = view.questions.filter((q) => q.answer === null);
  const q: AskerQuestion | null = pending[0] ?? null;
  const answeredQ = [...view.questions].reverse().find((x) => x.answer !== null) ?? null;
  const answerValue = q && answer?.qid === q.id ? answer.value : '';

  async function onSendAnswer() {
    if (!q || busy.answer) return;
    const value = answerValue.trim();
    if (!value) {
      document.getElementById('st-answer')?.focus();
      return;
    }
    if (example) return;
    setBusy((b) => ({ ...b, answer: true }));
    setErrors((e) => ({ ...e, answer: null }));
    const hadOffer = !!view.offered;
    const res = await postJson(`/api/asks/${encodeURIComponent(id)}/answer`, { question_id: q.id, answer: value, idempotency_key: keyFor(`answer:${q.id}`) });
    setBusy((b) => ({ ...b, answer: false }));
    if (!res.ok || res.body?.ok !== true) {
      setErrors((e) => ({ ...e, answer: typeof res.body?.message === 'string' && res.body.message ? res.body.message : ANSWER_FAILED }));
      return;
    }
    const v = await readView(id);
    const reran = Number(res.body.reran) || 0;
    const accepted = Number(res.body.accepted) || 0;
    if (v) setView(v);
    setLastRerun({ qid: q.id, reran, accepted, offer: !hadOffer && !!v?.offered });
    announce(rerunCopy(reran, accepted, !hadOffer && !!v?.offered));
    requestAnimationFrame(() => document.getElementById('st-question')?.focus({ preventScroll: true }));
  }

  /* ----- render ----- */

  const streaming = send.phase === 'sending' || outcome === 'ready' || outcome === 'gating';

  // One announcement when a fan-out this page watched settles (never per cell: ux-spec §9).
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const was = wasStreaming.current;
    wasStreaming.current = streaming;
    if (example) return;
    if (send.phase === 'refused' && was) {
      announce(SEND_FAILED_TITLE);
      return;
    }
    if (!was || streaming) return;
    const line = fanoutDoneAnnouncement(outcome === 'no_match' ? 'no-match' : outcome === 'failed' ? 'failed-closed' : outcome);
    if (line) announce(line);
  }, [streaming, outcome, send.phase, example]);
  const liveCells: (AskerCellState | null)[] = send.phase === 'sending' && send.cells.length ? send.cells : view.cells;
  const total = liveCells.length || view.cells.length;
  const hideProgress = reduced && send.phase === 'sending';
  const cellData = liveCells.map((c) => ({ state: hideProgress || c === null ? ('checking' as const) : realCellClass(c) }));
  const legend = hideProgress ? [{ state: 'checking' as const, text: `${total} checking` }] : legendOf(liveCells);
  const n = send.phase === 'sending' ? 0 : view.people_interrupted;
  const sentMs = view.sent_at ? Date.parse(view.sent_at) : NaN;
  const meta = Number.isNaN(sentMs)
    ? send.phase === 'sending' || send.phase === 'done'
      ? `Sending now · REAL network${total ? ` · ${total} members` : ''}`
      : 'REAL network · not sent yet'
    : `Sent ${fmtDay(sentMs, tz)}, ${fmtClock(sentMs, tz)} · REAL network · ${total} members${send.done ? ` · ${fmtMs(send.done.wall_ms)}` : ''}`;
  const resendHref = `/ask?resend=${encodeURIComponent(id)}`;
  const resendRow = (
    <div className="btn-row">
      <ButtonLink href={resendHref} size="sm" primary>
        {ST_COPY.editResend}
      </ButtonLink>
    </div>
  );

  const tryAgain = () => {
    setStuck(false);
    dispatch({ type: 'reset' });
    setAttempt((n) => n + 1);
    void reload();
  };
  let outcomeNode: ReactNode;
  if (send.phase === 'refused') {
    outcomeNode = (
      <OutcomeNotice
        ref={outcomeRef}
        kind={send.status === 429 || send.status === 503 || send.status === 0 ? 'warn' : 'error'}
        title={SEND_FAILED_TITLE}
        action={
          <Button size="sm" primary onClick={tryAgain}>
            Try again
          </Button>
        }
      >
        {withoutNothingSent(send.message ?? '') || REAL_SEND_REFUSED}
      </OutcomeNotice>
    );
  } else if (stuck && (outcome === 'ready' || outcome === 'gating')) {
    outcomeNode = (
      <OutcomeNotice
        ref={outcomeRef}
        kind="warn"
        title={null}
        action={
          <Button size="sm" primary onClick={tryAgain}>
            Try again
          </Button>
        }
      >
        {REAL_VIEW_LOST}
      </OutcomeNotice>
    );
  } else if (streaming) {
    outcomeNode = (
      <OutcomeCard ref={outcomeRef} pill="checking" label="Checking">
        {streamingCopy(null, total)}
      </OutcomeCard>
    );
  } else {
    switch (outcome) {
      case 'queued':
        outcomeNode = (
          <OutcomeCard
            ref={outcomeRef}
            pill="paused"
            label="Queued"
            extra={
              <div className="btn-row">
                <ButtonLink href="/me#asks" size="sm">
                  Withdraw one
                </ButtonLink>
              </div>
            }
          >
            {QUEUED_COPY}
          </OutcomeCard>
        );
        break;
      case 'offered': {
        const o = view.offered;
        const when = o ? fmtWhen(Date.parse(o.reply_by), tz) : '';
        outcomeNode = (
          <OutcomeCard ref={outcomeRef} pill="offered" label="Offered · waiting">
            {o && o.position > 1 ? movedOnCopy(o.position, o.in_line, when) : offeredCopy(when)}
          </OutcomeCard>
        );
        break;
      }
      case 'question':
        outcomeNode = (
          <OutcomeCard ref={outcomeRef} pill="notrun" label={QUESTION_OUTCOME_LABEL}>
            {QUESTION_OUTCOME_COPY}
          </OutcomeCard>
        );
        break;
      case 'answered':
        outcomeNode = (
          <OutcomeCard
            ref={outcomeRef}
            pill="on"
            label="Answered in 2 lines"
            extra={
              <>
                <div className="btn-row">
                  <Button variant="primary" primary busy={busy.resolve} aria-disabled={busy.resolve} onClick={() => onResolve(true)}>
                    {ST_COPY.solved}
                  </Button>
                  <Button aria-disabled={busy.resolve} onClick={() => onResolve(false)}>
                    {ST_COPY.keepOpen}
                  </Button>
                </div>
                <p className="help st-help">{ST_COPY.answerHelp72}</p>
                {errors.resolve ? (
                  <p className="error-text" role="alert">
                    {errors.resolve}
                  </p>
                ) : null}
              </>
            }
          >
            {answeredCopy(view.answer?.text ?? '')}
          </OutcomeCard>
        );
        break;
      case 'intro': {
        const it = view.intro;
        const at = it ? Date.parse(it.sent_at) : NaN;
        outcomeNode = (
          <OutcomeCard ref={outcomeRef} pill="on" label="Intro made">
            {it
              ? `${it.member_name} (${lower1(stripEnd(it.member_line))}) said OK. The intro email went to you both${Number.isNaN(at) ? '' : ` at ${fmtClock(at, tz)}`}. Reply-all to pick a time. Tomorrow we’ll ask you one question.`
              : 'A member said OK. The intro email went to you both. Reply-all to pick a time. Tomorrow we’ll ask you one question.'}
          </OutcomeCard>
        );
        break;
      }
      case 'no_match':
        outcomeNode = (
          <OutcomeCard
            ref={outcomeRef}
            pill="decline"
            label="No match"
            extra={
              <>
                {view.no_match ? <p className="small st-why">{realWhyLine(view.no_match.why)}</p> : null}
                {view.no_match?.suggestion ? <p className="small">{view.no_match.suggestion.why}</p> : null}
                {resendRow}
                <p className="help st-help">{ST_COPY.resendWeek}</p>
              </>
            }
          >
            {NO_MATCH_COPY}
          </OutcomeCard>
        );
        break;
      case 'closed': {
        const c = view.closed;
        const copy =
          c?.reason === 'all_passed'
            ? allPassedCopy(c.offered_count)
            : c?.reason === 'deadline'
              ? deadlineCopy(view.compiled.parts.by, c.offered_count)
              : c?.reason === 'solved'
                ? SOLVED_COPY
                : c?.reason === 'answer_timeout'
                  ? ANSWER_TIMEOUT_COPY
                  : ASKER_CLOSED_COPY;
        outcomeNode = (
          <OutcomeCard ref={outcomeRef} pill="decline" label="Closed" extra={c?.reason === 'all_passed' ? resendRow : undefined}>
            {copy}
          </OutcomeCard>
        );
        break;
      }
      case 'failed':
        outcomeNode = (
          <OutcomeNotice
            ref={outcomeRef}
            kind="error"
            title={SEND_FAILED_TITLE}
            action={
              <ButtonLink href={resendHref} size="sm" primary>
                {ST_COPY.editResend}
              </ButtonLink>
            }
          >
            {failedClosedCopy(send.done?.gates_failed ?? null, null)}
          </OutcomeNotice>
        );
        break;
      case 'withdrawn': {
        const w = view.withdrawn_at ? Date.parse(view.withdrawn_at) : NaN;
        outcomeNode = (
          <OutcomeCard ref={outcomeRef} pill="paused" label="Withdrawn">
            {withdrawnCopy(Number.isNaN(w) ? 'today' : fmtDay(w, tz), false)}
          </OutcomeCard>
        );
        break;
      }
      default:
        outcomeNode = (
          <OutcomeCard ref={outcomeRef} pill="checking" label="Checking">
            {streamingCopy(null, total)}
          </OutcomeCard>
        );
    }
  }

  const waiting = outcome === 'offered' || outcome === 'question';
  const showCard = !!q && (outcome === 'question' || qShown);
  const questionFirst = !!q && outcome === 'question';
  let questionCard: ReactNode = null;
  if (q && showCard && !streaming) {
    questionCard = (
      <QuestionPending
        question={{ text: q.text, gates: q.gates }}
        value={answerValue}
        onValue={(v) => {
          setAnswer({ qid: q.id, value: v });
          if (errors.answer) setErrors((e) => ({ ...e, answer: null }));
        }}
        onSend={() => void onSendAnswer()}
        sending={busy.answer}
        error={errors.answer}
        prefilled={false}
        sample={null}
        primary
      />
    );
  } else if (!q && lastRerun && answeredQ && answeredQ.id === lastRerun.qid && waiting) {
    questionCard = <QuestionAnswered copy={rerunCopy(lastRerun.reran, lastRerun.accepted, lastRerun.offer)} answer={answeredQ.answer ?? ''} />;
  }

  const noMatch = outcome === 'no_match';
  const suggestion = view.no_match?.suggestion ?? null;
  const matched = !!view.offered || outcome === 'answered' || outcome === 'intro';
  const canWithdraw = !streaming && !TERMINAL.includes(outcome);
  const partial = !!send.done && !send.done.failed_closed && send.done.gates_failed > 0;
  const traceLines = view.trace.map(splitTraceLine);

  return (
    <>
      <div className="container">
        <div className="st-grid">
          <StatusHead network="real" crumb={{ href: '/me#asks', label: ST_COPY.yourAsks }} title={view.subject} meta={meta} note={example ? EXAMPLE_REAL_NOTE : null} />

          <div className="st-status">
            {questionFirst ? questionCard : null}
            {outcomeNode}
            {questionFirst ? null : questionCard}
          </div>

          <section className="panel st-fanout" aria-labelledby="st-fan-title">
            <div className="split st-fanout__head">
              <h2 className="h3" id="st-fan-title">
                {ST_COPY.fanout}
              </h2>
              <p className="small">
                {ST_COPY.interrupted}{' '}
                <b className={cx('st-count', n > 0 && 'orange-text')} id="st-interrupted">
                  {n}
                </b>
              </p>
            </div>
            <div className="st-waffle-wrap" id="st-waffle-wrap" aria-busy={streaming ? true : undefined}>
              <Waffle className="st-waffle" id="st-waffle" cells={cellData} label={waffleLabel(legend, total)} />
            </div>
            <Legend items={legend} id="st-legend" />
            {q && !showCard && waiting ? (
              <p className="small st-qline" id="st-qline">
                {questionLine(q.text, q.gates)}{' '}
                <Button
                  variant="ghost"
                  size="sm"
                  id="st-qopen"
                  onClick={() => {
                    setQShown(true);
                    requestAnimationFrame(() => {
                      const inp = document.getElementById('st-answer');
                      inp?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
                      inp?.focus({ preventScroll: true });
                    });
                  }}
                >
                  {ST_COPY.answerIt}
                </Button>
              </p>
            ) : null}
            {partial && send.done ? (
              <p className="small" id="st-partial">
                {partialFailureCopy(send.done.gates_failed, null)}
              </p>
            ) : null}
            <TraceLines lines={traceLines} />
          </section>

          <section className="st-ask" aria-labelledby="st-ask-title">
            {canWithdraw ? <WithdrawControl onConfirm={onWithdraw} busy={busy.withdraw} error={errors.withdraw} /> : <YourAskTitle />}
            <AskFacts parts={view.compiled.parts} />
          </section>

          {noMatch ? (
            suggestion ? (
              <aside className="st-side" aria-labelledby="st-side-title">
                <div className="split st-side__head">
                  <h2 className="h3" id="st-side-title">
                    {ST_COPY.sideChange}
                  </h2>
                  <RealTag />
                </div>
                <div className="st-change" id="st-change">
                  <Diff
                    label="Suggested edit to your ask"
                    lines={[
                      { kind: 'ctx', text: suggestion.context },
                      { kind: 'add', text: suggestion.add },
                    ]}
                  />
                  <Help>{ST_COPY.changeHelp}</Help>
                  <div className="btn-row">
                    <ButtonLink href={`${resendHref}&edit=1`}>{ST_COPY.useEdit}</ButtonLink>
                  </div>
                </div>
              </aside>
            ) : null
          ) : (
            <aside className="st-side" aria-labelledby="st-side-title">
              <div className="split st-side__head">
                <h2 className="h3" id="st-side-title">
                  {ST_COPY.sideAsker}
                </h2>
                <RealTag />
              </div>
              <AskerCard title={view.subject.replace(/,\s*20 min\?\s*$/, '')} from={from} matched={matched} matchedLine={view.matched_line} />
            </aside>
          )}
        </div>
      </div>

      {q && showCard && !streaming ? (
        <Bar>
          <Button
            variant="primary"
            className="st-bar-btn"
            id="st-bar-btn"
            primary
            busy={busy.answer}
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
            {busy.answer ? 'Sending…' : ST_COPY.sendAnswer}
          </Button>
        </Bar>
      ) : null}
    </>
  );
}

function legendOf(cells: readonly (AskerCellState | null)[]) {
  const known = cells.filter((c): c is AskerCellState => c !== null);
  const items = realLegend(known);
  const open = cells.length - known.length;
  return open ? [{ state: 'checking' as const, text: `${open} checking` }, ...items] : items;
}

/** A REAL ask page that can't load: designed states, never a stack trace (server-rendered). */
export function RealStatusUnavailable({ kind, id }: { kind: 'not_configured' | 'db_down' | 'error'; id: string }) {
  return (
    <div className="container">
      <div className="st-grid">
        <StatusHead network="real" crumb={{ href: '/me#asks', label: ST_COPY.yourAsks }} title="Your ask" meta="REAL network" />
        <div className="st-status">
          <OutcomeNotice
            kind={kind === 'not_configured' ? 'plain' : 'warn'}
            title={kind === 'not_configured' ? null : SEND_FAILED_TITLE}
            action={
              kind === 'not_configured' ? (
                <ButtonLink href="/ask" variant="primary" primary>
                  Ask the sample network
                </ButtonLink>
              ) : (
                <ButtonLink href={`/ask/${encodeURIComponent(id)}`} variant="primary" primary>
                  Try again
                </ButtonLink>
              )
            }
          >
            {kind === 'not_configured' ? 'The real network isn’t set up on this instance.' : 'Something broke on our side, so this ask didn’t load. Your ask is saved.'}
          </OutcomeNotice>
        </div>
      </div>
    </div>
  );
}
