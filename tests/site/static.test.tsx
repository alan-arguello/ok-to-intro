import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { codeUrl } from '@/components/static/code-ref';
import { ERROR_COPY, errorRef, HOW_STEPS, PRIVACY_CODE, PRIVACY_COPY, PRIVACY_ROWS, WHO_SEES } from '@/components/static/copy';
import { HowContent } from '@/components/static/how';
import { NotFoundView } from '@/components/static/not-found-view';
import { PrivacyContent } from '@/components/static/privacy';
import { isProductionSite, OG_IMAGE, shareMetadata } from '@/components/static/share';
import { BANNED_COPY, hasStraightQuotes } from '@/lib/oti/text';
import { CONTACT_EMAIL, CONTACT_FALLBACK_URL, MODELS, REPO_URL, SITE_URL } from '@/lib/site';
import GlobalError from '@/app/global-error';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { metadata as howMetadata } from '@/app/(site)/how/page';
import { metadata as privacyMetadata } from '@/app/(site)/privacy/page';
import { metadata as notFoundMetadata } from '@/app/not-found';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/\s+/g, ' ');

describe('/how', () => {
  it('is the mechanism in five short steps, models from lib/site, and nothing about sign-in, email, tokens, MCP or the board', () => {
    const out = renderToStaticMarkup(<HowContent />);
    expect(out.match(/class="row how-step"/g)?.length).toBe(5);
    expect(HOW_STEPS.map((s) => s.name)).toEqual(['The ask', 'The check', 'Each member’s gate', 'The monthly limit', 'One offer at a time']);
    expect(HOW_STEPS[1]?.by).toEqual([`Model (${MODELS.compiler})`]);
    expect(HOW_STEPS[2]?.by).toEqual([`Model (${MODELS.gate})`, 'Code']);
    expect(out).toContain('<ol class="list how-steps" role="list" aria-label="Five steps">');
    expect(out).toContain(`href="${REPO_URL}"`);
    expect(out).toContain('href="/rules"');
    expect(out).not.toMatch(/href="\/(join|me|board|agents)/);
    expect(text(out)).not.toMatch(/sign in|email|token|MCP|Claude Code|board|Postgres/i);
  });
});

describe('/privacy', () => {
  const out = renderToStaticMarkup(<PrivacyContent />);

  it('has the who-sees-what table and its phone version, with words behind every mark', () => {
    expect(out.match(/<tr>/g)?.length).toBe(WHO_SEES.length + 1);
    expect(out).toContain('<th scope="row">The line that matched</th>');
    expect(out).toContain('<span aria-hidden="true">✓</span><span class="sr-only">Yes</span>');
    expect(out).toContain('class="list priv-stack"');
    expect(out).toContain('Askers: only after you say OK');
  });

  it('links each enforced line to a file that exists in this repo', () => {
    const paths = [...new Set(Object.values(PRIVACY_CODE).flat())];
    for (const p of paths) {
      expect(existsSync(`${ROOT}${p}`), p).toBe(true);
      expect(out).toContain(`href="${codeUrl(p)}"`);
    }
    expect(codeUrl('app/(site)/me/export/route.ts')).toBe(`${REPO_URL}/blob/HEAD/app/(site)/me/export/route.ts`);
  });

  it('says it is a demo, links nowhere a visitor can’t go, and contacts at a real address or the repo’s issues', () => {
    expect(out).toContain(PRIVACY_COPY.demo);
    expect(out).not.toMatch(/href="\/(join|me)/);
    if (CONTACT_EMAIL) expect(out).toContain(`mailto:${CONTACT_EMAIL}`);
    else expect(out).toContain(`href="${CONTACT_FALLBACK_URL}"`);
    expect(out).not.toMatch(/oktointro|to be set|example\.com/i);
  });

  it('states retention and deletion as the code does them', () => {
    expect(PRIVACY_ROWS.noStore).toContain('removed by the daily cleanup after a day');
    expect(PRIVACY_ROWS.store).toContain('drafts of asks made in Claude Code, which expire after 24 hours');
    expect(PRIVACY_ROWS.delete).toContain('cancels emails still scheduled to them');
    expect(PRIVACY_ROWS.processors).toContain('within 30 days by default');
  });
});

describe('404 and error', () => {
  it('404: one black pill to the home composer, no sign-in', () => {
    const out = renderToStaticMarkup(<NotFoundView />);
    expect(out).toContain('<h1 class="h1">Not found</h1>');
    expect(out.match(/btn--primary/g)?.length).toBe(1);
    expect(out).toMatch(/<a class="btn btn--primary btn--lg" data-primary="" href="\/">Ask the network<\/a>/);
    expect(out).not.toContain('href="/join"');
    expect(notFoundMetadata.title).toBe('Not found');
  });

  it('error refs come from the digest Next logs, never the message', () => {
    expect(errorRef(Object.assign(new Error('secret'), { digest: '2846571894' }))).toBe('2846571894');
    expect(errorRef(Object.assign(new Error('x'), { digest: 'abc-9' }))).toBe('ABC-9');
    expect(errorRef(new Error('no digest'))).toBeNull();
    expect(errorRef('thrown string')).toBeNull();
    expect(errorRef({ digest: '<script>' })).toBeNull();
  });

  it('global error renders a whole document that depends on nothing else', () => {
    const out = renderToStaticMarkup(<GlobalError error={Object.assign(new Error('x'), { digest: '7f2a' })} retry={() => undefined} />);
    expect(out.startsWith('<html lang="en">')).toBe(true);
    expect(out).toContain(`<h1 class="h1">${ERROR_COPY.h1}</h1>`);
    expect(out).toContain('Nothing was sent to anyone. Ref 7F2A.');
    expect(out).toContain('Independent project, not affiliated with Y Combinator.');
    expect(out).toContain('href="#main"');
  });
});

describe('share metadata, robots and sitemap', () => {
  it('keeps the OG image on pages that set their own share title', () => {
    const m = shareMetadata({ title: 'Board', description: 'd', path: '/board' });
    expect(m.openGraph).toMatchObject({ title: 'Board · OK to Intro', url: '/board', images: [OG_IMAGE] });
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', images: [{ url: '/opengraph-image.png' }] });
    expect(howMetadata.openGraph).toMatchObject({ images: [OG_IMAGE] });
    expect(privacyMetadata.title).toBe('Privacy');
    expect(existsSync(`${ROOT}app/opengraph-image.png`)).toBe(true);
  });

  it('opens robots.txt only on the production deployment', () => {
    expect(isProductionSite({ VERCEL_ENV: 'production' }, false)).toBe(true);
    expect(isProductionSite({ VERCEL_ENV: 'preview' }, false)).toBe(false);
    expect(isProductionSite({}, true)).toBe(true);
    const r = robots();
    if (isProductionSite()) expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    else expect(r.rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  it('lists only public pages, with absolute URLs from lib/site', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual(['/', '/ask', '/rules', '/how', '/privacy'].map((p) => `${SITE_URL}${p}`));
    expect(urls.join(' ')).not.toMatch(/\/(o|c|pause|me|join|board|agents|api|kit)\b/);
  });
});

describe('copy', () => {
  it('has no banned words, exclamation marks or straight quotes', () => {
    const pages = [renderToStaticMarkup(<HowContent />), renderToStaticMarkup(<PrivacyContent />), renderToStaticMarkup(<NotFoundView />)];
    for (const p of pages) {
      const t = text(p.replace(/href="[^"]*"/g, ''));
      for (const re of BANNED_COPY) expect(t).not.toMatch(re);
      expect(hasStraightQuotes(t)).toBe(false);
    }
  });
});
