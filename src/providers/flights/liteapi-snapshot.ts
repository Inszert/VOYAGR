import { cacheKey, getCacheStore, type CacheStore } from '@/cache';
import { daysBetween } from '@/core/dates';
import { pairOneWayFares } from '@/core/trip/one-way-pair';
import type { FlightOffer, IsoDate, OneWayFare } from '@/core/trip/types';
import { liteApiEnvironment, type Env } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { ok } from '@/lib/result';
import {
  readFlightSnapshot,
  type FlightSnapshotReadDependencies,
} from '@/liteapi-snapshot/flights-read';
import { FLIGHT_CABIN } from '@/liteapi-snapshot/flights-targets';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderHealth,
  ProviderPage,
  ProviderResult,
} from '../types';

/**
 * LiteAPI flights, read from our own snapshot.
 *
 * This is what the registry builds for `FLIGHT_PROVIDER=liteapi`. It makes **no vendor call,
 * ever**: a visitor's search reads the rows the worker's scheduled refresh wrote
 * (`src/liteapi-snapshot/flights-job.ts`). It does not import the live client in
 * `./liteapi.ts`, and `src/liteapi-snapshot/import-guard.test.ts` holds that.
 *
 * Per route and pair of days:
 *
 * 1. A stored row inside its expiry answers, offer by offer, until each offer's own `expiresAt`.
 * 2. Otherwise (Q9: errors AND empty answers) the Aviasales fares already in the shared cache are
 *    read: `store.get(key)` and nothing more. Never `loadAndStore`, never `readThrough`, never a
 *    live call. The cache holds one-way months, so a return trip is the cheapest single out on
 *    the departure day plus the cheapest single back on the return day, marked
 *    `two_one_way` as `pairOneWayFares` always marks it.
 * 3. Otherwise the route has no price, which is an empty answer: the page says so, and shows
 *    the "not loaded" line (`flightSnapshotStatus`) rather than a number.
 */

const log = getLogger('providers.flights.liteapi-snapshot');

export const SNAPSHOT_FLIGHTS_PROVIDER_ID = 'liteapi';

/** The provider id the cached one-way months were written under. */
const AVIASALES_PROVIDER_ID = 'aviasales';

/** The most offers one search returns when the caller names no limit. */
const DEFAULT_MAX_RESULTS = 50;

type Route = Pick<FlightSearchQuery, 'departureDate' | 'returnDate' | 'passengers' | 'currency'> & {
  readonly origin: string;
  readonly destination: string;
};

/** The cached Aviasales answer for one route and pair of days; empty when there is none. */
export type AviasalesCacheReader = (route: Route) => Promise<readonly FlightOffer[]>;

export interface SnapshotFlightProviderOptions {
  /** Defaults to the real repositories and env, resolved on each search. */
  readonly dependencies?: () => FlightSnapshotReadDependencies;
  readonly now?: () => number;
  /** Defaults to reading the shared cache store. */
  readonly fallback?: AviasalesCacheReader;
}

/**
 * The key `loadOneWayMonth` (`src/search/one-way.ts`) stores a month of single fares under, for
 * the Aviasales provider. A test compares it with the real writer's key, so the two cannot drift.
 */
export function aviasalesOneWayKey(
  origin: string,
  destination: string,
  month: string,
  currency: string,
  passengers: number,
): string {
  return cacheKey('flex', {
    shape: 'one-way',
    provider: AVIASALES_PROVIDER_ID,
    origin,
    destination,
    month,
    currency,
    passengers,
  });
}

/** A cached value is our own write, but it is read as input: only usable fares pass. */
function usableFares(value: unknown): OneWayFare[] {
  if (!Array.isArray(value)) return [];
  return value.filter((fare): fare is OneWayFare => {
    if (typeof fare !== 'object' || fare === null) return false;
    const candidate = fare as Partial<OneWayFare>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.providerId === 'string' &&
      typeof candidate.observedAt === 'string' &&
      Array.isArray(candidate.leg?.segments) &&
      candidate.leg.segments.length > 0 &&
      Number.isSafeInteger(candidate.price?.amount) &&
      typeof candidate.price?.currency === 'string'
    );
  });
}

/** The fallback: the cached Aviasales one-way months, read with `get` only. */
export function createAviasalesCacheReader(
  store: () => Pick<CacheStore, 'get'> = getCacheStore,
): AviasalesCacheReader {
  return async (route) => {
    const nights = daysBetween(route.departureDate, route.returnDate);
    if (nights < 1) return [];

    const read = async (origin: string, destination: string, day: IsoDate) => {
      const entry = await store().get<unknown>(
        aviasalesOneWayKey(
          origin,
          destination,
          day.slice(0, 7),
          route.currency.toUpperCase(),
          route.passengers,
        ),
      );
      return usableFares(entry?.value);
    };

    const [outbound, inbound] = await Promise.all([
      read(route.origin, route.destination, route.departureDate),
      read(route.destination, route.origin, route.returnDate),
    ]);

    return pairOneWayFares(outbound, inbound, {
      minNights: nights,
      maxNights: nights,
      earliestDeparture: route.departureDate,
      latestReturn: route.returnDate,
    });
  };
}

/** Null without a key, as the live adapter was: the provider is then absent. */
export function createSnapshotFlightProvider(
  env: Pick<Env, 'LITEAPI_API_KEY'>,
  options: SnapshotFlightProviderOptions = {},
): SnapshotFlightProvider | null {
  if (!env.LITEAPI_API_KEY) return null;
  const mode = liteApiEnvironment(env);
  log.info({ mode }, 'liteapi snapshot flight provider enabled');
  return new SnapshotFlightProvider(mode === 'sandbox' ? 'test' : 'live', options);
}

export class SnapshotFlightProvider implements FlightProvider {
  readonly metadata: FlightProvider['metadata'];
  private readonly now: () => number;
  private readonly fallback: AviasalesCacheReader;

  constructor(
    mode: 'test' | 'live',
    private readonly options: SnapshotFlightProviderOptions = {},
  ) {
    this.metadata = {
      id: SNAPSHOT_FLIGHTS_PROVIDER_ID,
      kind: 'flights',
      displayName: 'LiteAPI',
      isMock: false,
      mode,
      rateLimitPerMinute: null,
    };
    this.now = options.now ?? Date.now;
    this.fallback = options.fallback ?? createAviasalesCacheReader();
  }

  async searchFlights(
    query: FlightSearchQuery,
  ): Promise<ProviderResult<ProviderPage<FlightOffer>>> {
    const now = this.now();
    const routes = query.origins.flatMap((origin) =>
      query.destinations
        .filter((destination) => destination !== origin)
        .map((destination) => ({ origin, destination })),
    );

    const perRoute = await Promise.all(
      routes.map(async (route) => {
        const read = await readFlightSnapshot(
          {
            origin: route.origin,
            destination: route.destination,
            departureDate: query.departureDate,
            returnDate: query.returnDate,
            adults: query.passengers,
            currency: query.currency,
            cabin: FLIGHT_CABIN,
          },
          now,
          this.options.dependencies?.(),
        );
        if (read.offers.length > 0) return read.offers;

        try {
          return await this.fallback({
            ...route,
            departureDate: query.departureDate,
            returnDate: query.returnDate,
            passengers: query.passengers,
            currency: query.currency,
          });
        } catch (error) {
          // A broken cache is a miss: the route is unpriced, and the search carries on.
          log.warn(
            { code: error instanceof Error ? error.name : 'unknown' },
            'aviasales cache fallback failed',
          );
          return [];
        }
      }),
    );

    const items = perRoute
      .flat()
      .filter((offer) => offer.price.currency.toUpperCase() === query.currency.toUpperCase())
      .sort((a, b) => a.price.amount - b.price.amount)
      .slice(0, query.maxResults ?? DEFAULT_MAX_RESULTS);

    return ok({ items, nextCursor: null });
  }

  async checkHealth(): Promise<ProviderHealth> {
    // Reads our own tables; it makes no call that could be unhealthy at the vendor.
    return { status: 'healthy', checkedAt: new Date(this.now()).toISOString(), latencyMs: null };
  }
}
