/**
 * Escaping for email HTML.
 *
 * Every string a user, a destination name or a provider can influence goes
 * through `escapeHtml` before it reaches markup. Templates never concatenate a
 * raw value into HTML.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ENTITIES[character]!);
}

/**
 * A URL safe to put in an `href`, or a thrown error.
 *
 * Only absolute http(s) URLs: a `javascript:` or `data:` link in a mail is an
 * injection however well its quotes are escaped. A bad link is a bug in the
 * caller, so this throws rather than rendering a mail with a dead button.
 */
export function assertSafeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Email link is not an absolute URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Email link must be http or https');
  }

  return parsed.toString();
}

/** A header value or subject on one line: a newline in either is header injection. */
export function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}
