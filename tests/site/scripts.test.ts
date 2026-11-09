import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QA_STATES } from '@/lib/qa';
// @ts-expect-error plain .mjs scripts have no type declarations
import { consoleIssues, issuesOf, PAGES, QA, sweepUrls } from '../../scripts/audit-sweep.mjs';
// @ts-expect-error plain .mjs scripts have no type declarations
import { linksIn, normalizeLink, placeholdersIn, repoPathOf } from '../../scripts/check-links.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
type Url = { path: string; status: number };

describe('scripts/audit-sweep.mjs', () => {
  it('sweeps exactly the QA states lib/qa.ts defines, each on its page', () => {
    expect(QA).toEqual(QA_STATES);
    expect(Object.keys(PAGES).sort()).toEqual(Object.keys(QA_STATES).sort());
  });

  it('covers every route, state and degraded mode, and expects a 404 on the not-found page', () => {
    const urls = sweepUrls() as Url[];
    const paths = urls.map((u) => u.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/board?state=default');
    expect(paths).toContain('/board?state=stale');
    expect(paths).toContain('/ask/sa_eng?state=intro');
    expect(paths).toContain('/o/sample?state=expired');
    expect(paths).toContain('/how/error-preview');
    expect(paths).toContain('/?degraded=budget');
    expect(paths).toContain('/emails/intro?v=text');
    expect(paths).not.toContain('/how?state=default');
    expect(urls.find((u) => u.path === '/qa-sweep-not-found')?.status).toBe(404);
    expect(new Set(paths).size).toBe(paths.length);
    const states = Object.values(QA_STATES).flat().length;
    expect(urls.length).toBeGreaterThan(states);
  });

  it('fails a run on errors, overflow, contrast, unlabeled controls, extra pills and a primary out of reach', () => {
    const report = { exceptions: [], console: ['log: [HMR] connected', 'error: boom'], overflow: [], scrollWidth: 1280, innerWidth: 1280, audit: { contrastFailureCount: 0, contrastFailures: [], unlabeledControls: 0 } };
    const ev = { pills: 2, primary: 'Run', pBottom: 950, pH: 40 };
    const issues = issuesOf(report, ev, { status: 200, height: 900 }) as string[];
    expect(issues.some((i) => i.startsWith('CONSOLE error: boom'))).toBe(true);
    expect(issues).toContain('PILLS 2');
    expect(issues).toContain('PRIMARY 40px < 44');
    expect(issues).toContain('PRIMARY below the fold (950 > 900)');
    const clean = issuesOf({ ...report, console: [] }, { pills: 1, primary: 'Run', pBottom: 300, pH: 48 }, { status: 200, height: 900 });
    expect(clean).toEqual([]);
  });

  it('allows only the 404 page’s own status line and favicon noise', () => {
    const line = 'error: Failed to load resource: the server responded with a status of 404 (Not Found) http://127.0.0.1:3200/x';
    expect(consoleIssues([line], { status: 404 })).toEqual([]);
    expect(consoleIssues([line], { status: 200 })).toEqual([line]);
    expect(consoleIssues(['warning: favicon.ico 404', 'info: hi'], { status: 200 })).toEqual([]);
    const preload = 'warning: The resource http://127.0.0.1:3297/_next/static/chunks/x.css was preloaded using link preload but not used within a few seconds from the window’s load event.';
    expect(consoleIssues([preload], { status: 200 })).toEqual([]);
  });
});

describe('scripts/check-links.mjs', () => {
  it('finds placeholder copy, and lets a line opt out', () => {
    const found = placeholdersIn('a\nTODO later\nTBD\nthe address is to be set\nhttps://oktointro.app\nfine // check-links: allow TODO') as { line: number; what: string }[];
    expect(found.map((f) => f.what)).toEqual(['TODO', 'TBD', 'placeholder "to be set"', 'the prototype placeholder domain (use lib/site.ts)']);
    expect(placeholdersIn('// PLACEHOLDER (foundation): S7 owns this file')).toHaveLength(1);
    expect(placeholdersIn('<p>This page is being built.</p>')).toHaveLength(1);
    expect(placeholdersIn('const todos = 1; // a todo list')).toEqual([]);
  });

  it('keeps the external links worth checking', () => {
    expect(normalizeLink('https://github.com/alan-arguello/ok-to-intro).')).toBe('https://github.com/alan-arguello/ok-to-intro');
    expect(normalizeLink('http://localhost:3200/board')).toBeNull();
    expect(normalizeLink('https://fonts.googleapis.com/css2')).toBeNull();
    expect(normalizeLink('https://cal.com/ana-ruiz/20min')).toBeNull();
    expect(normalizeLink('https://www.example.com/x')).toBeNull();
    expect(linksIn('const a = `https://github.com/${SLUG}`;\nconst b = "https://resend.com/docs";')).toEqual(['https://resend.com/docs']);
  });

  it('maps code links to files in this repo', () => {
    expect(repoPathOf('https://github.com/alan-arguello/ok-to-intro/blob/HEAD/app/(site)/me/export/route.ts')).toBe('app/(site)/me/export/route.ts');
    expect(repoPathOf('https://github.com/alan-arguello/ok-to-intro/issues')).toBeNull();
  });
});

describe('scripts/shoot.mjs', () => {
  it('is a verbatim copy of the audit tool', () => {
    const source = `${ROOT}../yc-demo-concept/build-inputs/shoot.mjs`;
    if (!existsSync(source)) return; // the build inputs live outside the repo; nothing to compare on other machines
    expect(readFileSync(`${ROOT}scripts/shoot.mjs`, 'utf8')).toBe(readFileSync(source, 'utf8'));
  });
});
