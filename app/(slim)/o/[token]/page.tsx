import type { Metadata } from 'next';
import { cx } from '@/components/kit/cx';
import { loadOfferPage } from '@/components/offer/load';
import { CARDLESS_VIEWS, isDoneView, type Params } from '@/components/offer/model';
import { OfferMeta } from '@/components/offer/offer-meta';
import { OfferScreen } from '@/components/offer/offer-screen';
import { offerFooterLinks, RecipientFooter } from '@/components/offer/recipient-footer';
import { SlimPage } from '@/components/site/slim-page';
import { BROKE_TITLE, OFFER_NOT_FOUND, OFFER_OFF_TITLE } from '@/components/offer/copy';
import { offerFollow, offerReason, offerRespond } from './actions';
import '@/styles/offer.css';

/**
 * S4 · the offer page, `/o/[token]` (owner R). Reached from the offer email's buttons (`?choice=ok|answer|no`
 * preselects; nothing happens until a button on this page is pressed), from /me (“Review the ask”, an `o_…` id for
 * the signed-in member), and as `/o/sample` from the playground and the SAMPLE ask loop. Dynamic, never cached,
 * never indexed (next.config.ts headers and the slim layout). Works without JS.
 */

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Params> };

const DESCRIPTION = 'An ask that matched your rules. Say OK to an intro, answer in 2 lines without your name, or pass privately.';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const model = await loadOfferPage(token, sp);
  const v = model.ui.view;
  const title = v === 'broken' ? BROKE_TITLE : v === 'unconfigured' ? OFFER_OFF_TITLE : model.card && !CARDLESS_VIEWS.includes(v) ? model.card.title : OFFER_NOT_FOUND;
  return { title, description: DESCRIPTION };
}

export default async function OfferPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const model = await loadOfferPage(token, sp);
  const done = isDoneView(model.ui.view);
  const cardless = CARDLESS_VIEWS.includes(model.ui.view);
  return (
    <>
      <SlimPage meta={done ? undefined : <OfferMeta model={model} />} mainClassName={cx('container container--narrow offer-main', done && 'offer-is-done')}>
        <OfferScreen model={model} actions={{ respond: offerRespond, reason: offerReason, follow: offerFollow }} />
      </SlimPage>
      {cardless ? null : <RecipientFooter links={offerFooterLinks(model.mode)} />}
    </>
  );
}
