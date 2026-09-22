import type { NextConfig } from 'next';

/**
 * Security response headers applied to every route.
 *
 * The CSP is intentionally strict. `'unsafe-inline'` for styles is required by
 * Next.js' streaming style injection; scripts use `'unsafe-eval'` only in
 * development (React Refresh). Tighten further with a nonce-based CSP when the
 * app gains third-party embeds.
 */
const isDev = process.env.NODE_ENV === 'development';

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // Provider APIs are called server-side only; the browser talks to our origin.
  `connect-src 'self'${isDev ? ' ws: http://localhost:*' : ''}`,
  /*
   * Still `'self'`, and the discovery globe is why that is worth a note.
   *
   * MapLibre renders vector data on a worker, and the usual advice is to allow
   * `blob:` here for it. That is not needed: `scripts/copy-map-worker.mjs`
   * puts MapLibre's worker under `/maplibre/` and the globe points at it, so
   * the worker is same-origin like everything else. A CSP entry avoided is a
   * CSP entry that cannot be leaned on later for something else.
   */
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
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
