import type { Metadata } from 'next';
import { HOME_DESCRIPTION, HOME_TITLE } from '@/components/ask/copy';
import { HomeAsk } from '@/components/ask/home-ask';
import type { RealAccess } from '@/components/ask/types';
import { realLineText } from '@/components/site/real-line';
import { OG_IMAGE, OG_IMAGE_ALT } from '@/components/static/share';
import { hasAnthropic, hasSupabase, REAL_ASKERS_MODE } from '@/lib/env';
import { qaEnabled } from '@/lib/qa';
import { networkConfigured } from '@/lib/server/audit';
import { getRealLine } from '@/lib/server/board';
import { PRODUCT_NAME } from '@/lib/site';
import type { RealLineResult } from '@/lib/types';
import '@/styles/ask.css';

/**
 * `/`, ask-first (Alan, Nov 9: “the main window should be like ChatGPT”): the founder's composer, then the quiet way
 * to the other side (/rules, the playground). The composer is the /ask island (components/ask), so the SAMPLE loop
 * is the same one. Static, regenerated hourly for the dated REAL line (ISR); no request-time APIs, so the page is
 * served from the CDN. /ask stays dynamic for the session-aware REAL option and its deep links.
 */
export const revalidate = 3600;

const TITLE = `${PRODUCT_NAME} · ${HOME_TITLE}`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: PRODUCT_NAME, url: '/', title: TITLE, description: HOME_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: HOME_DESCRIPTION, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }] },
};

export default async function Page() {
  let line: RealLineResult;
  try {
    line = await getRealLine();
  } catch {
    line = { ok: false, reason: 'db_down' };
  }
  // A static page knows only whether REAL is set up; /ask resolves who is signed in (HomeAsk hands off to it).
  const real: RealAccess = hasSupabase && networkConfigured() ? { kind: 'signed_out', mode: REAL_ASKERS_MODE } : { kind: 'not_configured' };
  return <HomeAsk realLine={realLineText(line)} liveConfigured={hasAnthropic} real={real} qa={qaEnabled()} />;
}
