// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardIsland } from '@/components/board/board-island';
import { boardView, emptyBoardView } from '@/components/board/model';
import { EXAMPLE_SNAPSHOT } from '@/components/board/qa-examples';
import { PROTOTYPE_NUMBERS_NOTE } from '@/lib/oti/copy';
import type { EvalSummary } from '@/lib/types';

const NO_EVAL: EvalSummary = {
  source: 'none',
  ran_at: null,
  model: null,
  rubric_hash: null,
  header: null,
  rows: [],
  totals: null,
  wrongly_let_through: null,
  wrongly_blocked: null,
  misses: [],
};
const REAL = boardView({ snapshot: { ...EXAMPLE_SNAPSHOT, asks_sent: 13 }, asOfKind: 'read', evalSummary: NO_EVAL });

function health(db: 'ok' | 'down' | 'off') {
  return vi.fn(async () => new Response(JSON.stringify({ live: 'off', live_paused_until: null, db, email: 'off', network: 'real', checked_at: '' }), { status: 200 }));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/board');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BoardIsland', () => {
  it('labels the cached counts as stale when /api/health says the database is down', async () => {
    const fetchMock = health('down');
    vi.stubGlobal('fetch', fetchMock);
    render(<BoardIsland view={REAL} qa={false} />);
    expect(await screen.findByText('The database isn’t answering. These are the counts from Nov 10, 14:02.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('says nothing extra while the database answers', async () => {
    const fetchMock = health('ok');
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<BoardIsland view={REAL} qa={false} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('.board-stale')).toBeNull();
  });

  it('does not ask for health when there are no counts to label', () => {
    const fetchMock = health('down');
    vi.stubGlobal('fetch', fetchMock);
    render(<BoardIsland view={emptyBoardView('not_configured', NO_EVAL)} qa={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('The real network isn’t connected on this instance yet.')).toBeTruthy();
  });

  it('swaps in a QA example state only when QA is on and a state is in the URL', async () => {
    vi.stubGlobal('fetch', health('ok'));
    window.history.replaceState(null, '', '/board?state=launch-day');
    const { unmount } = render(<BoardIsland view={REAL} qa />);
    expect(await screen.findByText(PROTOTYPE_NUMBERS_NOTE)).toBeTruthy();
    expect(screen.getByText('0 intros yet. Check-ins go out 1 day and 14 days after each intro.')).toBeTruthy();
    unmount();

    // Production (QA off) ignores ?state=: the real counts stay.
    render(<BoardIsland view={REAL} qa={false} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(PROTOTYPE_NUMBERS_NOTE)).toBeNull();
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('shows the stale QA state with the example numbers', async () => {
    vi.stubGlobal('fetch', health('ok'));
    window.history.replaceState(null, '', '/board?state=stale');
    render(<BoardIsland view={REAL} qa />);
    expect(await screen.findByText('The database isn’t answering. These are the counts from Nov 10, 14:02.')).toBeTruthy();
    expect(screen.getByText(PROTOTYPE_NUMBERS_NOTE)).toBeTruthy();
  });
});
