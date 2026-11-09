// npm run build:check — a production build that leaves the shared dev server and the working tree alone.
// It builds into its own dist dir (.next-build-<pid>, so two checks never collide), then restores next-env.d.ts
// and tsconfig.json (Next rewrites both for the dist dir it builds into) and deletes the build output.
// Flags: --keep keeps the output (to `next start` it: NEXT_DIST_DIR=<dir> npx next start -p 3300).
// Owner: F (foundation).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const keep = process.argv.includes('--keep');
const dir = `.next-build-${process.pid}`;
const files = ['next-env.d.ts', 'tsconfig.json'];
const saved = Object.fromEntries(files.map((f) => [f, existsSync(f) ? readFileSync(f, 'utf8') : null]));

const result = spawnSync('npx', ['next', 'build'], { stdio: 'inherit', env: { ...process.env, NEXT_DIST_DIR: dir } });

for (const f of files) {
  if (saved[f] === null) {
    if (existsSync(f)) rmSync(f);
  } else if (readFileSync(f, 'utf8') !== saved[f]) writeFileSync(f, saved[f]);
}
if (keep) console.log(`kept ${dir}: NEXT_DIST_DIR=${dir} npx next start -p 3300`);
else rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
