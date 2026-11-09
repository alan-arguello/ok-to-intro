import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { qaEnabled } from '@/lib/qa';
import { KitDemo } from './kit-demo';
import '@/styles/kit.css';

export const metadata: Metadata = {
  title: 'Kit',
  description: 'Component reference for OK to Intro (QA only).',
  robots: { index: false, follow: false },
};

/** Every kit component with prototype/kit.html's markup, for audits. Renders only when QA states are enabled. */
export default function KitPage() {
  if (!qaEnabled()) notFound();
  return <KitDemo />;
}
