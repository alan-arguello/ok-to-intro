import type { Metadata } from 'next';
import { HOME_DESCRIPTION, HOME_TITLE } from '@/components/ask/copy';
import { HomeAsk } from '@/components/ask/home-ask';
import { OG_IMAGE, OG_IMAGE_ALT } from '@/components/static/share';
import { hasAnthropic } from '@/lib/env';
import { qaEnabled } from '@/lib/qa';
import { PRODUCT_NAME } from '@/lib/site';
import '@/styles/ask.css';

/**
 * `/`, ask-first (Alan, Nov 9: “the main window should be like ChatGPT”): the founder's composer, then the card to
 * the other side (/rules). The composer is the /ask island (components/ask), so the SAMPLE loop is the same one.
 * Static: no request-time APIs, so the page is served from the CDN.
 */

const TITLE = `${PRODUCT_NAME} · ${HOME_TITLE}`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: PRODUCT_NAME, url: '/', title: TITLE, description: HOME_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: HOME_DESCRIPTION, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }] },
};

export default function Page() {
  return <HomeAsk liveConfigured={hasAnthropic} qa={qaEnabled()} />;
}
