'use client';

import { useClientNow, useSampleStores } from './client-hooks';
import type { OfferCardModel, OfferPageModel } from './model';
import { clientSampleCard } from './sample-loop';

export interface LiveOfferCard {
  card: OfferCardModel | null;
  hours: number | null;
  /** The SAMPLE ask the card shows (`sa_…` or `a01`…), or null for the canonical sample and REAL offers. */
  askId: string | null;
  /** True until the tab has been read (the card is hidden meanwhile, so the wrong ask never flashes). */
  awaiting: boolean;
}

/**
 * The card the page shows. REAL and the canonical SAMPLE come from the server as they are; a SAMPLE loop
 * (`?ask=` or `?from=playground`) is rebuilt from the visitor's own tab once it can be read.
 */
export function useOfferCard(model: OfferPageModel): LiveOfferCard {
  const fromTab = model.mode === 'sample' && (model.source.kind === 'ask' || model.source.kind === 'playground');
  const stores = useSampleStores(fromTab);
  const now = useClientNow();
  const serverAsk = model.source.kind === 'ask' ? model.source.id : null;
  if (!fromTab) return { card: model.card, hours: model.hours, askId: serverAsk, awaiting: false };
  if (stores === null || now === null) return { card: model.card, hours: model.hours, askId: serverAsk, awaiting: true };
  const live = clientSampleCard(model.source, stores, now);
  if (!live) return { card: model.card, hours: model.hours, askId: serverAsk, awaiting: false };
  return { card: live.card, hours: model.hours === null ? null : live.hours, askId: live.askId, awaiting: false };
}
