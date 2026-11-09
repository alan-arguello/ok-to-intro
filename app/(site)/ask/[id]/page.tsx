import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { STATUS_DESCRIPTION } from '@/components/ask/copy';
import { exampleRealView } from '@/components/ask/fanout-model';
import { RealStatus, RealStatusUnavailable } from '@/components/ask/status-real';
import { SampleStatus } from '@/components/ask/status-sample';
import { isRealAskId, isSampleAskId } from '@/lib/oti/ids';
import { bareSubject } from '@/lib/oti/text';
import { qaEnabled, resolveQaState } from '@/lib/qa';
import { isSampleNetworkAskId, sampleNetworkAskById } from '@/lib/sample/network';
import { OFFER_SAMPLE } from '@/lib/sample/offer';
import { getAskerView } from '@/lib/server/asks';
import { getUser } from '@/lib/supabase/server';
import { askerFromLine, first, liveInfo } from '../_server/access';
import '@/styles/ask.css';

/**
 * S2 · /ask/[id] (ux-spec S2 “Status page”). `sa_…` ids are SAMPLE asks that live in the browser tab that sent
 * them (rendered on the client from sessionStorage); `a_…` ids are REAL asks, owner only, read through BE2's asker
 * serializer. Anything else is a 404. Private by nature, so never indexed.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The tab's title is the ask's subject. The server knows it for the three sample asks (their canonical subject);
 * an ask of the founder's own text lives only in their tab and a REAL ask is owner-only, so those start generic
 * and the page sets the subject once it has the ask (components/ask/hooks.ts useDocumentTitle).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const sa = isSampleNetworkAskId(id) ? sampleNetworkAskById(id) : null;
  const known = isSampleAskId(id) || isRealAskId(id);
  return {
    title: sa ? bareSubject(sa.subject) : known ? 'Your ask' : 'Not found',
    description: STATUS_DESCRIPTION,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function AskStatusPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const qaState = resolveQaState('askStatus', first(sp.state), qaEnabled());

  // QA: the REAL example (Lucía's fictional ask), on any id, never fetched.
  if (qaState === 'real') {
    const a = OFFER_SAMPLE.asker;
    return <RealStatus initial={exampleRealView()} from={[a.name, a.company, a.stage, a.city].join(' · ')} example />;
  }

  if (isSampleAskId(id)) {
    const live = await liveInfo();
    return <SampleStatus id={id} qaState={qaState} live={live} />;
  }

  if (!isRealAskId(id)) notFound();

  const u = await getUser();
  if (!u.ok && u.reason === 'signed_out') redirect(`/join?next=${encodeURIComponent(`/ask/${id}`)}`);
  if (!u.ok) return <RealStatusUnavailable kind={u.reason === 'not_configured' ? 'not_configured' : 'error'} id={id} />;

  let result: Awaited<ReturnType<typeof getAskerView>>;
  try {
    result = await getAskerView(id, u.user);
  } catch {
    result = { ok: false, reason: 'db_down' };
  }
  if (!result.ok && result.reason === 'not_found') notFound();
  if (!result.ok) return <RealStatusUnavailable kind={result.reason === 'not_configured' ? 'not_configured' : 'db_down'} id={id} />;

  return <RealStatus initial={result.view} from={await askerFromLine(u.user)} />;
}
