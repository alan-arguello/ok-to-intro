'use client';

import Link from 'next/link';
import { SampleTag } from '@/components/kit/pills';
import { useClientNow, useSampleStores } from '@/components/offer/client-hooks';
import { loopForAsk } from '@/components/offer/sample-loop';
import { emailFragment } from '@/lib/emails';
import { buildSampleEmail, sampleEmailMeta, type SampleEmailKind } from '@/lib/emails/sample';
import { NETWORK_TZ } from '@/lib/oti/time';
import { SITE_URL } from '@/lib/site';
import type { CheckinRole } from '@/lib/types';

/**
 * The public SAMPLE email viewer (owner R): the real templates (lib/emails) rendered with fictional data, in a review
 * frame with the headers, the plain-text part and both versions where the recipient's role changes the email.
 * With `?ask=<id>` the email is rebuilt from the visitor's own tab (the SAMPLE loop), so the intro shows the ask that
 * was actually sent and the member who held it. Nothing here is sent.
 */

export interface EmailViewerProps {
  kind: SampleEmailKind;
  who: CheckinRole;
  text: boolean;
  askId: string | null;
  /** The From line (EMAIL_FROM on this instance), or the product name without an address. */
  from: string;
  /** The server's clock for the first paint (SAMPLE loops then use the viewer's own). */
  serverNow: number;
}

/** Links inside the email point at this site; make them relative so the SAMPLE loop stays on this origin and tab. */
function sameOrigin(html: string): string {
  return html.split(`href="${SITE_URL}/`).join('href="/');
}

function query(params: Record<string, string | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function EmailViewer({ kind, who, text, askId, from, serverNow }: EmailViewerProps) {
  const stores = useSampleStores(askId !== null);
  const now = useClientNow();
  const awaiting = askId !== null && (stores === null || now === null);
  // Server and first paint: the canonical loop for a known sample id (or the REAL example). Then the visitor's tab.
  const loop = askId ? loopForAsk(askId, stores ?? { sampleAsk: null, sampleOffer: null, playground: null }, now ?? serverNow) : null;
  // Until the tab is read the server's clock and zone render (so hydration matches); then the viewer's own.
  const email = buildSampleEmail(kind, { who, loop, tz: now === null ? NETWORK_TZ : undefined });
  const meta = sampleEmailMeta(kind);
  const m = email.message;
  const base = `/emails/${kind}`;
  const keep = { ask: askId, who: meta.roles && who === 'member' ? 'member' : null };
  const htmlHref = `${base}${query({ ...keep })}`;
  const textHref = `${base}${query({ ...keep, v: 'text' })}`;
  const otherWho = who === 'member' ? 'asker' : 'member';
  const unsubscribe = m.headers['List-Unsubscribe'];

  return (
    <div data-await-store={awaiting ? '' : undefined}>
      <section className="mail-head" aria-label="Email headers">
        <dl>
          <dt>From</dt>
          <dd>{from}</dd>
          <dt>To</dt>
          <dd>{email.to}</dd>
          {email.replyTo ? (
            <>
              <dt>Reply-To</dt>
              <dd>{email.replyTo}</dd>
            </>
          ) : null}
          <dt>Subject</dt>
          <dd>{m.subject}</dd>
          <dt>Preheader</dt>
          <dd>{m.preheader}</dd>
          {unsubscribe ? (
            <>
              <dt>Headers</dt>
              <dd>List-Unsubscribe and List-Unsubscribe-Post: one click pauses all asks</dd>
            </>
          ) : null}
          {meta.roles ? (
            <>
              <dt>Version</dt>
              <dd>
                {who === 'member' ? 'Member' : 'Asker'} ·{' '}
                <Link className="link" href={`${base}${query({ ask: askId, who: otherWho === 'member' ? 'member' : null, v: text ? 'text' : null })}`}>
                  see the {otherWho}’s
                </Link>
              </dd>
            </>
          ) : null}
          {email.note ? (
            <>
              <dt>Note</dt>
              <dd>{email.note}</dd>
            </>
          ) : null}
        </dl>
        <p className="mail-sample">
          <SampleTag />
          No email was sent.
        </p>
        <nav className="mail-views" aria-label="Email parts">
          <Link href={htmlHref} aria-current={text ? undefined : 'page'}>
            HTML
          </Link>
          <span aria-hidden="true">·</span>
          <Link href={textHref} aria-current={text ? 'page' : undefined}>
            Plain text
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/emails">All sample emails</Link>
        </nav>
      </section>

      {text ? (
        <pre className="mail-text" tabIndex={0} aria-label="Plain-text part">
          {m.text}
        </pre>
      ) : (
        <div className="mail-email" dangerouslySetInnerHTML={{ __html: sameOrigin(emailFragment(m.html)) }} />
      )}

      {askId ? (
        <div className="btn-row mail-after">
          {askId.startsWith('sa_') ? (
            <Link className="btn" href={`/ask/${encodeURIComponent(askId)}`}>
              Back to your ask ›
            </Link>
          ) : (
            <Link className="btn" href="/">
              Back to the playground ›
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
