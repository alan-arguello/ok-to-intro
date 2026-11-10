'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, ButtonLink, ButtonRow } from '@/components/kit/button';
import { RadioGroup } from '@/components/kit/radio-group';
import { Notice } from '@/components/kit/surfaces';
import { announce } from '@/components/site/live-region';
import { PAUSE_CHOICES, PAUSE_COPY, pauseChipLabel, pausePhrase, type PauseChoice } from './copy';
import { useFocusAfterCommit } from './hooks';
import { pauseErrorText, type PauseError, type PauseViewState } from './pause-state';

export type { PauseViewState } from './pause-state';

/**
 * /pause/[token] (ux-spec S3 “Pause from an email”). GET renders and never changes anything; “Pause asks” is a plain
 * `<form method="post" action="/api/pause">` (the List-Unsubscribe-Post handler, BE2), which answers 303 →
 * /pause/<token>?done=<until>. Without JS the chips are links that preselect with a GET (?until=…) and the form posts
 * normally; with JS the chips select in place and the POST runs through fetch, so a dropped connection shows
 * “Didn’t go through…” instead of a browser error page. Undo posts `until=undo` to the same handler.
 * SAMPLE (QA states) simulates the POST in the tab and sends nothing.
 */

export function PauseView({ token, sample, initial, nowMs }: { token: string; sample: boolean; initial: PauseViewState; nowMs: number }) {
  const router = useRouter();
  const [state, setState] = useState<PauseViewState>(initial);
  const [choice, setChoice] = useState<PauseChoice>(initial.kind === 'confirm' ? initial.choice : 'month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PauseError | null>(initial.error);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const focusLater = useFocusAfterCommit();

  useEffect(() => {
    if (state.kind === 'paused' && state.focus) {
      doneRef.current?.focus();
      announce('Paused. Offers go to others.');
    }
    if (state.kind === 'confirm' && state.undone) announce(PAUSE_COPY.undone);
  }, [state]);

  // An error that came back with the page (after a no-JS POST, or a QA state): role="alert" only speaks when inserted.
  useEffect(() => {
    if (initial.error) announce(pauseErrorText(initial.error));
  }, [initial.error]);

  async function post(form: HTMLFormElement, until: PauseChoice | 'undo') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (sample) {
        await new Promise((r) => setTimeout(r, 350));
        setState(
          until === 'undo'
            ? { kind: 'confirm', choice, error: null, undone: true }
            : { kind: 'paused', phrase: pausePhrase(until, nowMs), canUndo: true, focus: true, error: null },
        );
        if (until === 'undo') focusLater('#pause-go');
        return;
      }
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), credentials: 'same-origin' });
      const url = new URL(res.url, window.location.href);
      if (url.pathname.startsWith('/pause/') && (url.searchParams.has('done') || url.searchParams.has('error'))) {
        router.replace(`${url.pathname}${url.search}`);
        return;
      }
      // The error line is role="alert", so inserting it announces it.
      setError(res.status >= 500 ? 'down' : 'failed');
    } catch {
      setError('failed');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>, until: PauseChoice | 'undo') {
    e.preventDefault();
    void post(e.currentTarget, until);
  }

  const errorLine = error ? (
    <p className="error-text" id="pause-err" role="alert">
      {pauseErrorText(error)}
    </p>
  ) : null;

  if (state.kind === 'paused') {
    return (
      <div id="pause-done" className="pause-done">
        <h1 className="title" id="pause-done-h" tabIndex={-1} ref={doneRef}>
          {`Paused ${state.phrase}.`}
        </h1>
        <p className="lede">{PAUSE_COPY.doneLede}</p>
        <ButtonRow>
          {state.canUndo ? (
            <form method="post" action="/api/pause" onSubmit={(e) => onSubmit(e, 'undo')}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="until" value="undo" />
              <Button size="lg" type="submit" id="pause-undo" busy={busy}>
                {PAUSE_COPY.undo}
              </Button>
            </form>
          ) : null}
          <ButtonLink variant="primary" size="lg" href="/rules" primary>
            {PAUSE_COPY.yourGate}
          </ButtonLink>
        </ButtonRow>
        {errorLine}
      </div>
    );
  }

  return (
    <div id="pause-ask">
      <h1 className="title" id="pause-title">
        {`Pause new asks ${pausePhrase(choice, nowMs)}?`}
      </h1>
      <p className="lede">{PAUSE_COPY.lede}</p>
      {state.undone ? (
        <div className="pause-notice">
          <Notice role="status">{PAUSE_COPY.undone}</Notice>
        </div>
      ) : null}
      <form className="pause-form" id="pause-form" method="post" action="/api/pause" onSubmit={(e) => onSubmit(e, choice)}>
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <span className="label" id="pause-l">
            {PAUSE_COPY.forHowLong}
          </span>
          <RadioGroup
            variant="chips"
            labelledBy="pause-l"
            name="until"
            value={choice}
            options={PAUSE_CHOICES.map((c) => ({ value: c, label: pauseChipLabel(c, nowMs), href: `?until=${c}` }))}
            onChange={setChoice}
          />
        </div>
        <ButtonRow>
          <Button variant="primary" size="lg" type="submit" id="pause-go" primary busy={busy}>
            {PAUSE_COPY.pauseAsks}
          </Button>
          <ButtonLink size="lg" href="/rules">
            {PAUSE_COPY.notNow}
          </ButtonLink>
        </ButtonRow>
        {errorLine}
      </form>
    </div>
  );
}
