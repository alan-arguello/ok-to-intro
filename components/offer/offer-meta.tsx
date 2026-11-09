'use client';

import { Cap } from '@/components/kit/pills';
import type { OfferPageModel } from './model';
import { useOfferCard } from './use-offer-card';

/**
 * The slim header's meta on /o (ux-spec S4): “1 of 2 this month ■□ · 71 h left”. The cap usage lives here, not on
 * the card. SAMPLE loops count down from the ask's own send time, read from the visitor's tab.
 */
export function OfferMeta({ model }: { model: OfferPageModel }) {
  const { card, hours, awaiting } = useOfferCard(model);
  if (!card || hours === null) return null;
  return (
    <span className="offer-aside" data-await-store={awaiting ? '' : undefined}>
      <span className="offer-aside__cap">
        {card.nth} of {card.cap} this month <Cap cap={card.cap} used={card.nth} hidden />
      </span>
      <span className="offer-aside__sep" aria-hidden="true">
        ·
      </span>
      <span>{hours} h left</span>
    </span>
  );
}
