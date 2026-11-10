import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as COPY from '@/components/ask/copy';
import { BANNED_COPY } from '@/lib/oti/text';

const ROOT = join(__dirname, '..', '..');

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    // Copy builders: call with representative arguments.
    const f = value as (...args: unknown[]) => unknown;
    for (const args of [[3, 40], ['Thu Nov 12, 21:04 PT'], ['down', 'Dec 1'], ['off', null], ['budget', 'Dec 1'], [2, 3, 'Thu Nov 12, 21:04 PT'], ['A question?', 2], [1, 1, false], [2, 2, false], [2, 1, true], [0, 0, false]]) {
      try {
        const r = f(...args);
        if (typeof r === 'string') out.push(r);
      } catch {
        /* wrong arity: skip */
      }
    }
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe('S2 copy (ux-spec §2.7)', () => {
  const all = strings(COPY);

  it('has copy to check', () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it('uses curly quotes and apostrophes, never straight ones', () => {
    for (const s of all) expect(s, s).not.toMatch(/["']/);
  });

  it('has no exclamation marks, “AI-powered”, “seamless” or “magic”', () => {
    for (const s of all) for (const re of BANNED_COPY) expect(s, s).not.toMatch(re);
  });

  it('never says Postgres decided a SAMPLE step, and never “Recorded run” or “Tested on”', () => {
    for (const s of all) {
      expect(s).not.toMatch(/reserve_slot|\(Postgres\)|Recorded run|Tested on/);
    }
  });

  it('the UI source has no straight apostrophes inside words', () => {
    const sources = [...files(join(ROOT, 'components', 'ask')), ...files(join(ROOT, 'app', '(site)', 'ask'))];
    for (const f of sources) {
      // Code only: block comments and line comments (never inside strings in these files) are prose for developers.
      const text = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const hits = text.match(/[A-Za-z]'[A-Za-z]/g) ?? [];
      expect(hits, f).toEqual([]);
    }
  });
});
