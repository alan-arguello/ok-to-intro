import type { Metadata } from 'next';
import { PRIVACY_COPY } from '@/components/static/copy';
import { PrivacyContent } from '@/components/static/privacy';
import { shareMetadata } from '@/components/static/share';
import '@/styles/static.css';

/**
 * S8 · /privacy (ux-spec S8): who sees what, what is stored and not stored, processors, delete, contact. Static.
 * Every line describes what the code does; the lines that one file enforces link to that file in the repo.
 */
export const metadata: Metadata = shareMetadata({ title: PRIVACY_COPY.title, description: PRIVACY_COPY.description, path: '/privacy' });

export default function PrivacyPage() {
  return <PrivacyContent />;
}
