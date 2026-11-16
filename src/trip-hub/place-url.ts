/**
 * Where a place's own page may live: Wikipedia in any language, or Wikidata.
 *
 * One definition for both ends of a link's life - `addPlaceToPlan` refuses
 * anything else when it is saved, and the plan renders only what passes here -
 * so a stored URL cannot be one the page would show and the service would not
 * have accepted. The host is matched exactly, not by suffix on a string:
 * `en.wikipedia.org.evil.example` and `u:p@en.wikipedia.org` both fail.
 */
export function isPlaceSourceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    (/^[a-z-]+\.wikipedia\.org$/.test(url.hostname) || url.hostname === 'www.wikidata.org')
  );
}

/** An editorial link, not an affiliate one: no `sponsored`, and nothing is earned from it. */
export const PLACE_LINK_REL = 'noopener noreferrer';
