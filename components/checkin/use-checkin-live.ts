'use client';

import { fmtDay } from '@/lib/oti/time';
import { DAY_MS } from '@/lib/oti/time';
import { useClientNow, useLocalTime, useSampleStores } from '@/components/offer/client-hooks';
import { loopForAsk } from '@/components/offer/sample-loop';
import { loopOther } from '@/lib/emails/sample';
import type { CheckinPageModel } from './model';

export interface CheckinLive {
  other: { name: string; first: string } | null;
  subject: string | null;
  introMade: string;
  d14: string;
  reminder: string;
  answeredOn: string;
  closedOn: string;
  /** True until the visitor's tab has been read on a SAMPLE loop (`?ask=`). */
  awaiting: boolean;
}

/**
 * Names and dates for the check-in. REAL and the canonical SAMPLE come from the server (shown in the viewer's own
 * zone after hydration); a SAMPLE loop (`/c/sample?ask=…`) names that loop's people and dates it from the moment
 * the visitor said OK on /o/sample, read from the tab.
 */
export function useCheckinLive(model: CheckinPageModel): CheckinLive {
  const loopId = model.mode === 'sample' && model.source.kind === 'ask' ? model.source.id : null;
  const stores = useSampleStores(loopId !== null);
  const now = useClientNow();
  const introMade = useLocalTime(model.introMade?.iso ?? null, 'day', model.introMade?.text ?? '');
  const d14 = useLocalTime(model.d14?.iso ?? null, 'day', model.d14?.text ?? '');
  const reminder = useLocalTime(model.reminder?.iso ?? null, 'day', model.reminder?.text ?? '');
  const answeredOn = useLocalTime(model.answeredOn?.iso ?? null, 'day', model.answeredOn?.text ?? '');
  const closedOn = useLocalTime(model.closedOn?.iso ?? null, 'day', model.closedOn?.text ?? '');
  const base: CheckinLive = { other: model.other, subject: model.subject, introMade, d14, reminder, answeredOn, closedOn, awaiting: false };
  if (!loopId) return base;
  if (stores === null || now === null) return { ...base, awaiting: true };
  const loop = loopForAsk(loopId, stores, now);
  if (!loop) return base;
  const role = model.ui.role;
  return {
    ...base,
    other: loopOther(loop, role),
    subject: loop.subject.replace(/,\s*20 min\?\s*$/, ''),
    introMade: fmtDay(loop.introAt),
    d14: fmtDay(loop.introAt + 14 * DAY_MS),
    reminder: fmtDay(loop.introAt + 4 * DAY_MS),
    answeredOn: fmtDay(now),
  };
}
