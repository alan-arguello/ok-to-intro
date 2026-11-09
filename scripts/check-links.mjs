#!/usr/bin/env node
// node scripts/check-links.mjs [--online] [--base http://127.0.0.1:3200] [--no-crawl]
//
// Pre-send check (ux-spec §8 "Smoke test" step 6), ported from prototype/check-links.mjs. Owner: S7.
//
// 1. Placeholder copy that must never ship, in every source file that renders or is published (app/, components/,
//    lib/, data/, plugins/, .claude-plugin/, README.md): "to be set", TODO, TBD, lorem ipsum, the foundation's
//    "PLACEHOLDER (foundation)" / "STUB (foundation)" markers and "This page is being built.", and the prototype's
//    placeholder domain (oktointro.app). The host and the sender come only from NEXT_PUBLIC_SITE_URL and EMAIL_FROM.
// 2. External links: every http(s) link in that source plus, when the base URL answers, every <a href> on the
//    public pages and the sample emails as the app renders them (links built from lib/site.ts constants included).
// 3. Links to code in the repo (…/blob/HEAD/<path>, used on /privacy) must point at files that exist here.
// 4. With --online, each external link is requested (GET, redirects followed, 8 s) and anything but 2xx/3xx fails:
//    the repo, the deployed domain and the plugin marketplace must exist before the email goes out.
// Exits 1 on any problem. Without --online it only lists the external links.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const SCAN_DIRS = ['app', 'components', 'lib', 'data', 'plugins', '.claude-plugin'];
const SCAN_FILES = ['README.md'];
const EXT = /\.(tsx?|mjs|js|json|md|css|html|txt|sh)$/;
const SKIP = /(^|\/)(node_modules|\.next[^/]*|\.shots|tests?|__tests__)(\/|$)/;

/** What must never ship. A line can opt out with "check-links: allow". */
export const PLACEHOLDERS = [
  [/\bto be set\b/i, 'placeholder "to be set"'],
  [/\bTODO\b/, 'TODO'],
  [/\bTBD\b/, 'TBD'],
  [/lorem ipsum/i, 'lorem ipsum'],
  [/PLACEHOLDER \(foundation\)/, 'foundation placeholder'],
  [/STUB \(foundation\)/, 'foundation stub'],
  [/This page is being built\./, 'unbuilt page copy'],
  [/oktointro\.app/i, 'the prototype placeholder domain (use lib/site.ts)'],
];

/** Placeholder problems in a file's text: `[{ line, what, text }]`. */
export function placeholdersIn(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (/check-links: allow/.test(line)) return;
    for (const [re, what] of PLACEHOLDERS) if (re.test(line)) out.push({ line: i + 1, what, text: line.trim().slice(0, 120) });
  });
  return out;
}

/** The external link a raw match stands for, or null when it isn't one to check. */
export function normalizeLink(url) {
  const u = url.replace(/&amp;/g, '&').replace(/[.,;:)\]}>"'’”]+$/, '');
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(u)) return null;
  let host = '';
  try {
    host = new URL(u).hostname;
  } catch {
    return null;
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)) return null; // the local instance itself
  if (/fonts\.(googleapis|gstatic)\.com$/.test(host)) return null; // next/font self-hosts them in the app
  if (host === 'cal.com') return null; // members' own scheduling links (SAMPLE handles are fictional)
  if (/(^|\.)example\.(com|org|net|invalid)$/i.test(host)) return null; // documentation and SAMPLE addresses
  return u;
}

/** Links in source text (template literals are skipped: the crawl sees what they build). */
export function linksIn(text) {
  const out = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/https?:\/\/[^\s'"`<>()\\]+/g)) {
      if (m[0].includes('${') || (/\/$/.test(m[0]) && line.includes('${', m.index))) continue;
      const u = normalizeLink(m[0]);
      if (u) out.push(u);
    }
  }
  return out;
}

/** The repo file a code link points at (…/ok-to-intro/blob/<ref>/<path>), or null. */
export function repoPathOf(url) {
  const m = url.match(/^https:\/\/github\.com\/alan-arguello\/ok-to-intro\/blob\/[^/]+\/(.+)$/);
  return m ? decodeURIComponent(m[1].replace(/[#?].*$/, '')) : null;
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(relative(root, p))) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

const PAGES = ['/', '/rules', '/ask', '/board', '/agents', '/how', '/privacy', '/join', '/o/sample', '/c/sample'];
const EMAIL_KINDS = ['offer', 'intro', 'checkin-1d', 'checkin-14d', 'question', 'outcome-note', 'code'];

async function main() {
  const args = process.argv.slice(2);
  const online = args.includes('--online');
  const noCrawl = args.includes('--no-crawl');
  const baseIdx = args.indexOf('--base');
  const base = (baseIdx >= 0 ? args[baseIdx + 1] : process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3200').replace(/\/+$/, '');

  let problems = 0;
  const fail = (msg) => {
    problems++;
    console.log(`FAIL ${msg}`);
  };
  const links = new Map();
  const addLink = (u, where) => {
    if (!links.has(u)) links.set(u, new Set());
    links.get(u).add(where);
  };

  // 1 + 2: source
  const files = [...SCAN_DIRS.flatMap((d) => walk(join(root, d), [])), ...SCAN_FILES.map((f) => join(root, f)).filter(existsSync)];
  for (const f of files) {
    const rel = relative(root, f);
    const text = readFileSync(f, 'utf8');
    for (const p of placeholdersIn(text)) fail(`${p.what} · ${rel}:${p.line}: ${p.text}`);
    for (const u of linksIn(text)) addLink(u, rel);
  }

  // 2: what the app renders (the public pages, the SAMPLE pages and every sample email)
  let crawled = 0;
  if (!noCrawl) {
    let up = false;
    try {
      up = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) })).ok;
    } catch {
      up = false;
    }
    if (!up) console.log(`(crawl skipped: ${base} isn't answering; source links only)`);
    else {
      const paths = [...PAGES, ...EMAIL_KINDS.map((k) => `/emails/${k}`), ...EMAIL_KINDS.map((k) => `/emails/${k}?v=text`)];
      for (const path of paths) {
        let html = '';
        try {
          const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(90_000), redirect: 'follow' });
          html = await r.text();
          if (!r.ok) fail(`${path} answered ${r.status}`);
        } catch (e) {
          fail(`${path} didn't load (${e.name})`);
          continue;
        }
        crawled++;
        // Only rendered markup: the RSC payload in <script> repeats it.
        const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
        for (const m of markup.matchAll(/href="([^"]+)"/g)) {
          const u = /^https?:/i.test(m[1]) ? normalizeLink(m[1]) : null;
          if (u) addLink(u, path);
        }
        for (const p of placeholdersIn(markup.replace(/<[^>]+>/g, '\n'))) fail(`${p.what} · rendered on ${path}: ${p.text}`);
        if (/mailto:[^"]*(to be set|example\.com)/i.test(markup)) fail(`placeholder mailto on ${path}`);
      }
    }
  }

  // 3: links to the repo's own files exist here
  for (const [u, where] of links) {
    const path = repoPathOf(u);
    if (path !== null && !existsSync(join(root, path))) fail(`code link to a missing file: ${path} (${[...where].join(', ')})`);
  }

  console.log(`${links.size} external links in ${files.length} source files${crawled ? ` and ${crawled} rendered pages` : ''}`);
  if (online) {
    for (const [u, where] of links) {
      let status = 0;
      try {
        const r = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ok-to-intro check-links' } });
        status = r.status;
      } catch {
        status = 0;
      }
      const ok = status >= 200 && status < 400;
      if (!ok) problems++;
      const w = [...where];
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${status || 'no answer'} ${u}  (${w.slice(0, 3).join(', ')}${w.length > 3 ? ', …' : ''})`);
    }
    console.log('Not automated: run both install commands (lib/site.ts) in a clean Claude Code profile.');
  } else {
    for (const u of links.keys()) console.log(`     ${u}`);
  }
  console.log(problems ? `${problems} problem(s)` : 'no problems');
  process.exit(problems ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
