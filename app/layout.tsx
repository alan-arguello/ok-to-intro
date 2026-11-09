import type { Metadata, Viewport } from 'next';
import { Outfit, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';
import { LiveRegion } from '@/components/site/live-region';
import { PrimaryShortcut } from '@/components/site/primary-shortcut';
import { SiteFooter } from '@/components/site/site-footer';
import { DEFAULT_DESCRIPTION, PRODUCT_NAME, SITE_URL } from '@/lib/site';
import './tokens.css';
import './globals.css';

// Self-hosted by next/font (no request to Google from the browser). Outfit is one variable file; Source Serif 4
// is roman 500 only, without the opsz axis: about 54 KB of fonts in all (tech.md). The variables are the ones
// tokens.css reads.
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin'], weight: '500', style: 'normal', variable: '--font-source-serif', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: DEFAULT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  openGraph: { type: 'website', siteName: PRODUCT_NAME, title: PRODUCT_NAME, description: DEFAULT_DESCRIPTION, url: '/' },
  twitter: { card: 'summary_large_image', title: PRODUCT_NAME, description: DEFAULT_DESCRIPTION },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f5f5ee',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${serif.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
        <SiteFooter />
        <LiveRegion />
        <PrimaryShortcut />
      </body>
    </html>
  );
}
