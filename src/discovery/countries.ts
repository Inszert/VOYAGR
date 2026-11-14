import generated from './countries.generated.json';

/**
 * The countries the globe can draw and select.
 *
 * Read from the index `scripts/build-geo.mjs` writes beside the geometry the
 * browser fetches, so the server and the map agree about which countries
 * exist, what they are called and where they are - without the server having
 * to parse a hundred and eighty kilobytes of coastline per request.
 *
 * A country here is a shape with a name. What the product knows about a
 * country - which airports it holds, what a trip there costs - lives with the
 * destinations, and `groupByCountry` in `map-model.ts` joins the two.
 */

export interface Country {
  /** Natural Earth `ADM0_A3`. Stable, unique, always populated. */
  readonly adm0: string;
  /** ISO 3166-1 alpha-2 where one exists, with Natural Earth's fallbacks. */
  readonly iso2: string;
  /** The name to read out. */
  readonly name: string;
  /** The name that fits on a chip. */
  readonly shortName: string;
  readonly continent: string;
  readonly subregion: string;
  /**
   * `[west, south, east, north]`. `east` may exceed 180 for a country that
   * crosses the antimeridian, which keeps the box a box.
   */
  readonly bbox: readonly [number, number, number, number];
}

export const COUNTRIES: readonly Country[] = generated as unknown as Country[];

const BY_ADM0 = new Map(COUNTRIES.map((country) => [country.adm0, country]));

export function findCountry(adm0: string): Country | null {
  return BY_ADM0.get(adm0.toUpperCase()) ?? null;
}

const BY_ISO2 = new Map(COUNTRIES.map((country) => [country.iso2.toUpperCase(), country]));

/** The country an ISO 3166-1 alpha-2 code names, for data that speaks ISO2. */
export function findCountryByIso2(iso2: string): Country | null {
  return BY_ISO2.get(iso2.toUpperCase()) ?? null;
}

/**
 * The country a query string names, or null.
 *
 * Only a key that exists is a selection. Anything else - a typo, a code from a
 * different scheme, a string that is not a code - reads as "the whole world"
 * rather than as an empty country.
 */
export function parseCountry(raw: string | undefined): Country | null {
  if (typeof raw !== 'string' || !/^[A-Za-z]{3}$/.test(raw)) return null;
  return findCountry(raw);
}
