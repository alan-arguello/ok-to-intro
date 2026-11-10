import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { AskForm } from '@/components/gates/ask-form';
import { GateChrome, NOT_SET_UP_BODY, NOT_SET_UP_TITLE } from '@/components/gates/gate-chrome';
import { Notice } from '@/components/kit/surfaces';
import { gatePath, MAKE_GATE_HREF } from '@/lib/oti/personal-gate';
import { getPublicGate } from '@/lib/server/personal-gates';
import { PRODUCT_NAME } from '@/lib/site';
import { askGateAction } from './actions';

/**
 * `/g/<slug>`: ask one person through their gate. Their rules are never shown here. Dynamic, never indexed; the share
 * preview is “Ask <name>” with their headline (opengraph-image.tsx next to this file).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string }> };

/** One read per request, shared by the metadata and the page. */
const loadGate = cache((slug: string) => getPublicGate(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await loadGate(slug);
  if (!res.ok) return { title: 'Personal gate' };
  const g = res.gate;
  const title = `Ask ${g.name}`;
  const shareTitle = `${title} · ${PRODUCT_NAME}`;
  const description = g.headline || `Your ask is checked against what ${g.name} agreed to be asked.`;
  // No `images` here: the image file next to this page fills og:image, and the Twitter tags follow it.
  return {
    title,
    description,
    openGraph: { type: 'website', siteName: PRODUCT_NAME, url: gatePath(g.slug), title: shareTitle, description },
    twitter: { card: 'summary_large_image', title: shareTitle, description },
  };
}

export default async function GatePage({ params }: Props) {
  const { slug } = await params;
  const res = await loadGate(slug);
  if (!res.ok) {
    return (
      <GateChrome>
        <header className="page-head">
          <h1 className="h1">{res.reason === 'not_configured' ? NOT_SET_UP_TITLE : res.reason === 'db_down' ? 'This gate isn’t answering' : 'No gate at this link'}</h1>
        </header>
        <Notice>
          {res.reason === 'not_configured'
            ? NOT_SET_UP_BODY
            : res.reason === 'db_down'
              ? 'The database didn’t answer. Nothing was sent. Try again in a minute.'
              : 'Check the link with the person who shared it.'}
        </Notice>
      </GateChrome>
    );
  }
  const g = res.gate;
  return (
    <GateChrome name={g.name}>
      <header className="page-head">
        <h1 className="h1">Ask {g.name}</h1>
        {g.headline ? <p className="lede">{g.headline}</p> : null}
        <p className="small ink-2">
          {g.name} set rules for what they’ll take. Your ask is checked against them before it reaches them.
        </p>
      </header>
      <AskForm slug={g.slug} name={g.name} action={askGateAction} />
      <p className="small gate-own">
        <Link className="link" href={MAKE_GATE_HREF}>
          Want your own? Make a gate link in 30 seconds
        </Link>
      </p>
    </GateChrome>
  );
}
