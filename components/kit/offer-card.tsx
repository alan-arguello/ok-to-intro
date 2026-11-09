import type { ReactNode } from 'react';
import type { Fact, FactLabel } from '@/lib/types';
import { cx } from './cx';

/**
 * The offer card: identical markup on /o (S4), the /ask “What a member sees” preview (S2) and sample previews.
 * Parts always in this order: kicker, title, from, matched rule, fine print, facts (tokens.css). On /o the
 * kicker's cap usage moves into the slim header, so `kicker` is optional.
 * Facts always read Problem, Needs, Tried, By, Offers, Price (ux-spec Revision 3); `orderFacts` enforces it.
 */

export const FACT_ORDER: readonly FactLabel[] = ['Problem', 'Needs', 'Tried', 'By', 'Offers', 'Price'];

/** Sorts facts into the card order and drops empty ones. */
export function orderFacts(facts: readonly Fact[]): Fact[] {
  return [...facts].filter(([, v]) => v && v.trim()).sort((a, b) => FACT_ORDER.indexOf(a[0]) - FACT_ORDER.indexOf(b[0]));
}

export interface OfferCardProps {
  kicker?: ReactNode;
  title: ReactNode;
  /** The heading level depends on the page: h1 on /o, h3 inside the /ask preview. */
  titleAs?: 'h1' | 'h2' | 'h3';
  titleId?: string;
  /** “Lucía Ferrer · Orvella Health · Seed · Guadalajara”. */
  from: ReactNode;
  /** Usually “Matched your rule: <Mark>“…”</Mark>”. */
  match?: ReactNode;
  /** The cost of answering: “Lucía sees your name only if you choose OK. …”. */
  fine?: ReactNode;
  facts: readonly Fact[];
  /** Accessible name when there is no visible heading id to point at. */
  label?: string;
  className?: string;
  factsId?: string;
}

export function OfferCard({ kicker, title, titleAs = 'h3', titleId, from, match, fine, facts, label, className, factsId }: OfferCardProps) {
  const Title = titleAs;
  const ordered = orderFacts(facts);
  return (
    <article className={cx('offer-card', className)} aria-label={titleId ? undefined : label} aria-labelledby={titleId}>
      {kicker ? <p className="offer-card__kicker">{kicker}</p> : null}
      <Title className="offer-card__title" id={titleId}>
        {title}
      </Title>
      <p className="offer-card__from">{from}</p>
      {match ? <p className="offer-card__match">{match}</p> : null}
      {fine ? <p className="offer-card__fine">{fine}</p> : null}
      {ordered.length ? (
        <dl className="facts" id={factsId}>
          {ordered.map(([dt, dd]) => (
            <OfferFact key={dt} dt={dt} dd={dd} />
          ))}
        </dl>
      ) : null}
    </article>
  );
}

function OfferFact({ dt, dd }: { dt: string; dd: string }) {
  return (
    <>
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </>
  );
}
