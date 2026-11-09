import { OG_IMAGE, OG_IMAGE_ALT } from '@/components/static/share';
import type { Metadata } from 'next';
import { JoinView } from '@/components/member/join-view';
import { JOIN_COPY } from '@/components/member/copy';
import { flags } from '@/lib/env';
import { qaEnabled } from '@/lib/qa';
import '@/styles/member.css';

/**
 * /join (owner: S3). Static: the form is a client island and the shared layout never reads cookies. Sign-in needs
 * Supabase Auth (public URL + anon key) and the service role (the members row is written by the server after the
 * code verifies); without them the page renders its designed “not set up on this instance” state.
 */

const description = 'Join with your rules. We email you a 6-digit code. No password.';

export const metadata: Metadata = {
  title: JOIN_COPY.titleSignIn,
  description,
  openGraph: { title: JOIN_COPY.titleSignIn, description, url: '/join', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: JOIN_COPY.titleSignIn, description, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }] },
};

export default function JoinPage() {
  const available = flags.hasSupabase && flags.hasSupabaseAdmin;
  return (
    <div className="container container--narrow">
      <JoinView available={available} qa={qaEnabled()} />
    </div>
  );
}
