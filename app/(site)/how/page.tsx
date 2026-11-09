import type { Metadata } from 'next';
import { HOW_COPY } from '@/components/static/copy';
import { HowContent } from '@/components/static/how';
import { shareMetadata } from '@/components/static/share';
import { getEvalSummary } from '@/lib/server/board';
import '@/styles/static.css';

/**
 * S8 · /how (ux-spec S8): the five steps, what enforces each one, and the guarantees. Static. The injection line
 * quotes the held-out eval only once `npm run eval` has written data/eval/heldout-summary.json.
 */
export const metadata: Metadata = shareMetadata({ title: HOW_COPY.title, description: HOW_COPY.description, path: '/how' });

export default function HowPage() {
  return <HowContent evalSummary={getEvalSummary()} />;
}
