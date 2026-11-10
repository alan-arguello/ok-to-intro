'use client';

import { memo } from 'react';
import { Clause } from '@/components/kit/clause';
import { Disclosure, Facts, type FactItem } from '@/components/kit/surfaces';
import type { SampleAsk } from '@/lib/sample/types';
import type { SampleAskKey } from '@/lib/types';
import { chainText, isResolved, latencyText, outcomeOf, whyText, type Outcome, type RowDisplay } from './model';

export interface RowActions {
  retry(id: SampleAskKey): void;
}

export interface PgRowProps {
  ask: SampleAsk;
  d: RowDisplay;
  /** The rules the row's run checked (quoted offsets index this text). */
  rules: string;
  cap: number;
  busy: boolean;
  actions: RowActions;
}

function Quotes({ lead, quotes }: { lead: string; quotes: readonly string[] }) {
  if (!quotes.length) return null;
  return (
    <span className="pg-out__why">
      {lead}{' '}
      {quotes.map((q, i) => (
        <span key={i}>
          {i ? ' ' : null}
          <Clause>{q}</Clause>
        </span>
      ))}
    </span>
  );
}

/** One of three plain outcomes (reaches you, not for you, a question first), or the limit, with its one reason. */
function OutcomeLine({ o }: { o: Outcome }) {
  if (o.kind === 'idle') return null;
  return (
    <p className={`pg-out pg-out--${o.kind}`}>
      <span className="pg-out__label">{o.label}</span>
      {o.kind === 'reach' || o.kind === 'limit' ? <Quotes lead="Your rule:" quotes={o.quotes} /> : null}
      {o.kind === 'question' && o.text ? <span className="pg-out__why">“{o.text}”</span> : null}
      {o.kind === 'no' ? (
        <>
          <Quotes lead="Your rule:" quotes={o.quotes} />
          {o.text ? <span className="pg-out__why">{o.text}</span> : null}
        </>
      ) : null}
      {o.kind === 'failed' ? <span className="pg-out__why">{o.text}</span> : null}
    </p>
  );
}

/**
 * One ask: what it is and who sent it, then the outcome in plain words. Details holds the whole ask and, once
 * checked, the gate's reason, the model → code → limit chain and the latency.
 */
export const PgRow = memo(function PgRow({ ask, d, rules, cap, busy, actions }: PgRowProps) {
  const id = ask.id;
  const resolved = isResolved(d.display);
  const items: FactItem[] = [['The ask', ask.text]];
  if (resolved) {
    const why = whyText(d);
    if (why) items.push(['Why', why]);
    items.push(['Decided by', <span className="pg-chain" key="chain">{chainText(d, cap)}</span>]);
    const latency = latencyText(d);
    if (latency) items.push(['Latency', latency]);
  }

  return (
    <div className="row pg-row" id={`pg-row-${id}`} data-ask={id} data-outcome={d.display}>
      <p className="row__name pg-what" id={`pg-n-${id}`}>
        {ask.subject}
      </p>
      <p className="meta pg-who">
        {ask.company} · {ask.stage} · {ask.city}
      </p>
      <OutcomeLine o={outcomeOf(d, rules)} />
      {d.display === 'failed' ? (
        <button className="btn btn--sm pg-retry" type="button" aria-describedby={`pg-n-${id}`} aria-disabled={busy} onClick={() => !busy && actions.retry(id)}>
          Retry
        </button>
      ) : null}
      <Disclosure className="pg-details" summary="Details">
        <Facts items={items} plain />
      </Disclosure>
    </div>
  );
});
