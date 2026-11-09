import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ME_COPY } from '@/components/member/copy';
import { MeError } from '@/components/member/me-error';
import { sampleMe } from '@/components/member/me-sample';
import { MeView } from '@/components/member/me-view';
import { qaState } from '@/lib/qa';
import { getUser } from '@/lib/supabase/server';
import { loadMe } from './load';
import '@/styles/member.css';

/**
 * /me “Your gate” (owner: S3). Dynamic and signed in: the session comes from cookies (proxy.ts refreshes it on /me).
 * - Signed out, or sign-in not set up on this instance → /join?next=/me.
 * - QA (`?state=`, development or QA_STATES=1) → the SAMPLE preview with example numbers under the dashed note;
 *   it never renders without an explicit state.
 * - The member's own data otherwise; if the database can't be read, “Something broke on our side.”
 */

const description = 'Your rules, your monthly cap and what reached you this month. Pause, test, export or delete.';

export const metadata: Metadata = {
  title: ME_COPY.title,
  description,
  robots: { index: false, follow: false },
  openGraph: { title: ME_COPY.title, description, url: '/me' },
  twitter: { title: ME_COPY.title, description },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function MePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const qa = qaState('me', sp.state);
  const first = one(sp.first) === '1';
  const carried = one(sp.carried) === '1';
  const back = carried ? '/me?carried=1' : '/me';

  if (qa === 'signed-out') redirect(`/join?next=${encodeURIComponent('/me')}`);
  if (qa) return <MeView initial={sampleMe(qa, new Date().getTime())} />;

  const auth = await getUser();
  if (!auth.ok && auth.reason !== 'error') redirect(`/join?next=${encodeURIComponent(back)}`);
  if (!auth.ok) return <MeError />;

  const loaded = await loadMe(auth.user, new Date(), { first, carried });
  if (!loaded.ok) return <MeError notConfigured={loaded.reason === 'not_configured'} />;
  return <MeView initial={loaded.initial} />;
}
