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

/**
 * Whether the image proxy may fetch this address.
 *
 * The upstream address comes out of a Wikipedia API response, which is data we
 * do not control: a poisoned or compromised response must not be able to point
 * the server at an internal host (`http://169.254.169.254/`, `localhost`) and
 * have the bytes handed back. Only `https` on Wikimedia's own domain is
 * fetched.
 */
export function isWikimediaImageUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;

  return parsed.hostname === 'wikimedia.org' || parsed.hostname.endsWith('.wikimedia.org');
}
