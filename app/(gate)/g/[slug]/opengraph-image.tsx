import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/components/static/og-image';
import { OG_HEADLINE, OG_LINE } from '@/components/static/share';
import { getGateCard } from '@/lib/server/personal-gates';

/**
 * The share image of one personal gate: “Ask <name>” and the headline. It reads the gate's name and headline only,
 * never the rules. An unknown link, or an instance without the database, gets the site image instead of an error.
 */
export const alt = 'A personal gate on OK to Intro: an ask is checked against the owner’s rules before it reaches them.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** Gates can be deleted and the link reused, so previews are cached for minutes, not a year. */
const BRIEF = { 'cache-control': 'public, max-age=600, s-maxage=600' };

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  let card: { name: string; headline: string | null } | null = null;
  try {
    const { slug } = await params;
    card = await getGateCard(slug);
  } catch {
    card = null;
  }
  if (!card) return ogCard({ headline: OG_HEADLINE, line: OG_LINE, headers: BRIEF });
  return ogCard({ headline: `Ask ${card.name}`, line: card.headline, headers: BRIEF });
}
