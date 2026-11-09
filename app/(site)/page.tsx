import { OG_IMAGE, OG_IMAGE_ALT } from '@/components/static/share';
import type { Metadata } from 'next';
import { Playground } from '@/components/playground/playground';
import { hasAnthropic } from '@/lib/env';
import { REAL_LINE_OFF } from '@/lib/oti/copy';
import { plural } from '@/lib/oti/text';
import { qaEnabled } from '@/lib/qa';
import { EXAMPLE_REAL_LINE } from '@/lib/sample/examples';
import { getRealLine } from '@/lib/server/board';
import { PRODUCT_NAME } from '@/lib/site';
import type { RealLineResult } from '@/lib/types';
import '@/styles/playground.css';

/**
 * S1 · `/`, the playground (ux-spec S1). Static, regenerated hourly for the dated REAL line (ISR); everything else is
 * the client island in components/playground. No request-time APIs, so the page is served from the CDN.
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
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: PRODUCT_NAME, url: '/', title: TITLE, description: SHARE_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: SHARE_DESCRIPTION, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }] },
};

/**
 * The REAL line under the lede, from real counts only: not connected on this instance → REAL_LINE_OFF; nobody joined
 * yet → honest zeros; database down → no line at all (never stale numbers presented as current).
 */
function realLineText(result: RealLineResult): string | null {
  if (!result.ok) return result.reason === 'not_configured' ? REAL_LINE_OFF : null;
  const l = result.line;
  if (l.since === null) return 'Real network: no members yet.';
  return `Network since ${l.since}: ${plural(l.members, 'member')}, ${plural(l.asks, 'ask')}, ${plural(l.intros, 'intro')}.`;
}

export default async function Page() {
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
