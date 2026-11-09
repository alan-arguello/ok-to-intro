import { OG_IMAGE, OG_IMAGE_ALT } from '@/components/static/share';
import type { Metadata } from 'next';
import { Playground } from '@/components/playground/playground';
import { realLineText } from '@/components/site/real-line';
import { hasAnthropic } from '@/lib/env';
import { qaEnabled } from '@/lib/qa';
import { EXAMPLE_REAL_LINE } from '@/lib/sample/examples';
import { getRealLine } from '@/lib/server/board';
import { PRODUCT_NAME, ROUTES } from '@/lib/site';
import type { RealLineResult } from '@/lib/types';
import '@/styles/playground.css';

/**
 * S1 · `/rules`, the playground (ux-spec S1; it was `/` until the ask-first home of Nov 9). The member's side: write
 * what you'd agree to be asked and a cap, then watch the 12 sample asks from other founders checked against it.
 * Static, regenerated hourly for the dated REAL line (ISR); everything else is the client island in
 * components/playground. No request-time APIs, so the page is served from the CDN.
 */
export const revalidate = 3600;

const TITLE = `${PRODUCT_NAME} · What would you agree to be asked?`;
const DESCRIPTION =
  'Founders in a network ask for 20-minute calls. Write what you’d agree to be asked and a monthly cap, then watch a small model check 12 sample asks against your own words.';
const SHARE_DESCRIPTION =
  'Founders in a network ask for 20-minute calls. Write what you’d agree to be asked and a monthly cap; a small model checks each ask against your words and must quote the line it used.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.rules },
  openGraph: { type: 'website', siteName: PRODUCT_NAME, url: ROUTES.rules, title: TITLE, description: SHARE_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: SHARE_DESCRIPTION, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }] },
};

export default async function RulesPage() {
  let real: RealLineResult;
  try {
    real = await getRealLine();
  } catch {
    real = { ok: false, reason: 'db_down' };
  }
  const qa = qaEnabled();
  const ex = EXAMPLE_REAL_LINE;
  // Example numbers render only in an explicit ?state= QA state, next to the dashed prototype note.
  const qaRealLine = qa ? `Network since ${ex.since}: ${ex.members} members, ${ex.asks} asks, ${ex.intros} intros.` : null;
  return <Playground realLine={realLineText(real)} qaRealLine={qaRealLine} qa={qa} liveConfigured={hasAnthropic} />;
}
