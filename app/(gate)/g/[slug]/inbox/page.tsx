import type { Metadata } from 'next';
import { CopyField } from '@/components/gates/copy-field';
import { DeleteGate } from '@/components/gates/delete-gate';
import { GateChrome, NOT_SET_UP_BODY, NOT_SET_UP_TITLE } from '@/components/gates/gate-chrome';
import { Disclosure, Notice } from '@/components/kit/surfaces';
import { gatePath } from '@/lib/oti/personal-gate';
import { fmtDay, NETWORK_TZ } from '@/lib/oti/time';
import { loadInbox, type InboxAsk } from '@/lib/server/personal-gates';
import { absoluteUrl } from '@/lib/site';
import { deleteGateAction } from '../actions';

/**
 * `/g/<slug>/inbox?k=<token>`: the owner's private inbox. The token is checked against the stored SHA-256 in constant
 * time; anything else renders the same page as a missing gate. Dynamic, no-store, no-referrer, never indexed.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Your gate inbox', robots: { index: false, follow: false }, referrer: 'no-referrer' };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string | string[] }> };

const VERDICT_WORD: Record<InboxAsk['verdict'], string> = {
  accept: 'Reached you',
  decline: 'Declined',
  ask_back: 'Asked a question',
  over_cap: 'Over your monthly limit',
};

function NotFound() {
  return (
    <GateChrome>
      <header className="page-head">
        <h1 className="h1">No gate at this link</h1>
      </header>
      <Notice>Check the link and try again.</Notice>
    </GateChrome>
  );
}

export default async function InboxPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const k = typeof sp.k === 'string' ? sp.k : null;
  const res = await loadInbox(slug, k);
  if (!res.ok) {
    if (res.reason === 'not_configured') {
      return (
        <GateChrome>
          <header className="page-head">
            <h1 className="h1">{NOT_SET_UP_TITLE}</h1>
          </header>
          <Notice>{NOT_SET_UP_BODY}</Notice>
        </GateChrome>
      );
    }
    if (res.reason === 'db_down') {
      return (
        <GateChrome>
          <header className="page-head">
            <h1 className="h1">Your inbox isn’t answering</h1>
          </header>
          <Notice kind="warn">The database didn’t answer. Reload in a minute.</Notice>
        </GateChrome>
      );
    }
    return <NotFound />;
  }

  const { gate, used, asks } = res;
  const reached = asks.filter((a) => a.verdict === 'accept');
  const filtered = asks.filter((a) => a.verdict !== 'accept');
  const publicUrl = absoluteUrl(gatePath(gate.slug));

  return (
    <GateChrome name={gate.name}>
      <header className="page-head page-head--left">
        <h1 className="h1">Your gate</h1>
        <p className="lede">
          This month: {used} of {gate.cap} used
        </p>
      </header>

      <section className="gate-inbox" aria-labelledby="g-public">
        <h2 className="h3" id="g-public">
          Your public link
        </h2>
        <CopyField id="g-public-url" label="Your public link" value={publicUrl} />
      </section>

      <section className="gate-inbox" aria-labelledby="g-reached">
        <h2 className="h2" id="g-reached">
          Reached you ({reached.length})
        </h2>
        {reached.length ? (
          <div className="gate-items">
            {reached.map((a) => (
              <article className="offer-card" key={a.id} aria-label={`Ask from ${a.asker_name}`}>
                <p className="offer-card__kicker">{fmtDay(Date.parse(a.created_at), NETWORK_TZ)}</p>
                <h3 className="offer-card__title">{a.asker_name}</h3>
                <p className="offer-card__from">
                  <a className="link" href={`mailto:${a.asker_email}?subject=${encodeURIComponent('Re: your ask')}`}>
                    {a.asker_email}
                  </a>
                </p>
                <p className="gate-item__text">{a.text}</p>
                {a.cited[0] ? (
                  <p className="offer-card__match">
                    Matched your rule: <q>{a.cited[0]}</q>
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <Notice>Nothing yet. Share your public link; asks that match your rules show up here.</Notice>
        )}
      </section>

      <section className="gate-inbox" aria-label="Filtered out">
        <Disclosure summary={`Filtered out (${filtered.length})`}>
          {filtered.length ? (
            <div className="list gate-filtered">
              {filtered.map((a) => (
                <div className="row" key={a.id}>
                  <p className="small">
                    <strong>{VERDICT_WORD[a.verdict]}</strong> · {a.asker_name} · {fmtDay(Date.parse(a.created_at), NETWORK_TZ)}
                  </p>
                  {a.verdict === 'ask_back' && a.question ? <p className="small ink-2">Asked: {a.question}</p> : a.reason ? <p className="small ink-2">{a.reason}</p> : null}
                  <p className="small">{a.text.length > 240 ? `${a.text.slice(0, 240)}…` : a.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="small ink-2">Nothing filtered out yet.</p>
          )}
        </Disclosure>
      </section>

      <section className="gate-danger">
        <DeleteGate slug={gate.slug} token={k ?? ''} action={deleteGateAction} />
      </section>
    </GateChrome>
  );
}
