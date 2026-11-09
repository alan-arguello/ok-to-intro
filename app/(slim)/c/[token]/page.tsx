import type { Metadata } from 'next';
import { CheckinMeta } from '@/components/checkin/checkin-meta';
import { CheckinScreen } from '@/components/checkin/checkin-screen';
import { loadCheckinPage } from '@/components/checkin/load';
import { checkinFooterLinks, RecipientFooter } from '@/components/offer/recipient-footer';
import { BROKE_TITLE, CHECKIN_NOT_FOUND, CHECKIN_OFF_TITLE } from '@/components/offer/copy';
import type { Params } from '@/components/offer/model';
import { SlimPage } from '@/components/site/slim-page';
import { checkinQuestion } from '@/lib/emails';
import { checkinSave } from './actions';
import '@/styles/offer.css';

/** Server actions run follow-up work after the response (next/server after()); the daily cron is the backstop. */
export const maxDuration = 60;

/**
 * S5 · the check-in page, `/c/[token]` (owner R). Reached from the +1 day and +14 day emails (`?v=` preselects;
 * only this page's Save records), from /me with a `c_…` id, and as `/c/sample` from the SAMPLE loop. Dynamic, never
 * cached, never indexed. Works without JS.
 */

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Params> };

const DESCRIPTION = 'One question about an intro: did the call happen, and was it useful. One tap opens it, one POST saves it.';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const model = await loadCheckinPage(token, sp);
  const v = model.ui.view;
  const title =
    v === 'broken' ? BROKE_TITLE : v === 'unconfigured' ? CHECKIN_OFF_TITLE : v === 'invalid' || !model.other ? CHECKIN_NOT_FOUND : checkinQuestion(model.ui.kind, model.ui.role, model.other.first);
  return { title, description: DESCRIPTION };
}

export default async function CheckinPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const model = await loadCheckinPage(token, sp);
  const cardless = model.ui.view === 'invalid' || model.ui.view === 'unconfigured' || model.ui.view === 'broken';
  const askId = model.source.kind === 'ask' ? model.source.id : null;
  return (
    <>
      <SlimPage meta={cardless ? undefined : <CheckinMeta model={model} />} mainClassName="container container--narrow ck-main">
        <CheckinScreen model={model} action={checkinSave} />
      </SlimPage>
      {/* The prototype's check-in footer leads with the recipient's links and drops Board. */}
      {cardless ? null : <RecipientFooter links={checkinFooterLinks(model.mode, model.ui.role, askId)} board={false} />}
    </>
  );
}
