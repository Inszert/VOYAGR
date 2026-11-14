import { findCountry } from '@/discovery/countries';
import { parseWorldRegion } from '@/search/world-region-list';
import { listPlaceableDestinations, resolveDestinationGeo } from '@/search/destination-names';

/**
 * Every priceable destination in the region, or null when the word is not one.
 *
 * An empty list is a real answer - a region the catalogue has nothing in -
 * and is returned as such rather than quietly widened to everywhere.
 */
export function resolveWorldRegion(value: string | undefined): string[] | null {
  const region = parseWorldRegion(value);
  if (!region) return null;

  return listPlaceableDestinations().filter((code) => {
    const adm0 = resolveDestinationGeo(code)?.adm0;
    return adm0 ? findCountry(adm0)?.continent === region.continent : false;
  });
}
