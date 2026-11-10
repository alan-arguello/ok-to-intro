import type { Metadata } from 'next';
import { HOW_COPY } from '@/components/static/copy';
import { HowContent } from '@/components/static/how';
import { shareMetadata } from '@/components/static/share';
import '@/styles/static.css';

/** /how: the mechanism in five short steps. Static. */
export const metadata: Metadata = shareMetadata({ title: HOW_COPY.title, description: HOW_COPY.description, path: '/how' });

export default function HowPage() {
  return <HowContent />;
}
