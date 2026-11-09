'use client';

import { Button, ButtonLink, ButtonRow } from '@/components/kit/button';
import { ROUTES } from '@/lib/site';
import { ERROR_COPY } from './error-copy';
import { ERR_ACTIONS, ERR_HEAD, ERR_LEDE } from './err-layout';

/**
 * The error view (prototype error.html): what broke never interrupted anyone, so the page says so first.
 * `refCode` is the error digest Next also logs on the server (null for errors that happened in the browser).
 * Try again re-renders the failed segment; the playground keeps working without the database.
 */
export function ErrorView({ refCode, onRetry }: { refCode: string | null; onRetry: () => void }) {
  return (
    <div className="container container--col">
      <header className="page-head err-head" style={ERR_HEAD}>
        <h1 className="h1">{ERROR_COPY.h1}</h1>
        <p className="lede" style={ERR_LEDE}>
          {ERROR_COPY.nothingSent}
          {refCode ? ` Ref ${refCode}.` : null}
        </p>
        <ButtonRow className="err-actions" style={ERR_ACTIONS}>
          <Button variant="primary" size="lg" primary onClick={onRetry}>
            {ERROR_COPY.retry}
          </Button>
          <ButtonLink size="lg" href={ROUTES.home}>
            {ERROR_COPY.playground}
          </ButtonLink>
        </ButtonRow>
      </header>
    </div>
  );
}
