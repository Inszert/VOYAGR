import { cacheKey, readThrough, type CacheStore } from '@/cache';
import type { OneWayFare } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import type { FlightProvider, OneWayQuery, ProviderResult } from '@/providers/types';
import { DAY_PRICES_FRESH_MS, DAY_PRICES_STALE_MS } from './day-prices';

/**
 * One route, one direction, one month of single flights, through the cache.
 *
 * Kind `flex`, like the calendar's day prices, with the same 60-minute fresh
 * and 24-hour stale window: it is the same cached vendor data at the same
 * rate of change. The key carries the route, the direction (origin and
 * destination in order), the month, the currency and the party, because
 * every price stored is the party's total.
 *
 * `call` is how the provider is reached: the search passes its own
 * `callProvider`, so the call takes a slot in the provider's limiter, counts
 * against `maxProviderCalls`, and a failure is reported as an issue rather
 * than thrown. A failed load is never stored as an answer.
 */

export interface OneWayLoadDeps {
  readonly flights: FlightProvider;
  readonly store: CacheStore;
  readonly call: (
    run: () => Promise<ProviderResult<readonly OneWayFare[]>>,
  ) => Promise<readonly OneWayFare[] | null>;
  readonly now?: () => number;
}

export async function loadOneWayMonth(
  query: OneWayQuery,
  deps: OneWayLoadDeps,
): Promise<readonly OneWayFare[]> {
  const search = deps.flights.searchOneWay?.bind(deps.flights);
  if (!search) return [];

  const read = await readThrough<readonly OneWayFare[]>(
    deps.store,
    cacheKey('flex', {
      shape: 'one-way',
      provider: deps.flights.metadata.id,
      origin: query.origin,
      destination: query.destination,
      month: query.month,
      currency: query.currency,
      passengers: query.passengers,
    }),
    {
      freshMs: DAY_PRICES_FRESH_MS,
      staleMs: DAY_PRICES_STALE_MS,
      ...(deps.now ? { now: deps.now } : {}),
      load: async () => {
        const fares = await deps.call(() => search(query));
        // Thrown so nothing is cached; the caller already has the issue.
        if (fares === null) throw new AppError('PROVIDER_ERROR', 'one-way fares not loaded');
        return fares;
      },
    },
  );

  return read.value ?? [];
}
