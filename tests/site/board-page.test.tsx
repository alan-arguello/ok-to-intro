/**
 * app/(site)/board/page.tsx: what the ISR page does with each result from lib/server/board.ts (docs/CONTRACT.md §f):
 * render the designed state at build time and in development, throw on a runtime revalidation while the database is
 * down (so Next keeps serving the last good page), and render counts otherwise.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardResult } from '@/lib/server/board';

const h = vi.hoisted(() => ({ result: { ok: false, reason: 'not_configured' } as BoardResult }));

vi.mock('@/lib/server/board', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/board')>();
  return { ...real, getBoard: async () => h.result };
});

import { EXAMPLE_SNAPSHOT } from '@/components/board/qa-examples';
import BoardPage, { metadata, revalidate } from '@/app/(site)/board/page';

const render = async () => renderToStaticMarkup(await BoardPage());

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/board page', () => {
  it('regenerates at most once a minute, and shares with its own title and the OG image', () => {
    expect(revalidate).toBe(60);
    expect(metadata.title).toBe('Board');
    expect(metadata.openGraph).toMatchObject({ title: 'Board · OK to Intro', url: '/board' });
  });

  it('without a database: the not-connected board, never example numbers', async () => {
    h.result = { ok: false, reason: 'not_configured' };
    const out = await render();
    expect(out).toContain('The real network isn’t connected on this instance yet.');
    expect(out).not.toContain('Prototype: example numbers');
  });

  it('renders the counts it read', async () => {
    h.result = { ok: true, snapshot: EXAMPLE_SNAPSHOT, asOfKind: 'checkpoint' };
    const out = await render();
    expect(out).toContain('Last update Nov 10, 14:02 PT.');
    expect(out).toContain('231 of 254');
  });

  it('database down: designed state in development and at build, a throw on runtime revalidation', async () => {
    h.result = { ok: false, reason: 'db_down' };
    expect(await render()).toContain('The database isn’t answering');

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    expect(await render()).toContain('The database isn’t answering');

    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
    await expect(BoardPage()).rejects.toThrow(/serving the last good page/);
  });
});
