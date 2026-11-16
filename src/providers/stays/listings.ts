import { areaAround, type StayArea } from '@/core/stay/listing';
import { getLogger } from '@/lib/logger';
import { stayListingSchema, validateOffers, type ValidatedStayListing } from '../schema';
import dataset from './hotels.v1.generated.json';
import { OSM_LISTINGS_ID } from './osm-extract';

/**
 * The places to stay in one city, from a build-time OpenStreetMap extract.
 *
 * `docs/provider-policy.md` rejects calling the public Overpass endpoint from
 * the production backend, so nothing here touches the network: the hotels
 * come from `hotels.v1.generated.json`, written by `scripts/build-hotels.mjs`
 * and never hand-edited. A city the extract does not cover is `absent`, and
 * the page shows the partner card with no pins - it never asks for one.
 *
 * The file is still provider input: every row is put through
 * `stayListingSchema` before the page can see it, and a malformed row is
 * dropped and logged rather than shown.
 */

const log = getLogger('providers.stays.listings');

/** How far round the centre the extract looked; kept in step with the script. */
export const LISTING_RADIUS_KM = 6;

/** Where the list came from, for the credit line beside it. */
export const HOTELS_CREDIT = {
  attribution: dataset.attribution,
  licence: dataset.licence,
  retrievedAt: dataset.retrievedAt,
  copyrightUrl: 'https://www.openstreetmap.org/copyright',
} as const;

type Row = readonly [
  id: string,
  name: string,
  kind: string,
  lat: number,
  lon: number,
  stars: number | null,
  address: string | null,
  website: string | null,
];

interface CityEntry {
  readonly city: string;
  readonly country: string | null;
  readonly centre: readonly [number, number];
  readonly hotels: readonly Row[];
}

const CITIES = dataset.cities as unknown as Readonly<Record<string, CityEntry>>;
const parsed = new Map<string, readonly ValidatedStayListing[]>();

function listingsOf(code: string, entry: CityEntry): readonly ValidatedStayListing[] {
  const known = parsed.get(code);
  if (known) return known;

  const { accepted, rejected } = validateOffers(
    stayListingSchema,
    entry.hotels.map(([id, name, kind, latitude, longitude, stars, address, website]) => ({
      id,
      providerId: OSM_LISTINGS_ID,
      name,
      kind,
      latitude,
      longitude,
      stars,
      address,
      website,
    })),
  );
  if (rejected.length > 0) {
    log.warn({ code, rejected: rejected.length }, 'extracted hotel rows failed validation');
  }

  parsed.set(code, accepted);
  return accepted;
}

export type ListingsOutcome =
  | { readonly status: 'absent' }
  | {
      readonly status: 'ok';
      readonly listings: readonly ValidatedStayListing[];
      readonly area: StayArea;
    };

/** The extract's hotels for a city, by the code the place resolved to. */
export function loadStayListings(request: {
  readonly code: string | null;
  readonly centre: { readonly latitude: number; readonly longitude: number };
}): ListingsOutcome {
  const entry = request.code ? CITIES[request.code] : undefined;
  if (!request.code || !entry) return { status: 'absent' };

  return {
    status: 'ok',
    listings: listingsOf(request.code, entry),
    area: areaAround(request.centre, LISTING_RADIUS_KM),
  };
}

/** Which cities the extract covers, for tests and the credits. */
export function coveredCities(): readonly string[] {
  return Object.keys(CITIES);
}
