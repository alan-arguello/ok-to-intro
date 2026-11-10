import Link from 'next/link';
import { FOOTER_LINE, FOOTER_LINKS } from '@/lib/site';

/**
 * The footer of /o and /c. ux-spec S5: “Footers follow the recipient: askers get Your ask;
 * members get Pause all asks · Change your rules”; the prototype's offer page leads with Pause all asks. Same markup and the same disclaimer as the shared footer (components/site/site-footer.tsx), which
 * these pages hide with one :has() rule in styles/offer.css, so each page keeps one contentinfo landmark.
 */

export interface FooterLink {
  href: string;
  label: string;
}

export type RecipientMode = 'sample' | 'example' | 'real';

/** The demo has one pause page (/pause/sample) and no accounts, so nothing here links to sign-in or a member page. */
const PAUSE: FooterLink = { href: '/pause/sample', label: 'Pause all asks' };

/** /o: the member holding the offer. */
export function offerFooterLinks(mode: RecipientMode): FooterLink[] {
  return mode === 'real' ? [] : [PAUSE];
}

/**
 * /c: by the recipient's role. “Your ask” opens that ask (CheckinView.ask_id); on SAMPLE it opens the sample ask in
 * this tab (`sa_health` is the canonical one).
 */
export function checkinFooterLinks(mode: RecipientMode, role: 'asker' | 'member', askId: string | null): FooterLink[] {
  if (role === 'member') {
    return [...(mode === 'real' ? [] : [PAUSE]), { href: '/rules', label: 'Change your rules' }];
  }
  const id = mode === 'sample' ? (askId ?? 'sa_health') : askId;
  return id ? [{ href: `/ask/${encodeURIComponent(id)}`, label: 'Your ask' }] : [];
}

export function RecipientFooter({ links }: { links: readonly FooterLink[] }) {
  const site = FOOTER_LINKS;
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
