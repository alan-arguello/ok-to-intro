import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLoopAskId, param, type Params } from '@/components/offer/model';
import { SlimPage } from '@/components/site/slim-page';
import { isSampleEmailKind, sampleEmailMeta } from '@/lib/emails/sample';
import { env } from '@/lib/env';
import { PRODUCT_NAME, AUTHOR_NAME } from '@/lib/site';
import { EmailViewer } from './viewer';
import '@/styles/offer.css';

/**
 * `/emails/[kind]` (owner R): the public SAMPLE email viewer. Kinds: offer, intro, checkin-1d, checkin-14d, question,
 * outcome-note, withdrawn, code. Query: `ask=<sa_…|a01…>` (the SAMPLE loop in this tab), `who=asker|member`
 * (+1 day check-in), `v=text` (the plain-text part). Nothing is sent from here.
 */

type Props = { params: Promise<{ kind: string }>; searchParams: Promise<Params> };

/** The request's clock: a server component renders once per request, so this is the time the page was asked for. */
function requestTime(): number {
  return Date.now();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind } = await params;
  if (!isSampleEmailKind(kind)) return { title: 'Not found' };
  const meta = sampleEmailMeta(kind);
  return { title: `${meta.title} (sample)`, description: meta.description };
}

export default async function SampleEmailPage({ params, searchParams }: Props) {
  const [{ kind }, sp] = await Promise.all([params, searchParams]);
  if (!isSampleEmailKind(kind)) notFound();
  const ask = param(sp, 'ask');
  const who = param(sp, 'who') === 'member' || param(sp, 'role') === 'member' ? 'member' : 'asker';
  const from = env.EMAIL_FROM ?? `${PRODUCT_NAME} (${AUTHOR_NAME})`;
  return (
    <SlimPage meta="Sample email" mainClassName="container mail-main">
      <h1 className="sr-only">{sampleEmailMeta(kind).title} (sample)</h1>
      <EmailViewer kind={kind} who={who} text={param(sp, 'v') === 'text'} askId={isLoopAskId(ask) ? ask : null} from={from} serverNow={requestTime()} />
    </SlimPage>
  );
}
