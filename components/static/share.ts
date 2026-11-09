import type { Metadata } from 'next';
import { IS_PRODUCT_DOMAIN, PRODUCT_NAME } from '@/lib/site';

/**
 * True on the deployment the public should find (robots.txt opens up only there): Vercel's production environment,
 * or any instance on a product domain (lib/site.ts). Previews and local instances stay out of search.
 */
export function isProductionSite(env: Record<string, string | undefined> = process.env, productDomain: boolean = IS_PRODUCT_DOMAIN): boolean {
  return env.VERCEL_ENV === 'production' || productDomain;
}

/**
 * Share metadata for pages that set their own Open Graph title (S7's pages; other owners may import it).
 *
 * Why: Next merges `metadata.openGraph` per key, so a page that sets `openGraph` replaces the root one and loses the
 * file-based image (app/opengraph-image.png) unless it lists the image again. Pages without their own `openGraph`
 * keep the image but share the root title. This helper sets both, with the image the file convention serves.
 */

export const OG_IMAGE_ALT =
  'OK to Intro: “What would you agree to be asked?” above one sample row, Reaches you · Arrecife Data, citing “founders about Postgres, queues or LLM evals in production” as found in your rules.';

export const OG_IMAGE = { url: '/opengraph-image.png', width: 1200, height: 630, type: 'image/png', alt: OG_IMAGE_ALT } as const;

/** `title` is the page's own title (the root template adds “ · OK to Intro” to <title>; shares get the full name). */
export function shareMetadata(input: { title: string; description: string; path: string }): Pick<Metadata, 'title' | 'description' | 'alternates' | 'openGraph' | 'twitter'> {
  const shareTitle = `${input.title} · ${PRODUCT_NAME}`;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      type: 'website',
      siteName: PRODUCT_NAME,
      url: input.path,
      title: shareTitle,
      description: input.description,
      images: [OG_IMAGE],
    },
    twitter: { card: 'summary_large_image', title: shareTitle, description: input.description, images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }] },
  };
}
