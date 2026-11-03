import { NextResponse, type NextRequest } from 'next/server';

/**
 * A fresh CSP nonce, every request.
 *
 * `next.config.ts` sets every other security header as a static value - this
 * is the one exception, and it needs middleware specifically because a nonce
 * generated once at build time would be the same nonce for every visitor
 * forever, which defeats the point: an attacker who ever saw it could reuse
 * it indefinitely. A nonce is only as good as "nobody outside this exact
 * response has seen it".
 *
 * **Scripts only, not styles.** This app injects nothing of its own inline -
 * no `<script>`, no `dangerouslySetInnerHTML` - so Next's own hydration
 * scripts are the entire inline-script surface, and the nonce covers them
 * without touching a single component. Styles are different: several
 * components set CSS custom properties via a `style={{ '--x': ... }}` prop
 * (`src/app/explore/page.tsx`, the discovery/stage components, the globe),
 * and a style *attribute* is not the same thing as a `<style>` *element* -
 * browsers gate it behind `style-src-attr`, which neither this nonce nor
 * Next's own propagation covers today. Tightening that would mean rewriting
 * every one of those components to move the value into a nonced `<style>`
 * block instead, which is real work with its own risk and belongs to its own
 * change. `style-src` keeps `'unsafe-inline'`; `script-src` does not.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: http://localhost:*' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');

  // Carried on the request so a server component can read it back with
  // `headers()` if it ever needs to nonce something itself; carried on the
  // response because that is what the browser actually enforces against.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    /*
     * Every page and every action, skipping the requests that are never
     * HTML and never run a script: static assets, images, the geo/maplibre
     * files already served with their own long-lived cache headers, and the
     * service worker. Running the nonce dance for a JSON file nobody
     * executes is pure overhead.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|robots.txt|sitemap.xml|geo/|maplibre/|api/imagery/).*)',
  ],
};
