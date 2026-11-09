import type { Metadata } from 'next';
import { BoardIsland } from '@/components/board/board-island';
import { BOARD_COPY } from '@/components/board/copy';
import { boardView, emptyBoardView } from '@/components/board/model';
import { shareMetadata } from '@/components/static/share';
import { qaEnabled } from '@/lib/qa';
import { getBoard, getEvalSummary } from '@/lib/server/board';
import '@/styles/board.css';

/**
 * S7 · /board (ux-spec S7). Real counts with their denominators, from `public.board_snapshot()` through
 * lib/server/board.ts, served with ISR: regenerated at most once a minute, from the CDN in between.
 *
 * - No database on this instance: the designed “not connected” board (no numbers), plus the eval section.
 * - Database down while building: the designed “isn’t answering” board, so the build never fails.
 * - Database down at runtime: the render throws, and ISR keeps serving the last good page, whose “Last update”
 *   stays true; the client island reads /api/health and labels those counts as stale.
 * Example numbers render only in an explicit QA ?state=, next to the dashed prototype note (client island).
 */
export const revalidate = 60;

export const metadata: Metadata = shareMetadata({ title: BOARD_COPY.title, description: BOARD_COPY.description, path: '/board' });

export default async function BoardPage() {
  const result = await getBoard();
  const evalSummary = getEvalSummary();
  const building = process.env.NEXT_PHASE === 'phase-production-build';
  if (!result.ok && result.reason === 'db_down' && !building && process.env.NODE_ENV === 'production') {
    // Runtime revalidation: keep the last good page instead of replacing real counts with an outage notice.
    throw new Error('board: the database did not answer; serving the last good page');
  }
  const view = result.ok
    ? boardView({ snapshot: result.snapshot, asOfKind: result.asOfKind, evalSummary })
    : emptyBoardView(result.reason, evalSummary);
  return <BoardIsland view={view} qa={qaEnabled()} />;
}
