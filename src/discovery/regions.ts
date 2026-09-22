import generated from './regions.generated.json';

/**
 * The states and provinces the globe can draw inside a country.
 *
 * Only the count lives on the server. The geometry is a file per country,
 * fetched by the browser when that country is opened, because four megabytes
 * of admin-1 boundaries is not something to send to somebody looking at a
 * globe of the whole world.
 *
 * **Geometry is all it is.** Natural Earth gives a region a name and an ISO
 * 3166-2 code; the product knows nothing else about one. There is no regional
 * price, no regional weather and no regional place catalogue, so the layer
 * draws outlines and the interface says that is what they are. Filling them
 * with colour would be a claim about places we have not priced.
 */

/** How many regions each country has, keyed by Natural Earth `ADM0_A3`. */
export const REGION_COUNTS: Readonly<Record<string, number>> = generated;

/** The version in every region filename, so a rebuild cannot be served stale. */
export const REGIONS_VERSION = 2;

export function regionCount(adm0: string): number {
  return REGION_COUNTS[adm0.toUpperCase()] ?? 0;
}

export function hasRegions(adm0: string): boolean {
  return regionCount(adm0) > 0;
}

/** Where the browser fetches one country's regions from. Same origin, versioned. */
export function regionsUrl(adm0: string): string {
  return `/geo/regions/${adm0.toUpperCase()}.v${REGIONS_VERSION}.json`;
}

/**
 * What a region layer is called in words, singular or plural.
 *
 * Natural Earth's admin-1 units are not all called the same thing - states,
 * provinces, regions, counties, autonomous communities - and it has a `type`
 * per feature. Rather than pick one country's word for all of them, the
 * interface says "regions", which is what the dataset is, and the individual
 * names carry the rest.
 */
export function describeRegions(adm0: string): string | null {
  const count = regionCount(adm0);
  if (count === 0) return null;

  return `${count} ${count === 1 ? 'region' : 'regions'}`;
}
