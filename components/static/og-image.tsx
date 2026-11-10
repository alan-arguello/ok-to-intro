import { ImageResponse } from 'next/og';
import { PRODUCT_NAME } from '@/lib/site';

/**
 * The share image (1200 × 630), drawn with next/og: the wordmark on top, one large headline, one line under it.
 * Page beige and ink from app/tokens.css; next/og's built-in font, so nothing is fetched while building.
 * Used by app/opengraph-image.tsx (the site) and app/(gate)/g/[slug]/opengraph-image.tsx (“Ask <name>”).
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

const PAGE = '#f5f5ee';
const INK = '#16140f';
const INK_2 = '#5f5a50';

export function ogCard(input: { headline: string; line?: string | null; headers?: Record<string, string> }): ImageResponse {
  const headline = input.headline.trim();
  const line = (input.line ?? '').trim();
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '64px 80px', backgroundColor: PAGE, color: INK }}>
        <div style={{ display: 'flex', fontSize: 34, letterSpacing: '-0.01em' }}>{PRODUCT_NAME}</div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center' }}>
          <div style={{ display: 'flex', fontSize: headline.length > 36 ? 68 : 88, lineHeight: 1.08, letterSpacing: '-0.03em' }}>{headline}</div>
          {line ? <div style={{ display: 'flex', marginTop: 28, fontSize: 36, lineHeight: 1.35, color: INK_2 }}>{line}</div> : null}
        </div>
      </div>
    ),
    { ...OG_SIZE, headers: input.headers },
  );
}
