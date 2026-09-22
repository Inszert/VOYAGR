/**
 * Where the browser asks for a destination's photograph.
 *
 * Its own file, with no imports, because components need this and nothing
 * else from the imagery module. Reaching for it through the provider index
 * would drag the environment, the logger and the limiter into any bundle that
 * renders a card.
 *
 * Always our own origin: the proxy route fetches from the source, so a
 * reader's browser never talks to a third party and `img-src` stays `'self'`.
 */
export function imageryUrlFor(code: string): string {
  return `/api/imagery/${encodeURIComponent(code.toUpperCase())}`;
}
