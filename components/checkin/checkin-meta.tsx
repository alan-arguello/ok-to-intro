'use client';

import type { CheckinPageModel } from './model';
import { useCheckinLive } from './use-checkin-live';

/** The slim header's meta on /c (ux-spec S5): “Intro made Nov 9 · Enterprise deals stuck 5 months”. */
export function CheckinMeta({ model }: { model: CheckinPageModel }) {
  const live = useCheckinLive(model);
  if (!live.subject || !live.introMade) return null;
  return (
    <span className="ck-aside" data-await-store={live.awaiting ? '' : undefined}>
      Intro made {live.introMade} · {live.subject}
    </span>
  );
}
