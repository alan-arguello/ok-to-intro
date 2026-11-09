import Link from 'next/link';
import { FOOTER_LINE, FOOTER_LINKS } from '@/lib/site';

/**
 * The footer on every page: the disclaimer (the product's one mention of Y Combinator), then Board · Privacy ·
 * Code (MIT). Hit areas are 40 px on phones (tokens.css). It sits at the bottom of short pages because the
 * body is a flex column.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__in">
        <p>{FOOTER_LINE}</p>
        <nav className="site-footer__links" aria-label="Footer">
          {FOOTER_LINKS.map((l) =>
            l.external ? (
              <a key={l.href} href={l.href} rel="noopener">
                {l.label}
              </a>
            ) : (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}
