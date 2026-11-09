import type { MetadataRoute } from 'next';
import { isProductionSite } from '@/components/static/share';
import { SITE_URL } from '@/lib/site';

/**
 * robots.txt. On the production deployment the public pages are open; the pages people reach from their own email
 * (offers, check-ins, pause links), their account, the API, the MCP endpoint, the sample email viewer and the QA
 * pages are not crawled (they also send noindex). Preview and local instances ask crawlers to stay out entirely.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite()) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/o/', '/c/', '/pause/', '/me', '/api/', '/mcp', '/emails/', '/kit', '/how/error-preview'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
