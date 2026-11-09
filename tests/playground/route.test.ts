import { describe, expect, it } from 'vitest';
import { metadata as homeMetadata } from '@/app/(site)/page';
import { metadata as rulesMetadata } from '@/app/(site)/rules/page';
import { QA_STATES } from '@/lib/qa';
import { NAV_ITEMS, ROUTES } from '@/lib/site';
import nextConfig from '../../next.config';

// The playground moved from `/` to `/rules` on Nov 9 (the home page is the ask composer now).
describe('routes after the ask-first home', () => {
  it('the playground lives on /rules with its own canonical and share title', () => {
    expect(ROUTES.rules).toBe('/rules');
    expect(rulesMetadata.alternates).toEqual({ canonical: '/rules' });
    expect(rulesMetadata.title).toEqual({ absolute: 'OK to Intro · What would you agree to be asked?' });
    expect(rulesMetadata.openGraph).toMatchObject({ url: '/rules', title: 'OK to Intro · What would you agree to be asked?' });
  });

  it('the home page is the composer', () => {
    expect(homeMetadata.alternates).toEqual({ canonical: '/' });
    expect(homeMetadata.title).toEqual({ absolute: 'OK to Intro · What do you need from the network?' });
    expect(homeMetadata.openGraph).toMatchObject({ url: '/', title: 'OK to Intro · What do you need from the network?' });
  });

  it('the header reads Ask (/) then Be asked (/rules)', () => {
    expect(NAV_ITEMS.slice(0, 2)).toEqual([
      { href: '/', label: 'Ask' },
      { href: '/rules', label: 'Be asked' },
    ]);
  });

  it('the playground keeps its QA states; the static home has only its default', () => {
    expect(QA_STATES.home).toEqual(['default']);
    expect(QA_STATES.playground).toContain('done-recorded');
  });

  it('old shared preset links (/?preset=…) still open the playground, and / stays a static page', async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toEqual([{ source: '/', has: [{ type: 'query', key: 'preset' }], destination: '/rules', permanent: false }]);
  });
});
