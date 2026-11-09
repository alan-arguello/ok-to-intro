import { ButtonLink, ButtonRow } from '@/components/kit/button';
import { NOTHING_SENT } from '@/lib/oti/copy';
import { ME_COPY } from './copy';

/**
 * /me when the member's data can't be read (ux-spec §8 “Database down”): “Something broke on our side. Nothing was
 * sent to anyone. (Try again)”. Try again is a plain link to /me, so it works without JS.
 */
export function MeError({ notConfigured = false }: { notConfigured?: boolean }) {
  return (
    <div className="container container--col">
      <div className="me-error" role="alert">
        <h1 className="title">{notConfigured ? ME_COPY.title : ME_COPY.downTitle}</h1>
        <p className="lede">{notConfigured ? ME_COPY.notConfigured : `${NOTHING_SENT} Your gate didn’t load; your settings are unchanged.`}</p>
        <ButtonRow>
          {notConfigured ? (
            <ButtonLink variant="primary" href="/rules" primary>
              Try the playground
            </ButtonLink>
          ) : (
            <>
              <ButtonLink variant="primary" href="/me" primary plain>
                Try again
              </ButtonLink>
              <ButtonLink href="/rules">Try the playground</ButtonLink>
            </>
          )}
        </ButtonRow>
      </div>
    </div>
  );
}
