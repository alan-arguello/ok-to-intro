import Link from 'next/link';
import { FOOTER_LINE, FOOTER_LINKS } from '@/lib/site';

/**
 * The footer of /o and /c. ux-spec S5: “Footers follow the recipient: askers get Your ask · Delete my data;
 * members get Pause all asks · Change your rules · Delete my data”; the prototype's offer page leads with
 * Pause all asks. Same markup and the same disclaimer as the shared footer (components/site/site-footer.tsx), which
 * these pages hide with one :has() rule in styles/offer.css, so each page keeps one contentinfo landmark.
 */

export interface FooterLink {
  href: string;
  label: string;
}

export type RecipientMode = 'sample' | 'example' | 'real';

/** Pause links from a page need the member's own pause token: SAMPLE has its own, REAL pauses from Your gate. */
function pauseHref(mode: RecipientMode): string {
  return mode === 'sample' ? '/pause/sample' : '/me#settings';
}

/** /o: the member holding the offer. */
export function offerFooterLinks(mode: RecipientMode): FooterLink[] {
  return [{ href: pauseHref(mode), label: 'Pause all asks' }];
}

/**
 * /c: by the recipient's role. A REAL check-in doesn't carry its ask's id, so an asker's “Your ask” opens their
 * asks under Your gate; on SAMPLE it opens the sample ask in this tab (`sa_health` is the canonical one).
 */
export function checkinFooterLinks(mode: RecipientMode, role: 'asker' | 'member', askId: string | null): FooterLink[] {
  if (role === 'member') {
    return [
      { href: pauseHref(mode), label: 'Pause all asks' },
      { href: '/me#settings', label: 'Change your rules' },
      { href: '/me#delete', label: 'Delete my data' },
    ];
  }
  return [
    { href: mode === 'sample' ? `/ask/${encodeURIComponent(askId ?? 'sa_health')}` : '/me#asks', label: 'Your ask' },
    { href: '/me#delete', label: 'Delete my data' },
  ];
}

export function RecipientFooter({ links, board = true }: { links: readonly FooterLink[]; board?: boolean }) {
  const site = FOOTER_LINKS.filter((l) => board || l.href !== '/board');
  return (
    <footer className="site-footer offer-footer">
      <div className="site-footer__in">
        <p>{FOOTER_LINE}</p>
        <nav className="site-footer__links" aria-label="Footer">
          {links.map((l) => (
            <Link key={l.label} href={l.href} prefetch={false}>
              {l.label}
            </Link>
          ))}
          {site.map((l) =>
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
