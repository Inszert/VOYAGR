import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/lib/env';
import type { DataSource } from './data-source';
import { getLogger } from '@/lib/logger';
import {
  createAbsentHotelProvider,
  createAbsentPlacesProvider,
  createAbsentTransferProvider,
} from './absent';
import { mockAllowed } from './mock-policy';
import { createAviasalesFlightProvider } from './flights/aviasales';
import { createMockFlightProvider } from './flights/mock';
import { createMockHotelProvider } from './hotels/mock';
import { createMockPlacesProvider } from './places/mock';
import { createWikidataPlacesProvider } from './places/wikidata';
import { createMockTransferProvider } from './transfers/mock';
import { createMockWeatherProvider } from './weather/mock';
import { createOpenMeteoWeatherProvider } from './weather/open-meteo';
import type {
  AnyProvider,
  FlightProvider,
  HotelProvider,
  PlacesProvider,
  ProviderHealth,
  ProviderKind,
  TransferProvider,
  WeatherProvider,
} from './types';

/**
 * Provider registry.
 *
 * The single place that decides which adapter implementation is active. Callers
 * ask for "the flight provider" and get whatever configuration selected, so no
 * feature code ever names a vendor.
 *
 * Outside production a slot with no live adapter resolves to a mock. In
 * production it never does: flights and weather refuse to start on one, and the
 * slots that have no live adapter yet (hotels, transfers, places) resolve to an
 * `absent` provider instead - see `assertNoMockInProduction`. Adding a real
 * provider means writing the adapter and extending the relevant factory below -
 * the call sites do not change.
 */

const log = getLogger('providers.registry');

export class ProviderRegistry {
  readonly flights: FlightProvider;
  readonly hotels: HotelProvider;
  readonly weather: WeatherProvider;
  readonly transfers: TransferProvider;
  readonly places: PlacesProvider;

  constructor(env: Env) {
    this.flights = resolveFlightProvider(env);
    this.hotels = resolveHotelProvider(env);
    this.weather = resolveWeatherProvider(env);
    this.transfers = resolveTransferProvider(env);
    this.places = resolvePlacesProvider(env);

    assertNoMockInProduction(this, env);
  }

  all(): AnyProvider[] {
    return [this.flights, this.hotels, this.weather, this.transfers, this.places];
  }

  get(kind: ProviderKind): AnyProvider {
    switch (kind) {
      case 'flights':
        return this.flights;
      case 'hotels':
        return this.hotels;
      case 'weather':
        return this.weather;
      case 'transfers':
        return this.transfers;
      case 'places':
        return this.places;
      case 'stays':
        /*
         * Not in this registry yet.
         *
         * The stay providers fan out - several at once, merged into one
         * result set - so they are resolved by `src/providers/stays/registry.ts`
         * rather than held as the single adapter this class models. Named
         * here so the switch stays exhaustive and adding the kind cannot be
         * forgotten.
         */
        throw new AppError(
          'CONFIGURATION_ERROR',
          'Stay providers are resolved by the stays registry, not this one.',
        );
    }
  }

  /** True when every active adapter is a mock - i.e. no live data anywhere. */
  isFullyMocked(): boolean {
    return this.all().every((provider) => provider.metadata.isMock);
  }

  /**
   * Probe every provider concurrently.
   *
   * A health check must never throw: a provider that fails its own probe is
   * reported as `unavailable` so the dashboard keeps working.
   */
  async checkAll(): Promise<Record<string, ProviderHealth & { id: string; kind: ProviderKind }>> {
    const entries = await Promise.all(
      this.all().map(async (provider) => {
        try {
          const health = await provider.checkHealth();
          return [
            provider.metadata.kind,
            { ...health, id: provider.metadata.id, kind: provider.metadata.kind },
          ] as const;
        } catch (error) {
          log.error({ provider: provider.metadata.id, err: error }, 'provider health check threw');
          return [
            provider.metadata.kind,
            {
              status: 'unavailable' as const,
              checkedAt: new Date().toISOString(),
              latencyMs: null,
              message: 'Health check failed.',
              id: provider.metadata.id,
              kind: provider.metadata.kind,
            },
          ] as const;
        }
      }),
    );

    return Object.fromEntries(entries);
  }
}

/**
 * The production guard: no slot may be a mock.
 *
 * The resolvers below already refuse to build one, so this is the backstop
 * that makes the property a fact about the finished registry rather than about
 * each resolver being written correctly - a new slot or a new branch that
 * forgets the rule fails here, at startup, and says which slot.
 *
 * Fixtures in front of a real traveller are invented prices, which is why this
 * throws instead of logging.
 */
export function assertNoMockInProduction(
  registry: Pick<ProviderRegistry, 'all'>,
  env: Pick<Env, 'NODE_ENV' | 'ALLOW_MOCK_IN_PRODUCTION'>,
): void {
  if (mockAllowed(env)) return;

  const mocked = registry
    .all()
    .filter((provider) => provider.metadata.isMock)
    .map((provider) => `${provider.metadata.kind} (${provider.metadata.id})`);

  if (mocked.length > 0) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      `Production resolved fixture providers: ${mocked.join(', ')}. Configure a live provider, or leave the slot absent.`,
      { publicMessage: 'This travel data source is not configured.' },
    );
  }
}

function refuseMockInProduction(kind: ProviderKind): never {
  throw new AppError(
    'CONFIGURATION_ERROR',
    `${kind.toUpperCase()}_PROVIDER is "mock" in production. Fixtures are never served there; configure a live provider.`,
    {
      publicMessage: 'This travel data source is not configured.',
      context: { kind },
    },
  );
}

/**
 * Raised when configuration selects a live provider that has no implementation
 * yet. Failing loudly at resolution time is deliberate - silently falling back
 * to a mock in production would mean showing fixture prices as real ones.
 */
function liveProviderNotImplemented(kind: ProviderKind): never {
  throw new AppError(
    'CONFIGURATION_ERROR',
    `No live ${kind} provider is implemented yet. Set ${kind.toUpperCase()}_PROVIDER=mock or add an adapter.`,
    {
      publicMessage: 'This travel data source is not configured.',
      context: { kind },
    },
  );
}

function resolveFlightProvider(env: Env): FlightProvider {
  /*
   * There is deliberately no `duffel` case here, and none above this
   * function imports the adapter either. Binding project decision,
   * 2026-11-04: no paid API, ever - Duffel is commercial and
   * partner-gated, and `FLIGHT_PROVIDER` no longer even has a `'duffel'`
   * value to match (`src/lib/env.ts`), so this is not one failure mode
   * among several, it is the only path: the value cannot exist by the
   * time it would reach here. See `docs/provider-policy.md`.
   */
  if (env.FLIGHT_PROVIDER === 'aviasales') {
    /*
     * Refused at startup rather than at the first search.
     *
     * A registry that builds a credential-less adapter turns a configuration
     * mistake into an intermittent search failure hours later. Asking for
     * this provider without a token is a deployment error, and it says so
     * the moment the registry is built.
     */
    if (!env.AVIASALES_API_TOKEN) {
      throw new AppError(
        'CONFIGURATION_ERROR',
        'FLIGHT_PROVIDER is "aviasales" but AVIASALES_API_TOKEN is not set.',
      );
    }

    return createAviasalesFlightProvider({
      token: env.AVIASALES_API_TOKEN,
      // A month at a time: the cache seldom holds an exact day pair, and the
      // assembler keeps only the flights that fly each window's own days.
      window: 'calendar',
      ...(env.AVIASALES_PARTNER_ID ? { partnerId: env.AVIASALES_PARTNER_ID } : {}),
    });
  }

  if (env.FLIGHT_PROVIDER === 'mock') {
    return mockAllowed(env) ? createMockFlightProvider() : refuseMockInProduction('flights');
  }

  return liveProviderNotImplemented('flights');
}

function resolveHotelProvider(env: Env): HotelProvider {
  if (env.HOTEL_PROVIDER === 'absent') return createAbsentHotelProvider();

  if (env.HOTEL_PROVIDER === 'mock') {
    return mockAllowed(env) ? createMockHotelProvider() : refuseMockInProduction('hotels');
  }

  return liveProviderNotImplemented('hotels');
}

function resolveWeatherProvider(env: Env): WeatherProvider {
  if (env.WEATHER_PROVIDER === 'open-meteo') {
    return createOpenMeteoWeatherProvider();
  }

  if (env.WEATHER_PROVIDER === 'mock') {
    return mockAllowed(env) ? createMockWeatherProvider() : refuseMockInProduction('weather');
  }

  return liveProviderNotImplemented('weather');
}

function resolveTransferProvider(env: Env): TransferProvider {
  if (env.TRANSFER_PROVIDER === 'absent') return createAbsentTransferProvider();

  if (env.TRANSFER_PROVIDER === 'mock') {
    // Only mocks exist for this slot today, so in production it is absent
    // rather than a startup failure: the cost line is `excluded`, never zero.
    return mockAllowed(env) ? createMockTransferProvider() : createAbsentTransferProvider();
  }

  return liveProviderNotImplemented('transfers');
}

function resolvePlacesProvider(env: Env): PlacesProvider {
  if (env.PLACES_PROVIDER === 'absent') return createAbsentPlacesProvider();
  if (env.PLACES_PROVIDER === 'wikidata') return createWikidataPlacesProvider();

  if (env.PLACES_PROVIDER === 'mock') {
    return mockAllowed(env) ? createMockPlacesProvider() : createAbsentPlacesProvider();
  }

  return liveProviderNotImplemented('places');
}

/**
 * Cached on `globalThis`, not a plain module-level `const` Map.
 *
 * Reviewed alongside the five named singletons (phase 2) for the same
 * module-duplication risk `src/db/index.ts` proved real. This one does
 * span a Route Handler (`/api/health`) and several Server Components
 * (`/status`, the search pages), so a split is possible - but traced
 * through to what it would actually cost: each search already builds its
 * own `LimiterPool` fresh inside `runSearch` (`src/search/orchestrator.ts`),
 * scoped to that one search, so a duplicated `ProviderRegistry` would not
 * double any real concurrency or rate-limit exposure the way the imagery
 * singleton's split limiter would have. The cost of a split here is a few
 * wasted adapter-object constructions - real, but far lower stakes. Moved
 * anyway, since the fix is free and "probably harmless" is not the same
 * claim as "verified harmless".
 *
 * Two of them at most, both built once and reused: the configured one, and
 * the all-fixtures one. Adapters are stateless and hold no per-request
 * state, so sharing them across requests is what the process-wide registry
 * already did - this only adds a second entry beside it.
 *
 * `mock` is built by overriding the provider names rather than by
 * constructing fixtures directly, so it goes through exactly the same
 * resolution the configured registry does and cannot drift from it.
 */
declare global {
  var __voyagrProviderRegistries: Map<DataSource, ProviderRegistry> | undefined;
}

function registries(): Map<DataSource, ProviderRegistry> {
  globalThis.__voyagrProviderRegistries ??= new Map<DataSource, ProviderRegistry>();
  return globalThis.__voyagrProviderRegistries;
}

export function getProviderRegistry(source: DataSource = 'api'): ProviderRegistry {
  const existing = registries().get(source);
  if (existing) return existing;

  const env = getEnv();
  const built = new ProviderRegistry(
    source === 'mock'
      ? {
          ...env,
          FLIGHT_PROVIDER: 'mock',
          HOTEL_PROVIDER: 'mock',
          WEATHER_PROVIDER: 'mock',
          TRANSFER_PROVIDER: 'mock',
          PLACES_PROVIDER: 'mock',
        }
      : env,
  );

  registries().set(source, built);

  log.info(
    {
      source,
      flights: built.flights.metadata.id,
      hotels: built.hotels.metadata.id,
      weather: built.weather.metadata.id,
      transfers: built.transfers.metadata.id,
      places: built.places.metadata.id,
      fullyMocked: built.isFullyMocked(),
    },
    'provider registry initialised',
  );

  return built;
}

/** Test helper - drops the cached registries so a test can vary configuration. */
export function resetProviderRegistry(): void {
  globalThis.__voyagrProviderRegistries = undefined;
}
