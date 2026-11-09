import type { MetadataRoute } from 'next';
import { absoluteUrl, ROUTES } from '@/lib/site';

/**
 * sitemap.xml: the public pages only (no token, account, API or QA pages). Absolute URLs come from lib/site.ts
 * (NEXT_PUBLIC_SITE_URL), so the sitemap follows the deployed host.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: { path: string; changeFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly'; priority: number }[] = [
    { path: ROUTES.home, changeFrequency: 'weekly', priority: 1 },
    { path: ROUTES.ask, changeFrequency: 'weekly', priority: 0.8 },
    { path: ROUTES.board, changeFrequency: 'daily', priority: 0.7 },
    { path: ROUTES.agents, changeFrequency: 'weekly', priority: 0.7 },
    { path: ROUTES.how, changeFrequency: 'monthly', priority: 0.6 },
    { path: ROUTES.privacy, changeFrequency: 'monthly', priority: 0.4 },
    { path: ROUTES.join, changeFrequency: 'monthly', priority: 0.4 },
  ];
  return pages.map((p) => ({ url: absoluteUrl(p.path), changeFrequency: p.changeFrequency, priority: p.priority }));
}
