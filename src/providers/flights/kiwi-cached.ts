import { getCacheStore, type CacheStore } from '@/cache';
import { getRepositories, type KiwiOffersRepository } from '@/db';
import { connectionCount } from '@/core/trip/legs';
import type { FlightOffer } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderHealth,
  ProviderPage,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';
import { KiwiMcpFlightProvider, type KiwiMcpOptions } from './kiwi-mcp';
import { KiwiReadPath, type KiwiFreshObservation, type KiwiLookupResult } from './kiwi-read-path';

/**
 * The flight provider the app actually uses: the Kiwi adapter behind the 12-hour read path.
 *
 * It has the `FlightProvider` shape, so the search orchestrator is handed it exactly as it was
 * handed the raw adapter. Each origin x destination pair is one read-path lookup, so a fresh
 * cache means zero MCP calls, and a failed call serves stored offers rather than an empty page.
 *
 * A stale answer keeps its original `observedAt` (the freshness engine reads that) and is also
 * stamped on the offer's `source`: "Kiwi.com, checked 14 h ago".
 *
 * There is no `searchOneWay` and no month sources: those would be calls outside the cache. The
 * orchestrator treats their absence as "this vendor does not offer them".
 */

export interface KiwiCachedDeps {
  readonly provider?: KiwiMcpFlightProvider;
  readonly cache?: CacheStore;
  readonly repository?: KiwiOffersRepository;
  readonly now?: () => number;
  /** Fired after each real MCP answer; the price-drop observer plugs in here. */
  readonly onFreshObservation?: (observation: KiwiFreshObservation) => Promise<void>;
}

export class KiwiCachedFlightProvider implements FlightProvider {
  readonly metadata;
  private path: KiwiReadPath | null = null;

  constructor(
    private readonly adapter: KiwiMcpFlightProvider,
    private readonly deps: KiwiCachedDeps = {},
  ) {
    this.metadata = adapter.metadata;
  }

  /** Built on first use, so constructing the registry opens no database or Redis connection. */
  private readPath(): KiwiReadPath {
    this.path ??= new KiwiReadPath({
      provider: this.adapter,
      cache: this.deps.cache ?? getCacheStore(),
      repository: this.deps.repository ?? getRepositories().kiwiOffers,
      ...(this.deps.now ? { now: this.deps.now } : {}),
      ...(this.deps.onFreshObservation ? { onFreshObservation: this.deps.onFreshObservation } : {}),
    });
    return this.path;
  }

  checkHealth(options?: ProviderRequestOptions): Promise<ProviderHealth> {
    return this.adapter.checkHealth(options);
  }

  async searchFlights(
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ProviderPage<FlightOffer>>> {
    if (query.origins.length === 0 || query.destinations.length === 0) {
      return err(
        new AppError('VALIDATION_ERROR', 'A flight search needs an origin and a destination.'),
      );
    }
    if (options?.signal?.aborted) {
      return err(new AppError('PROVIDER_TIMEOUT', 'The flight search was cancelled.'));
    }

    const path = this.readPath();
    const pairs = query.origins.flatMap((origin) =>
      query.destinations.map((destination) => ({ origin, destination })),
    );
    const results: KiwiLookupResult[] = await Promise.all(
      pairs.map((pair) =>
        path.lookup({
          ...pair,
          departureDate: query.departureDate,
          returnDate: query.returnDate,
          adults: query.passengers,
          currency: query.currency,
        }),
      ),
    );

    const offers: FlightOffer[] = [];
    let firstError: AppError | null = null;
    for (const result of results) {
      firstError ??= result.error;
      if (result.status === 'no_data') continue;
      const label = result.status === 'stale' ? `, ${result.label}` : '';
      for (const offer of result.offers) {
        offers.push(
          label
            ? {
                ...offer,
                source: {
                  displayName: `${this.metadata.displayName}${label}`,
                  mode: offer.source?.mode ?? this.metadata.mode,
                },
              }
            : offer,
        );
      }
    }

    // Nothing stored and the call failed: that is a failure, not an empty answer.
    if (results.every((result) => result.status === 'no_data') && firstError) {
      return err(firstError);
    }

    const wanted = query.directOnly
      ? offers.filter(
          (offer) => connectionCount(offer.outbound) === 0 && connectionCount(offer.inbound) === 0,
        )
      : offers;
    wanted.sort((a, b) => a.price.amount - b.price.amount);
    return ok({ items: wanted.slice(0, query.maxResults ?? wanted.length), nextCursor: null });
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }
}

export function createKiwiCachedFlightProvider(
  options: KiwiMcpOptions = {},
  deps: KiwiCachedDeps = {},
): KiwiCachedFlightProvider {
  return new KiwiCachedFlightProvider(new KiwiMcpFlightProvider(options), deps);
}
