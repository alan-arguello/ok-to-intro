import type { Metadata } from 'next';
import { ME_COPY } from '@/components/member/copy';
import { DeletedView } from '@/components/member/me-parts';
import '@/styles/member.css';

/**
 * /me/deleted (owner: S3): where “Delete everything” lands once the member's rows are gone and this browser is
 * signed out (the header reads “Sign in” again). Static; it says nothing about anyone.
 */
export const metadata: Metadata = {
  title: 'Deleted',
  description: ME_COPY.deletedBody,
  robots: { index: false, follow: false },
};

export default function DeletedPage() {
  return (
    <div className="container container--col">
      <DeletedView />
    </div>
  );
}
