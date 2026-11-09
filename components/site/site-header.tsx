'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { hasSessionCookie } from '@/lib/supabase/cookie-hint';
import { NAV_ITEMS, PRODUCT_NAME } from '@/lib/site';

/**
 * The full header (every page except /o, /c and /pause): wordmark, Ask · Be asked · Board · Agents · How it works,
 * then “Sign in”, which reads “Your gate” when a session cookie exists. At 760 px and below the nav collapses into a
 * 44 px Menu/Close button that opens 48 px rows (Sign in last); Esc closes it.
 * A client island: the shared layout never reads cookies, so pages stay static.
 */

const subscribeNever = () => () => undefined;

function useSignedIn(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => hasSessionCookie(document.cookie),
    () => false,
  );
}

function isCurrent(pathname: string, href: string): boolean {
  // “Ask” is the home composer; /ask (the same composer, session-aware) and the status pages belong to it too.
  if (href === '/') return pathname === '/' || pathname === '/ask' || pathname.startsWith('/ask/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname() || '/';
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [lastPath, setLastPath] = useState(pathname);

  // Close the menu after navigation.
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const signin = signedIn ? { href: '/me', label: 'Your gate' } : { href: '/join', label: 'Sign in' };
  const current = (href: string) => (isCurrent(pathname, href) ? ('page' as const) : undefined);

  return (
    <header className="site-header">
      <div className="site-header__in">
        <Link className="wordmark" href="/">
          {PRODUCT_NAME}
        </Link>
        <nav className="site-nav" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} aria-current={current(item.href)}>
              {item.label}
            </Link>
          ))}
        </nav>
        <Link className="site-header__signin" href={signin.href} aria-current={current(signin.href)}>
          {signin.label}
        </Link>
        <button ref={button} className="site-menu-btn" type="button" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      <nav id="site-menu" className="site-menu" aria-label="Menu" hidden={!open}>
        {[...NAV_ITEMS, signin].map((item) => (
          <Link key={item.href} href={item.href} aria-current={current(item.href)} onClick={() => setOpen(false)}>
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
