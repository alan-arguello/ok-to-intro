import type { Metadata } from 'next';
import { ButtonLink, ButtonRow } from '@/components/kit/button';
import { SampleTag } from '@/components/kit/pills';
import { isPauseChoice, PAUSE_COPY, pausePhrase, type PauseChoice } from '@/components/member/copy';
import { pauseViewState, type PauseViewState } from '@/components/member/pause-state';
import { PauseView } from '@/components/member/pause-view';
import { SlimPage } from '@/components/site/slim-page';
import { qaState } from '@/lib/qa';
import { EXAMPLE_ME } from '@/lib/sample/examples';
import { getPauseLinkView } from '@/lib/server/member';
import '@/styles/member.css';

/**
 * /pause/[token] (owner: S3): pause new asks from any email, no sign-in. The token is the capability (only its HMAC
 * is stored); GET only reads (whose gate, paused or not, whether this link can Undo) and changes nothing. The form
 * posts to /api/pause (BE2), the same handler as one-click unsubscribe, which redirects back here with ?done= or
 * ?error=. next.config.ts sends no-store, no-referrer and noindex for /pause/*.
 */

export const dynamic = 'force-dynamic';

const description = 'Pause new asks from an email link, with one tap and no sign-in. Offers go to others while you are paused.';

export const metadata: Metadata = {
  title: 'Pause new asks',
  description,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function Message({ title, body, action }: { title: string; body: string; action: { href: string; label: string; plain?: boolean } }) {
  return (
    <div className="pause-off">
      <h1 className="title">{title}</h1>
      <p className="lede">{body}</p>
      <ButtonRow>
        <ButtonLink variant="primary" size="lg" href={action.href} primary plain={action.plain}>
          {action.label}
        </ButtonLink>
      </ButtonRow>
    </div>
  );
}

const MAIN = 'container container--narrow pause-main';
const PAUSE_SAMPLE_NOTE = 'A fictional member. Buttons show what happens; nothing is paused.';

export default async function PausePage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const nowMs = new Date().getTime();
  const qa = qaState('pause', sp.state);
  const until = one(sp.until);

  // /pause/sample: the fictional member every SAMPLE email and page links to. Buttons show what happens; nothing changes.
  if (qa || token === 'sample') {
    const preselected: PauseChoice = isPauseChoice(until) ? until : 'month';
    const initial: PauseViewState =
      qa === 'paused'
        ? { kind: 'paused', phrase: pausePhrase(preselected, nowMs), canUndo: true, focus: false, error: null }
        : { kind: 'confirm', choice: preselected, error: qa === 'post-failed' ? 'failed' : null, undone: false };
    return (
      <SlimPage meta={`${EXAMPLE_ME.name} · cap ${EXAMPLE_ME.cap} a month`} mainClassName={MAIN}>
        <PauseView key={qa ?? 'sample'} token={token} sample initial={initial} nowMs={nowMs} />
        {qa ? null : (
          <p className="small pause-sample-note">
            <SampleTag /> {PAUSE_SAMPLE_NOTE}
          </p>
        )}
      </SlimPage>
    );
  }

  const res = await getPauseLinkView(token);
  if (!res.ok) {
    return (
      <SlimPage mainClassName={MAIN}>
        {res.reason === 'invalid' ? (
          <Message title={PAUSE_COPY.invalidTitle} body={PAUSE_COPY.invalidBody} action={{ href: '/me', label: PAUSE_COPY.yourGate }} />
        ) : res.reason === 'not_configured' ? (
          <Message title={PAUSE_COPY.offTitle} body={PAUSE_COPY.offBody} action={{ href: '/', label: 'Try the playground' }} />
        ) : (
          <Message title={PAUSE_COPY.downTitle} body={PAUSE_COPY.downBody} action={{ href: `/pause/${encodeURIComponent(token)}`, label: 'Try again', plain: true }} />
        )}
      </SlimPage>
    );
  }

  const view = res.view;
  const meta = [view.member_name, `cap ${view.cap} a month`].filter(Boolean).join(' · ');
  if (view.status === 'pending') {
    return (
      <SlimPage meta={meta} mainClassName={MAIN}>
        <Message title={PAUSE_COPY.pendingTitle} body={PAUSE_COPY.pendingBody} action={{ href: '/me', label: PAUSE_COPY.yourGate }} />
      </SlimPage>
    );
  }

  const done = one(sp.done);
  const error = one(sp.error);
  const initial = pauseViewState(view, { until, done, error });
  return (
    <SlimPage meta={meta} mainClassName={MAIN}>
      <PauseView key={`${initial.kind}:${done ?? ''}:${error ?? ''}:${until ?? ''}`} token={token} sample={false} initial={initial} nowMs={nowMs} />
    </SlimPage>
  );
}
