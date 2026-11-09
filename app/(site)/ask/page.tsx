import type { Metadata } from 'next';
import { AskCompose } from '@/components/ask/compose';
import { ASK_DESCRIPTION, ASK_TITLE } from '@/components/ask/copy';
import type { ResendSeed } from '@/components/ask/types';
import { isRealAskId } from '@/lib/oti/ids';
import { resolveDegraded, resolveQaState, qaEnabled } from '@/lib/qa';
import { isPresetId } from '@/lib/sample/presets';
import { getAskerView } from '@/lib/server/asks';
import { PRODUCT_NAME } from '@/lib/site';
import { askViewer, first, liveInfo } from './_server/access';
import '@/styles/ask.css';

/**
 * S2 · /ask (ux-spec S2 “Compose”). Dynamic on purpose (docs/CONTRACT.md §f): the REAL option and “Sent as” read
 * the session, and `?from=`, `?preset=`, `?edit=`, `?resend=` and QA `?state=` are read here. Without Supabase or a
 * model key it still renders the whole SAMPLE compose; REAL shows why it is unavailable.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: ASK_TITLE,
  description: ASK_DESCRIPTION,
  alternates: { canonical: '/ask' },
  openGraph: { type: 'website', siteName: PRODUCT_NAME, title: `${ASK_TITLE} · ${PRODUCT_NAME}`, description: ASK_DESCRIPTION, url: '/ask' },
  twitter: { card: 'summary_large_image', title: `${ASK_TITLE} · ${PRODUCT_NAME}`, description: ASK_DESCRIPTION },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AskPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const qa = qaEnabled();
  const qaState = resolveQaState('ask', first(sp.state), qa);
  const degraded = resolveDegraded(first(sp.degraded), qa);
  const [live, viewer] = await Promise.all([liveInfo(), askViewer()]);

  const presetParam = first(sp.preset);
  const resendId = first(sp.resend);
  let resend: ResendSeed | null = null;
  if (resendId && isRealAskId(resendId) && viewer.user && viewer.access.kind === 'allowed') {
    try {
      const r = await getAskerView(resendId, viewer.user);
      if (r.ok) resend = { id: r.view.id, text: r.view.compiled.text, suggestion: r.view.no_match?.suggestion ?? null };
    } catch {
      resend = null;
    }
  }

  return (
    <AskCompose
      qaState={qaState}
      degraded={degraded}
      live={live}
      real={viewer.access}
      preset={presetParam && isPresetId(presetParam) ? presetParam : null}
      from={first(sp.from) === 'playground' ? 'playground' : null}
      edit={first(sp.edit) === '1'}
      fresh={first(sp.new) === '1'}
      resend={resend}
    />
  );
}
