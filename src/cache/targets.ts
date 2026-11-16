import type { IsoDate } from '@/core/trip/types';
import { DISCOVERY_LIMITS, type DiscoveryInput } from '@/discovery/snapshot';
import { listPlaceableDestinations } from '@/search/destination-names';

/**
 * What the worker keeps warm.
 *
 * The list is code, not configuration: a target is a product decision ("these
 * are the questions the front pages ask") and each one spends provider quota,
 * so adding one is a reviewed change with the quota arithmetic next to it. The
 * arithmetic is in `docs/architecture.md`, "Caching and refresh".
 *
 * A target is the *input* to a discovery snapshot, not a stored query, so the
 * dates roll forward with `today` and the key the worker writes is the key the
 * page reads - both come from `discoveryCacheKey`.
 */

export type CacheTargetKind = 'recommended' | 'origin' | 'collection';

export interface CacheTarget {
  readonly id: string;
  readonly kind: CacheTargetKind;
  /** The snapshot input for a day. */
  input(today: IsoDate): DiscoveryInput;
  /**
   * The most provider calls one refresh may make.
   *
   * A ceiling, not a forecast: it is the `maxProviderCalls` the search runs
   * under, or the number of calls a smaller search can possibly make. Real use
   * is lower. It is what quota planning has to assume.
   */
  readonly callCeiling: number;
}

/**
 * The origins "cheap flights from X" is kept warm for.
 *
 * The busiest departure airports the catalogue serves; a visitor whose saved
 * origin is one of these gets a page that was priced before they arrived.
 */
export const POPULAR_ORIGINS = ['LHR', 'JFK', 'CDG', 'AMS', 'FRA'] as const;

/**
 * Themed collections, as airport codes.
 *
 * Narrowed to the places the catalogue can actually put on the globe when a
 * target is built: a code it does not know is dropped, never invented a place
 * for.
 */
export const COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  'beach-escapes': ['AYT', 'PMI', 'FAO', 'HER', 'SPU', 'DBV', 'IBZ', 'NCE', 'CTA', 'MLA'],
  'city-breaks': ['LIS', 'BCN', 'PRG', 'BUD', 'ROM', 'VIE', 'CPH', 'KRK', 'ATH', 'AMS'],
  'winter-sun': ['TFS', 'LPA', 'ACE', 'FUE', 'SSH', 'HRG', 'DXB', 'AGA'],
};

/** Per destination: flights over each date window, a hotel, a weather and a transfer call. */
const CALLS_PER_DESTINATION = DISCOVERY_LIMITS.maxDateWindows + 3;

export function buildCacheTargets(): readonly CacheTarget[] {
  const placeable = new Set(listPlaceableDestinations());

  const collections: CacheTarget[] = Object.entries(COLLECTIONS).flatMap(([name, codes]) => {
    const destinations = codes.filter((code) => placeable.has(code));
    if (destinations.length === 0) return [];

    return {
      id: `collection:${name}`,
      kind: 'collection' as const,
      input: (today: IsoDate) => ({ today, destinations }),
      callCeiling: Math.min(
        DISCOVERY_LIMITS.maxProviderCalls,
        destinations.length * CALLS_PER_DESTINATION * DISCOVERY_LIMITS.maxOrigins,
      ),
    };
  });

  return [
    {
      // What the globe and the recommended trip show an anonymous visitor.
      id: 'recommended',
      kind: 'recommended',
      input: (today) => ({ today }),
      callCeiling: DISCOVERY_LIMITS.maxProviderCalls,
    },
    ...POPULAR_ORIGINS.map((origin): CacheTarget => ({
      id: `origin:${origin}`,
      kind: 'origin',
      input: (today) => ({ today, defaults: { origins: origin } }),
      callCeiling: DISCOVERY_LIMITS.maxProviderCalls,
    })),
    ...collections,
  ];
}

/** The most destinations one places round enqueues, so one round is a bounded number of queries. */
export const PLACES_DESTINATIONS_PER_ROUND = 40;

/** Target ids for a places lookup read `places:<airport code>`. */
export const PLACES_TARGET_PREFIX = 'places:';

/**
 * The destinations whose things to do are kept warm, most visited first.
 *
 * The themed collections come first - they are what the front pages link to -
 * then the rest of the catalogue in its own order. The same places the price
 * targets above are about, so the list cannot drift from them.
 */
export function placesTargetDestinations(): string[] {
  const placeable = listPlaceableDestinations();
  const known = new Set(placeable);
  const featured = Object.values(COLLECTIONS)
    .flat()
    .filter((code) => known.has(code));

  return [...new Set([...featured, ...placeable])];
}

export function placesTargetId(destination: string): string {
  return `${PLACES_TARGET_PREFIX}${destination}`;
}

/** The destination a `places:` target names, or null when the id is not one. */
export function parsePlacesTargetId(id: string): string | null {
  if (!id.startsWith(PLACES_TARGET_PREFIX)) return null;

  const code = id.slice(PLACES_TARGET_PREFIX.length);
  return placesTargetDestinations().includes(code) ? code : null;
}

export function findCacheTarget(id: string): CacheTarget | undefined {
  return buildCacheTargets().find((target) => target.id === id);
}

/**
 * The provider calls per hour the refresh may spend at a given interval.
 *
 * `targets x 60 / PRICE_REFRESH_MINUTES`, each target at its ceiling. Compared
 * against the vendor's `rateLimitPerMinute x 60` in the docs and in a test.
 */
export function refreshCallCeilingPerHour(
  targets: readonly CacheTarget[],
  intervalMinutes: number,
): number {
  const perRound = targets.reduce((sum, target) => sum + target.callCeiling, 0);

  return Math.ceil((perRound * 60) / intervalMinutes);
}
