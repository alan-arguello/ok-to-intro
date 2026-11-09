import { ButtonLink, ButtonRow } from '@/components/kit/button';
import { ROUTES } from '@/lib/site';
import { NOT_FOUND_COPY } from './error-copy';
import { ERR_ACTIONS, ERR_HEAD, ERR_LEDE } from './err-layout';

/** The 404 view (prototype 404.html). Expired offer links never get here: /o/[token] renders its own expired state. */
export function NotFoundView() {
  return (
    <div className="container container--col">
      <header className="page-head err-head" style={ERR_HEAD}>
        <h1 className="h1">{NOT_FOUND_COPY.title}</h1>
        <p className="lede" style={ERR_LEDE}>
          {NOT_FOUND_COPY.lede}
        </p>
        <ButtonRow className="err-actions" style={ERR_ACTIONS}>
          <ButtonLink size="lg" href={ROUTES.join}>
            {NOT_FOUND_COPY.signIn}
          </ButtonLink>
          <ButtonLink variant="primary" size="lg" href={ROUTES.home} primary>
            {NOT_FOUND_COPY.playground}
          </ButtonLink>
        </ButtonRow>
      </header>
    </div>
  );
}
