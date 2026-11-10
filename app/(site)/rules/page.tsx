import { OG_IMAGE, OG_IMAGE_ALT } from '@/components/static/share';
import type { Metadata } from 'next';
import { Playground } from '@/components/playground/playground';
import { hasAnthropic } from '@/lib/env';
import { qaEnabled } from '@/lib/qa';
import { PRODUCT_NAME, ROUTES } from '@/lib/site';
import '@/styles/playground.css';

/**
 * `/rules`, “Be asked”: the member's side. Write what you'd agree to help with and a monthly limit, then see
 * which of 12 sample asks from other founders would reach you. Static; everything else is the client island in
 * components/playground.
 */

const TITLE = `${PRODUCT_NAME} · What would you agree to help with?`;
const DESCRIPTION = 'You’re the one being asked. Write what you’d agree to help with and a monthly limit; see which of 12 sample asks from other founders would reach you.';
const SHARE_DESCRIPTION = DESCRIPTION;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.rules },
  openGraph: { type: 'website', siteName: PRODUCT_NAME, url: ROUTES.rules, title: TITLE, description: SHARE_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: SHARE_DESCRIPTION, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }] },
};

export default function RulesPage() {
  return <Playground qa={qaEnabled()} liveConfigured={hasAnthropic} />;
}
