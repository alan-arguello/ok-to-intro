/**
 * Writes the Claude Code plugin's host-dependent files from lib/site.ts (SITE_URL, from NEXT_PUBLIC_SITE_URL):
 * the marketplace, plugin.json, .mcp.json (the MCP URL) and hooks/hooks.json (the hook URL). JSON can't read env, so
 * run this whenever the production domain changes, and commit the result.
 *
 *   NEXT_PUBLIC_SITE_URL=https://ok-to-intro.vercel.app npx tsx scripts/build-plugin.ts          write
 *   NEXT_PUBLIC_SITE_URL=https://ok-to-intro.vercel.app npx tsx scripts/build-plugin.ts --check  compare, exit 1 on drift
 *
 * Refuses to write a local or http origin (the plugin is installed from GitHub by other people) unless --allow-local.
 * Owner: S6.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pluginFiles } from '@/lib/mcp/plugin-files';
import { SITE_URL } from '@/lib/site';

const args = new Set(process.argv.slice(2));
const check = args.has('--check');
const allowLocal = args.has('--allow-local');

const local = !/^https:\/\//.test(SITE_URL) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(SITE_URL);
if (local && !allowLocal && !check) {
  console.error(`Refusing to write ${SITE_URL} into the plugin: set NEXT_PUBLIC_SITE_URL to the production origin (or pass --allow-local).`);
  process.exit(2);
}

const files = pluginFiles(SITE_URL);
let drift = 0;
for (const [path, content] of Object.entries(files)) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (check) {
    if (current !== content) {
      drift++;
      console.error(`drift: ${path} differs from what ${SITE_URL} generates`);
    }
    continue;
  }
  if (current === content) {
    console.log(`unchanged ${path}`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${path}`);
}
if (check) {
  if (drift) process.exit(1);
  console.log(`plugin files match ${SITE_URL}`);
}
