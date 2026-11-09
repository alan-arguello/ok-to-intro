'use client';

/**
 * Pieces of the /ask/[id] status page shared by SAMPLE and REAL (port of prototype/ask-status.html): the head,
 * the outcome card, the asker's card, “Your ask”, the inline withdraw confirm, the question card and the raw trace.
 * Markup and class names follow the prototype (`st-*` in styles/ask.css) with kit components inside.
 */

import Link from 'next/link';
import { forwardRef, useState, type ReactNode } from 'react';
import { T, Trace, TraceLine } from '@/components/kit/blocks';
import { Button } from '@/components/kit/button';
import { cx } from '@/components/kit/cx';
import { OfferCard } from '@/components/kit/offer-card';
import { RealTag, SampleTag, Tag, Verdict, type VerdictKind } from '@/components/kit/pills';
import { Disclosure, Facts, ProtoNote } from '@/components/kit/surfaces';
import { ANSWER_MAX, traceTime, upper1 } from '@/lib/oti/text';
import type { AskParts, Network } from '@/lib/types';
import { FACT_LABEL, questionCardCopy, ST_COPY } from './copy';
import type { TracePart, TraceRow } from './fanout-model';

export function StatusHead({ network, crumb, title, meta, note }: { network: Network; crumb: { href: string; label: string }; title: string; meta: ReactNode; note?: string | null }) {
  return (
    <header className="st-head">
      <p className="crumbs st-crumbs">
        <Link href={crumb.href} id="st-crumb-link">
          {crumb.label}
        </Link>{' '}
        {network === 'real' ? <RealTag /> : <SampleTag />}
      </p>
      <h1 className="title" id="st-title">
        {title}
      </h1>
      <p className="meta" id="st-meta">
        {meta}
      </p>
      {note ? (
        <p className="st-proto">
          <ProtoNote>{note}</ProtoNote>
        </p>
      ) : null}
    </header>
  );
}

/** The outcome card: a verdict pill, one paragraph of copy, then links or buttons. Focusable for announcements. */
export const OutcomeCard = forwardRef<HTMLDivElement, { pill: VerdictKind; label: string; children: ReactNode; extra?: ReactNode }>(function OutcomeCard({ pill, label, children, extra }, ref) {
  return (
    <div className="card st-outcome" id="st-outcome" ref={ref} tabIndex={-1}>
      <p className="st-pill">
        <Verdict kind={pill}>{label}</Verdict>
      </p>
      <p className="st-copy">{children}</p>
      {extra}
    </div>
  );
});

/** “Nothing was sent to anyone.” failures take the outcome card's place (.notice--error, never a modal). */
export const OutcomeNotice = forwardRef<HTMLDivElement, { kind: 'error' | 'warn' | 'plain'; title: string | null; children: ReactNode; action?: ReactNode }>(function OutcomeNotice({ kind, title, children, action }, ref) {
  return (
    <div className={cx('notice', kind !== 'plain' && `notice--${kind}`, 'st-outcome')} id="st-outcome" ref={ref} tabIndex={-1} role={kind === 'error' ? 'alert' : undefined}>
      <p>
        {title ? <span className="notice__title">{title}</span> : null}
        {title ? ' ' : null}
        {children}
      </p>
      {action}
    </div>
  );
});

/** The asker's own card (“What you sent”): no cap, no verbatim rule unless the member chose to show it. */
export function AskerCard({ title, from, matched, matchedLine }: { title: string; from: string; matched: boolean; matchedLine?: string | null }) {
  return (
    <OfferCard
      titleId="st-card-title"
      kicker={<Tag>Sent</Tag>}
      title={title}
      from={from}
      match={matched ? matchedLine ? <>Matched a member’s rule: “{matchedLine}”</> : ST_COPY.matchedMembers : undefined}
      fine={ST_COPY.askerFine}
      facts={[]}
    />
  );
}

/** “Your ask”: the 5 parts as sent. */
export function AskFacts({ parts }: { parts: AskParts }) {
  const keys = ['challenge', 'tried', 'needs', 'by', 'offers'] as const;
  return <Facts className="st-facts" id="st-facts" items={keys.filter((k) => parts[k]?.trim()).map((k) => [FACT_LABEL[k], k === 'by' ? parts[k] : upper1(parts[k])] as const)} />;
}

/** Withdraw, with its inline two-step confirm (no modal). */
export function WithdrawControl({ onConfirm, busy, error }: { onConfirm: () => void; busy?: boolean; error?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="split st-ask__head">
        <h2 className="h2" id="st-ask-title">
          {ST_COPY.yourAsk}
        </h2>
        <Button
          size="sm"
          id="st-withdraw"
          aria-expanded={open}
          aria-controls="st-confirm"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => document.getElementById('st-withdraw-yes')?.focus());
          }}
        >
          {ST_COPY.withdraw}
        </Button>
      </div>
      <div className="notice st-confirm" id="st-confirm" role="group" aria-labelledby="st-confirm-text" hidden={!open}>
        <p id="st-confirm-text">{ST_COPY.withdrawConfirm}</p>
        <div className="btn-row">
          <Button
            variant="danger"
            size="sm"
            id="st-withdraw-yes"
            busy={busy}
            aria-disabled={busy ? true : undefined}
            onClick={() => {
              if (busy) return;
              onConfirm();
            }}
          >
            {busy ? 'Withdrawing…' : ST_COPY.withdraw}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            id="st-withdraw-no"
            onClick={() => {
              setOpen(false);
              requestAnimationFrame(() => document.getElementById('st-withdraw')?.focus());
            }}
          >
            {ST_COPY.keep}
          </Button>
        </div>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

export function YourAskTitle() {
  return (
    <div className="split st-ask__head">
      <h2 className="h2" id="st-ask-title">
        {ST_COPY.yourAsk}
      </h2>
    </div>
  );
}

/* ---------- the question card ---------- */

export interface QuestionCardProps {
  question: { text: string; gates: number };
  value: string;
  onValue: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
  /** A suggested answer already in the input (with its source line). */
  prefilled: boolean;
  /** “Use sample answer” (SAMPLE only). */
  sample: string | null;
  primary: boolean;
}

export function QuestionPending({ question, value, onValue, onSend, sending, error, prefilled, sample, primary }: QuestionCardProps) {
  const empty = !value.trim();
  return (
    <div className="card st-question" id="st-question" tabIndex={-1}>
      <p className="st-pill">
        <Verdict kind="ask">Question for you</Verdict>
      </p>
      <p className="st-copy">{questionCardCopy(question.text, question.gates)}</p>
      <div className="field st-answer-field">
        <label className="label" htmlFor="st-answer">
          {ST_COPY.answerLabel}
        </label>
        <input
          className="input"
          id="st-answer"
          type="text"
          autoComplete="off"
          maxLength={ANSWER_MAX}
          value={value}
          aria-describedby={prefilled ? 'st-answer-help' : error ? 'st-answer-error' : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        {prefilled ? (
          <p className="help" id="st-answer-help">
            {ST_COPY.sampleAnswerHelp}
          </p>
        ) : null}
        {error ? (
          <p className="error-text" id="st-answer-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {!prefilled && sample && value !== sample ? (
        <p>
          <Button variant="ghost" size="sm" className="st-sample-ans" id="st-use-sample" onClick={() => onValue(sample)}>
            {ST_COPY.useSampleAnswer}
          </Button>
        </p>
      ) : null}
      <div className="btn-row">
        <Button
          variant="primary"
          size="lg"
          className="hide-phone"
          id="st-send-answer"
          primary={primary}
          busy={sending}
          aria-disabled={empty || sending}
          onClick={() => {
            if (empty || sending) return;
            onSend();
          }}
        >
          {sending ? 'Sending…' : ST_COPY.sendAnswer}
        </Button>
      </div>
    </div>
  );
}

export function QuestionAnswered({ copy, answer }: { copy: string; answer: string }) {
  return (
    <div className="card st-question" id="st-question" tabIndex={-1}>
      <p className="st-pill">
        <Verdict kind="next">Answered</Verdict>
      </p>
      <p className="st-copy">{copy}</p>
      <p className="meta">Your answer: “{answer}”</p>
    </div>
  );
}

/* ---------- the raw trace ---------- */

function part(p: TracePart, i: number): ReactNode {
  return typeof p === 'string' ? p : <T key={i} tone={p.tone}>{p.text}</T>;
}

export function TraceBlock({ rows }: { rows: readonly TraceRow[] }) {
  return (
    <Disclosure className="st-trace" id="st-trace-d" summary={`Raw trace (${rows.length} ${rows.length === 1 ? 'line' : 'lines'})`}>
      <Trace label="Raw trace" id="st-trace">
        {rows.map((r, i) => (
          <TraceLine key={i}>
            <T tone="dim">{traceTime(r.at)}</T>
            {r.parts.map(part)}
          </TraceLine>
        ))}
      </Trace>
    </Disclosure>
  );
}

/** The serializer's trace lines (REAL): “+2104 ms  gates done”, the time column dimmed. */
export function TraceLines({ lines }: { lines: readonly { time: string | null; rest: string }[] }) {
  return (
    <Disclosure className="st-trace" id="st-trace-d" summary={`Raw trace (${lines.length} ${lines.length === 1 ? 'line' : 'lines'})`}>
      <Trace label="Raw trace" id="st-trace">
        {lines.map((l, i) => (
          <TraceLine key={i}>
            {l.time ? <T tone="dim">{l.time}</T> : null}
            {l.rest}
          </TraceLine>
        ))}
      </Trace>
    </Disclosure>
  );
}
