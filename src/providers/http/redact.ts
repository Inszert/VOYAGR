/**
 * Removing secrets before a fixture is written.
 *
 * A recorded exchange is a committed file. Anything a real request carried -
 * a bearer token, an API key, a signature - would be committed with it, and
 * rotating a leaked credential is a much worse afternoon than writing this.
 *
 * Deliberately an allow-list of what survives rather than a block-list of what
 * goes. A block-list is wrong the first time a vendor invents a header nobody
 * here has heard of, and it is wrong silently.
 */

/** Headers worth keeping, because behaviour depends on them. */
const KEEPABLE_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'content-type',
  'content-length',
  'user-agent',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  /*
   * Travelpayouts hyphenates it differently, and the allow-list hid it.
   *
   * Worth spelling out because this is the allow-list working correctly and
   * still costing an afternoon: a quota header is behaviour, not a secret,
   * but `x-rate-limit` is not `x-ratelimit-limit`, so it was redacted out of
   * the one recording made to discover the rate limit. Add a vendor's
   * spelling here rather than loosening the rule to a pattern.
   */
  'x-rate-limit',
  'x-rate-limit-remaining',
  'x-rate-limit-reset',
  'link',
  'etag',
  'cache-control',
  'date',
]);

export const REDACTED = '[redacted]';

/** Query parameters that carry credentials in some vendors' APIs. */
const SECRET_QUERY_KEYS = /^(api[-_]?key|key|token|signature|apikey|access[-_]?token|sig)$/i;

export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const kept: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    // Everything not explicitly keepable is redacted rather than dropped, so a
    // reader of the fixture can still see that the header was present.
    kept[lower] = KEEPABLE_HEADERS.has(lower) ? value : REDACTED;
  }

  return kept;
}

/**
 * Strip credentials from a URL's query string.
 *
 * The key stays and the value goes, because which parameters were sent is part
 * of what the fixture is evidence of.
 */
export function redactUrl(url: string): string {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (SECRET_QUERY_KEYS.test(key)) parsed.searchParams.set(key, REDACTED);
  }

  // Credentials embedded in the authority are removed outright: there is no
  // version of them that is safe to keep.
  parsed.username = '';
  parsed.password = '';

  return parsed.toString();
}

/**
 * Redact obvious secrets from a body.
 *
 * Best effort, and the fixture is reviewed before it is committed. A body is
 * vendor-shaped, so nothing here can be exhaustive - which is exactly why the
 * recorder prints a reminder to read the file before adding it.
 */
export function redactBody(body: string | null): string | null {
  if (!body) return body;

  return body.replace(
    /("(?:access_token|refresh_token|api_key|apiKey|password|signature|token)"\s*:\s*)"[^"]*"/gi,
    `$1"${REDACTED}"`,
  );
}
