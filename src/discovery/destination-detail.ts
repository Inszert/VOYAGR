import { getLogger } from '@/lib/logger';
import { getProviderRegistry } from '@/providers/registry';
import { combineProvenance, provenanceForProvider } from '@/core/trip/provenance';
import { isOk } from '@/lib/result';
import { resolveDestinationGeo } from '@/search/destination-names';
import type { DataProvenance } from '@/core/trip/provenance';
import type { AirportCode, IsoDate, TransferOffer, WeatherOutlook } from '@/core/trip/types';
import type { DestinationGeo } from './map-model';
import type { Place, PlaceCategory } from '@/providers/types';

/**
 * Everything the product actually knows about one place (1.10.1 section 18).
 *
 * Section 18 asks for an immersive destination experience and lists a great
 * deal in it: imagery, events, national holidays, travel warnings, hidden
 * places, recommended trip lengths. Most of that has no data source, and the
 * ones that do are sections 20 to 22 - Phase 2 and 3.
 *
 * So this gathers only what a real adapter returns, and the page says plainly
 * what is missing. "Feels like discovering a place rather than viewing a
 * database record" is a bar about presentation; inventing the record to clear
 * it would be the wrong way round.
 *
 * Every provider is asked independently and a failure degrades the page rather
 * than emptying it, which is the same rule the search follows: one source
 * being down must not look like a place having no restaurants.
 */

const log = getLogger('discovery.destination');

/** The categories worth their own heading, in the order they are shown. */
export const PLACE_SECTIONS: readonly { category: PlaceCategory; heading: string }[] = [
  { category: 'beach', heading: 'Beaches' },
  { category: 'attraction', heading: 'Worth seeing' },
  { category: 'restaurant', heading: 'Eating' },
  { category: 'cafe', heading: 'Coffee' },
  { category: 'activity', heading: 'Things to do' },
  { category: 'nightlife', heading: 'After dark' },
];

export interface DestinationDetail {
  readonly destination: AirportCode;
  readonly place: DestinationGeo;
  readonly places: readonly Place[];
  readonly transfers: readonly TransferOffer[];
  /** Only populated when dates were supplied; otherwise empty. */
  readonly weather: readonly WeatherOutlook[];
  /** Where all of this came from. The weakest claim wins, as everywhere. */
  readonly provenance: DataProvenance;
  /** Sources that did not answer, so the page can say it is incomplete. */
  readonly unavailable: readonly string[];
}

export interface DestinationDetailQuery {
  readonly destination: AirportCode;
  readonly currency: string;
  readonly passengers: number;
  /** The dates a search was run for, when the visitor arrived from one. */
  readonly startDate?: IsoDate;
  readonly endDate?: IsoDate;
  readonly maxPlaces?: number;
}

export async function loadDestinationDetail(
  query: DestinationDetailQuery,
): Promise<DestinationDetail | null> {
  const place = resolveDestinationGeo(query.destination);
  // Not "a place we know nothing about" - a code that is not a destination.
  // The page 404s rather than rendering an empty shell with a name in it.
  if (!place) return null;

  const registry = getProviderRegistry();
  const unavailable: string[] = [];

  const [places, transfers, weather] = await Promise.all([
    registry.places.searchPlaces({
      destination: query.destination,
      categories: PLACE_SECTIONS.map((section) => section.category),
      maxResults: query.maxPlaces ?? 24,
    }),
    registry.transfers.searchTransfers({
      airport: query.destination,
      destinationName: place.name,
      passengers: query.passengers,
      currency: query.currency,
    }),
    query.startDate && query.endDate
      ? registry.weather.getOutlook({
          destination: query.destination,
          startDate: query.startDate,
          endDate: query.endDate,
        })
      : Promise.resolve(null),
  ]);

  if (!isOk(places)) {
    unavailable.push('places');
    log.warn({ destination: query.destination }, 'places provider did not answer');
  }
  if (!isOk(transfers)) {
    unavailable.push('transfers');
    log.warn({ destination: query.destination }, 'transfer provider did not answer');
  }
  if (weather && !isOk(weather)) {
    unavailable.push('weather');
    log.warn({ destination: query.destination }, 'weather provider did not answer');
  }

  return {
    destination: query.destination,
    place,
    places: isOk(places) ? places.value : [],
    transfers: isOk(transfers) ? transfers.value : [],
    weather: weather && isOk(weather) ? weather.value : [],
    provenance: combineProvenance([
      provenanceForProvider(registry.places.metadata.isMock),
      provenanceForProvider(registry.transfers.metadata.isMock),
      provenanceForProvider(registry.weather.metadata.isMock),
    ]),
    unavailable,
  };
}

/** Group the places into the sections that have anything in them. */
export function groupPlaces(
  places: readonly Place[],
): readonly { heading: string; category: PlaceCategory; places: readonly Place[] }[] {
  return PLACE_SECTIONS.map((section) => ({
    ...section,
    places: places.filter((place) => place.category === section.category),
  })).filter((section) => section.places.length > 0);
}
