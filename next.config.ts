import type { NextConfig } from 'next';

/**
 * Security response headers applied to every route.
 *
 * `Content-Security-Policy` is deliberately **not** here any more. It moved
 * to `src/middleware.ts`, because a nonce-based `script-src` needs a fresh
 * value generated per request, and this static `headers()` list can only
 * ever hand back the same string for everyone - which is a nonce in name
 * only. See that file for what the policy actually says and why `style-src`
 * still carries `'unsafe-inline'` while `script-src` no longer does.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  /*
   * Lets two builds exist side by side (`NEXT_DIST_DIR=.next-a npm run build`),
   * so parallel visual-QA runs do not overwrite each other. Unset everywhere
   * that matters: CI and production build into `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,

  // Keep native/driver packages out of the client and edge bundles.
  serverExternalPackages: ['pg', 'bullmq', 'ioredis', 'pino', 'web-push'],

  typedRoutes: true,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        /*
         * The globe's geography, cached for a year.
         *
         * Every one of these filenames carries the version the build wrote it
         * at - `countries-110m.v1.json` - so a change to the data is a change
         * to the URL and there is nothing to revalidate. Without this the
         * browser asks again for half a megabyte of coastline on every
         * navigation, which is a request per page for a file that cannot have
         * changed.
         */
        source: '/geo/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // The service worker must never be cached aggressively, or clients get
        // stuck on a stale shell.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
