import type { Metadata } from 'next';
import { AskCompose } from '@/components/ask/compose';
import { ASK_DESCRIPTION, ASK_TITLE } from '@/components/ask/copy';
import { resolveDegraded, resolveQaState, qaEnabled } from '@/lib/qa';
import { isPresetId } from '@/lib/sample/presets';
import { PRODUCT_NAME } from '@/lib/site';
import { first, liveInfo } from './_server/access';
import '@/styles/ask.css';

/**
 * S2 · /ask (ux-spec S2 “Compose”), the same composer as `/`. Dynamic on purpose: `?from=`, `?preset=`, `?edit=`,
 * `?new=` and QA `?state=` are read here, with the live state. Every send goes to the 40 sample members.
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
  const live = await liveInfo();
  const presetParam = first(sp.preset);

  return (
    <AskCompose
      qaState={qaState}
      degraded={degraded}
      live={live}
      preset={presetParam && isPresetId(presetParam) ? presetParam : null}
      from={first(sp.from) === 'playground' ? 'playground' : null}
      edit={first(sp.edit) === '1'}
      fresh={first(sp.new) === '1'}
    />
  );
}
