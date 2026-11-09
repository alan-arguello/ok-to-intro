import type { NextConfig } from 'next';

/**
 * NEXT_DIST_DIR lets the shared dev server (.next-dev) and a production build (.next-build)
 * run side by side without clobbering each other. Vercel builds use the default `.next`.
 */
const noIndexPrivate = [
  { key: 'Cache-Control', value: 'private, no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The shared dev server is audited at http://127.0.0.1:3200 (shoot.mjs); allow HMR from that hostname too.
  allowedDevOrigins: ['127.0.0.1'],
  // No dev badge: it would cover the phone bar in every audit screenshot.
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // Token pages from emails: never cached, never indexed, never leak the token in a Referer.
      { source: '/o/:path*', headers: noIndexPrivate },
      { source: '/c/:path*', headers: noIndexPrivate },
      { source: '/pause/:path*', headers: noIndexPrivate },
      { source: '/me/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/kit', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default nextConfig;
