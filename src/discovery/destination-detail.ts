import { getLogger } from '@/lib/logger';
import { getProviderRegistry } from '@/providers/registry';
import { cacheKey, getCacheStore, readThrough } from '@/cache';
import { combineProvenance, provenanceForMetadata } from '@/core/trip/provenance';
import { weatherCachePolicy } from '@/core/trip/weather-window';
import type { WeatherProvider } from '@/providers/types';
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
  /** Which of this page's own sections are served by fixtures. */
  readonly demoParts: readonly string[];
  /**
   * Sections with no data source behind them at all, so the page can say the
   * data is not available instead of showing an empty section as if there
   * were nothing to report.
   */
  readonly notAvailable: readonly ('places' | 'transfers')[];
}

export interface DestinationDetailQuery {
  readonly destination: AirportCode;
  readonly currency: string;
  readonly passengers: number;
  /** The dates a search was run for, when the visitor arrived from one. */
  readonly startDate?: IsoDate;
  readonly endDate?: IsoDate;
  readonly maxPlaces?: number;
  /** Injectable clock, so the forecast horizon can be tested. */
  readonly now?: () => Date;
}

/**
 * The outlook for the trip's dates, through the cache.
 *
 * Forecast answers are reused for hours and climate averages for weeks (see
 * `weatherCachePolicy`), so a page view does not become a vendor call. A failed
 * load is thrown out of the loader so it is never cached as an answer.
 */
async function loadOutlook(
  provider: WeatherProvider,
  query: { destination: AirportCode; startDate: IsoDate; endDate: IsoDate },
  now: Date,
): Promise<{ outlook: readonly WeatherOutlook[] | null }> {
  const today = now.toISOString().slice(0, 10) as IsoDate;

  const cached = await readThrough(
    getCacheStore(),
    cacheKey('weather', { ...query, provider: provider.metadata.id }),
    {
      ...weatherCachePolicy(today, query.startDate),
      load: async () => {
        const result = await provider.getOutlook(query);
        if (!isOk(result)) throw result.error;
        return result.value;
      },
    },
  );

  return { outlook: cached.value };
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
      ? loadOutlook(
          registry.weather,
          { destination: query.destination, startDate: query.startDate, endDate: query.endDate },
          (query.now ?? (() => new Date()))(),
        )
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
  if (weather && weather.outlook === null) {
    unavailable.push('weather');
    log.warn({ destination: query.destination }, 'weather provider did not answer');
  }

  return {
    destination: query.destination,
    place,
    places: isOk(places) ? places.value : [],
    transfers: isOk(transfers) ? transfers.value : [],
    weather: weather?.outlook ?? [],
    provenance: combineProvenance([
      provenanceForMetadata(registry.places.metadata),
      provenanceForMetadata(registry.transfers.metadata),
      provenanceForMetadata(registry.weather.metadata),
    ]),
    unavailable,
    demoParts: (
      [
        ['places', registry.places],
        ['transfers', registry.transfers],
        ['weather', registry.weather],
      ] as const
    )
      .filter(([, provider]) => provider.metadata.isMock)
      .map(([name]) => name),
    notAvailable: (
      [
        ['places', registry.places],
        ['transfers', registry.transfers],
      ] as const
    )
      .filter(([, provider]) => provider.metadata.mode === 'absent')
      .map(([name]) => name),
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

/** A place counts as a gem from this rating, out of five. */
export const GEM_MIN_RATING = 4.5;

/** At most this many gems, so the section stays a short list. */
const MAX_GEMS = 6;

/**
 * Hidden gems: well liked, little known.
 *
 * A rule, not a vibe. A place is a gem when it is rated at least
 * `GEM_MIN_RATING` and fewer people have reviewed it than the median for its
 * own kind of place on this page - a quiet café is compared with cafés, not
 * with the most-reviewed beach. Best rated first, then least reviewed. The
 * page states the rule beside the list, so it can be checked.
 */
export function hiddenGems(places: readonly Place[]): Place[] {
  const medianCount = new Map<PlaceCategory, number>();

  for (const category of new Set(places.map((place) => place.category))) {
    // Rated places only: an unrated one says nothing about how well known
    // its kind of place usually is.
    const counts = places
      .filter((place) => place.category === category && place.rating !== null)
      .map((place) => place.ratingCount)
      .sort((a, b) => a - b);
    if (counts.length > 0) medianCount.set(category, counts[Math.floor((counts.length - 1) / 2)]!);
  }

  return places
    .filter(
      (place) =>
        place.rating !== null &&
        place.rating >= GEM_MIN_RATING &&
        place.ratingCount < (medianCount.get(place.category) ?? 0),
    )
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.ratingCount - b.ratingCount)
    .slice(0, MAX_GEMS);
}
