import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Personal gates: /g/<slug> (public ask form) and /g/<slug>/inbox?k=… (the owner's private inbox). Real data, so
 * never indexed; the inbox is also no-store and no-referrer (next.config.ts headers). Pages render GateChrome.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function GateLayout({ children }: { children: ReactNode }) {
  return children;
}
