import type { ImageryRef } from './types';

/**
 * Which article illustrates which destination.
 *
 * Hand-written, and that is the point. The alternative - searching an image
 * API for the destination's name - is how "Chania, Crete" becomes a photograph
 * of a different Chania, or how "Split" returns a picture of a banana. A photo
 * attached to the wrong place is the same class of error as a wrong price, and
 * this product does not make that class of error to save typing.
 *
 * Sixteen entries because the catalogue has sixteen destinations. When the
 * `destinations` table of specification section 21 exists, this column lives
 * there and this file goes away; a curated column in a real catalogue is the
 * same idea, stored properly.
 *
 * Titles are the English Wikipedia's own spelling, redirects included - the
 * API resolves those, so "Bali" does not have to be written as its canonical
 * form to work.
 */

const LANG = 'en';

/** Destination airport code to the article that pictures the place. */
const ARTICLES: Readonly<Record<string, string>> = {
  AYT: 'Antalya',
  CHQ: 'Chania',
  LCA: 'Larnaca',
  PMI: 'Palma de Mallorca',
  TBS: 'Tbilisi',
  BUS: 'Batumi',
  SPU: 'Split, Croatia',
  FAO: 'Faro, Portugal',
  LIS: 'Lisbon',
  KEF: 'Reykjavík',
  JFK: 'New York City',
  DXB: 'Dubai',
  BKK: 'Bangkok',
  NRT: 'Tokyo',
  CPT: 'Cape Town',
  // The lead image here is a locator map rather than a photograph. Left as
  // it is: a map of Bali is unambiguously about Bali, and swapping in a photo
  // of Denpasar or Kuta would put a picture of one town under the name of the
  // island it sits on.
  DPS: 'Bali',
};

/** The lookup for a destination, or null when nobody has chosen one. */
export function imageryRefFor(code: string): ImageryRef | null {
  const title = ARTICLES[code.toUpperCase()];
  if (!title) return null;

  return { code: code.toUpperCase(), title, lang: LANG };
}

/** Every destination an image can be found for. */
export function illustratedDestinations(): readonly string[] {
  return Object.keys(ARTICLES);
}
