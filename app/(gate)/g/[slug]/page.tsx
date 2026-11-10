import type { Metadata } from 'next';
import { GateChrome, NOT_SET_UP_BODY, NOT_SET_UP_TITLE } from '@/components/gates/gate-chrome';
import { AskForm } from '@/components/gates/ask-form';
import { Notice } from '@/components/kit/surfaces';
import { getPublicGate } from '@/lib/server/personal-gates';
import { askGateAction } from './actions';

/** `/g/<slug>`: ask one person through their gate. Their rules are never shown here. Dynamic, never indexed. */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await getPublicGate(slug);
  return { title: res.ok ? `Ask ${res.gate.name}` : 'Personal gate' };
}

export default async function GatePage({ params }: Props) {
  const { slug } = await params;
  const res = await getPublicGate(slug);
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
    </GateChrome>
  );
}
