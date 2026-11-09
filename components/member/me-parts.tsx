'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button, ButtonLink, ButtonRow } from '@/components/kit/button';
import { copyText } from '@/components/kit/code-block';
import { Verdict } from '@/components/kit/pills';
import { announce } from '@/components/site/live-region';
import { PLUGIN_CONFIGURE_COMMAND, ROUTES } from '@/lib/site';
import { ASK_OUTCOME_PILL, ME_COPY, timeLabelText, tokenLine, WHO_SEES_WHAT } from './copy';
import { useHydrated } from './hooks';
import type { MeAsks, MeToken, TimeLabel } from './me-types';

/** A server-labelled time, re-labelled in the viewer's zone once hydrated (no hydration mismatch). */
export function useTimeText(t: TimeLabel | null, nowMs: number): string {
  const hydrated = useHydrated();
  if (!t) return '';
  if (!hydrated || !t.iso) return t.label;
  return timeLabelText(t.fmt, Date.parse(t.iso), nowMs);
}

/** “Who sees what” (ux-spec S3): a table, stacked rows at 640 px and below. */
export function WhoSeesWhat({ note }: { note: string }) {
  return (
    <section className="section" id="who" aria-labelledby="me-who-h">
      <h2 className="h2" id="me-who-h">
        {ME_COPY.whoSeesWhat}
      </h2>
      <div className="me-table-wrap">
        <table className="me-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">What</span>
              </th>
              <th scope="col">You</th>
              <th scope="col">Askers</th>
              <th scope="col">Other members</th>
            </tr>
          </thead>
          <tbody>
            {WHO_SEES_WHAT.map((row) => (
              <tr key={row.what}>
                <th scope="row">{row.what}</th>
                <td data-label="You">
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">Yes</span>
                </td>
                {row.askers ? (
                  <td data-label="Askers">{row.askers}</td>
                ) : (
                  <td data-label="Askers" className="me-no">
                    <span aria-hidden="true">–</span>
                    <span className="sr-only">No</span>
                  </td>
                )}
                <td data-label="Other members" className="me-no">
                  <span aria-hidden="true">–</span>
                  <span className="sr-only">No</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small ink-2 me-who-note">{note}</p>
    </section>
  );
}

function AskRow({ item, nowMs }: { item: Extract<MeAsks, { state: 'ok' }>['items'][number]; nowMs: number }) {
  const pill = ASK_OUTCOME_PILL[item.outcome];
  const date = useTimeText(item.created, nowMs);
  return (
    <li className="row me-ask">
      <Link className="me-ask__link" href={item.href}>
        <Verdict kind={pill.kind}>{pill.label}</Verdict>
        <span className="row__name">{item.subject}</span>
        <span className="row__aside">{date}</span>
      </Link>
    </li>
  );
}

/** “Your asks” (REAL: subject, state pill, date → /ask/[id]; empty: “No asks yet. Ask the network ›”). */
export function AsksList({ asks, nowMs }: { asks: MeAsks; nowMs: number }) {
  if (asks.state === 'down') return <p className="small">{ME_COPY.asksDown}</p>;
  if (asks.state === 'off' || !asks.items.length) {
    return (
      <p className="small">
        {ME_COPY.noAsks}{' '}
        <Link className="link" href={ROUTES.ask}>
          {ME_COPY.askTheNetwork}
        </Link>
      </p>
    );
  }
  return (
    <>
      {asks.example ? <p className="proto-note me-asks-note">{ME_COPY.protoRows}</p> : null}
      <ul className="list" role="list">
        {asks.items.map((item) => (
          <AskRow key={item.id} item={item} nowMs={nowMs} />
        ))}
      </ul>
    </>
  );
}

/** The Claude Code token panel: create (shown once, Copy), last use, revoke. */
export function TokenPanel({
  token,
  nowMs,
  busy,
  error: errorText,
  onCreate,
  onRevoke,
}: {
  token: MeToken;
  nowMs: number;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
  onRevoke: () => void;
}) {
  const created = useTimeText(token.state === 'active' || token.state === 'new' ? token.created : null, nowMs);
  const lastUsed = useTimeText(token.state === 'active' ? token.lastUsed : null, nowMs);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const error = errorText ? (
    <p className="error-text" role="alert">
      {errorText}
    </p>
  ) : null;
  const revoke = (
    <Button size="sm" onClick={onRevoke} busy={busy}>
      {ME_COPY.revoke}
    </Button>
  );

  if (token.state === 'off') return <p className="small ink-2">{ME_COPY.tokenOff}</p>;
  if (token.state === 'active') {
    return (
      <>
        <div className="me-token__line">
          <span>{tokenLine(created, token.lastUsed ? lastUsed : null)}</span>
          {revoke}
        </div>
        {error}
      </>
    );
  }
  if (token.state === 'new') {
    return (
      <>
        <div className="code">
          <code>{token.token}</code>
          <button
            id="me-token-copy"
            className="btn"
            type="button"
            data-primary=""
            onClick={async () => {
              if (await copyText(token.token)) {
                setCopied(true);
                announce('Copied');
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? 'Copied' : ME_COPY.copy}
          </button>
        </div>
        <p className="help">
          Copy it now. It won’t be shown again. Paste it when Claude Code asks for your OK to Intro token, or run <code>{PLUGIN_CONFIGURE_COMMAND}</code>.
        </p>
        <div className="me-token__line">
          <span>{tokenLine(created, null)}</span>
          {revoke}
        </div>
        {error}
      </>
    );
  }
  const create = (
    <ButtonRow>
      <Button id="me-token-create" onClick={onCreate} busy={busy}>
        {ME_COPY.createToken}
      </Button>
    </ButtonRow>
  );
  if (token.state === 'revoked') {
    return (
      <>
        <p className="small">{ME_COPY.revoked}</p>
        {create}
        {error}
      </>
    );
  }
  return (
    <>
      <p className="small ink-2">
        {ME_COPY.tokenIntro}{' '}
        <Link className="link" href={ROUTES.agents}>
          {ME_COPY.tokenHow}
        </Link>
      </p>
      {create}
      {error}
    </>
  );
}

/** “Deleted.” (ux-spec S3): rendered in place in the SAMPLE preview, and as /me/deleted after a real delete. */
export function DeletedView() {
  return (
    <div className="me-deleted">
      <h1 className="title" id="me-gone-h" tabIndex={-1}>
        {ME_COPY.deletedTitle}
      </h1>
      <p className="lede">{ME_COPY.deletedBody}</p>
      <ButtonRow>
        <ButtonLink variant="primary" href="/" primary>
          Try the playground
        </ButtonLink>
      </ButtonRow>
    </div>
  );
}
