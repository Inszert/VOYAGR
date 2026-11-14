// Plain data with no imports, so a client component can read the list without
// pulling the destination catalogue into the browser bundle.

/**
 * "Somewhere in Oceania."
 *
 * The same idea as `anywhere`, narrowed to a continent: the word expands to
 * every destination the catalogue can price and that sits in that part of the
 * world, so it is a promise the search can keep rather than a wildcard. The
 * continent comes from the country data the globe already uses, never from a
 * second list somebody has to keep in step with it.
 */
export const WORLD_REGIONS = [
  { id: 'europe', label: 'Europe', continent: 'Europe' },
  { id: 'asia', label: 'Asia', continent: 'Asia' },
  { id: 'africa', label: 'Africa', continent: 'Africa' },
  { id: 'north-america', label: 'North America', continent: 'North America' },
  { id: 'south-america', label: 'South America', continent: 'South America' },
  { id: 'oceania', label: 'Oceania', continent: 'Oceania' },
] as const;

export type WorldRegionId = (typeof WORLD_REGIONS)[number]['id'];

/** The region a typed word names: "Oceania", "north america", "north-america". */
export function parseWorldRegion(value: string | undefined): (typeof WORLD_REGIONS)[number] | null {
  const key = (value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  return WORLD_REGIONS.find((region) => region.id === key) ?? null;
}
