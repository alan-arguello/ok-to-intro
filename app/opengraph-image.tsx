import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from '@/components/static/og-image';
import { OG_HEADLINE, OG_IMAGE_ALT, OG_LINE } from '@/components/static/share';

/** The site-wide share image, generated at build time (components/static/og-image.tsx). Served at /opengraph-image. */
export const alt = OG_IMAGE_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({ headline: OG_HEADLINE, line: OG_LINE });
}
