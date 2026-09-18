import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { createMockFlightProvider } from './flights/mock';
import { createMockHotelProvider } from './hotels/mock';
import { createMockPlacesProvider } from './places/mock';
import { createMockTransferProvider } from './transfers/mock';
import { createMockWeatherProvider } from './weather/mock';
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
 * Every slot currently resolves to a mock. Adding a real provider means writing
 * the adapter and extending the relevant factory below - the call sites do not
 * change.
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
  return env.FLIGHT_PROVIDER === 'mock'
    ? createMockFlightProvider()
    : liveProviderNotImplemented('flights');
}

function resolveHotelProvider(env: Env): HotelProvider {
  return env.HOTEL_PROVIDER === 'mock'
    ? createMockHotelProvider()
    : liveProviderNotImplemented('hotels');
}

function resolveWeatherProvider(env: Env): WeatherProvider {
  return env.WEATHER_PROVIDER === 'mock'
    ? createMockWeatherProvider()
    : liveProviderNotImplemented('weather');
}

function resolveTransferProvider(env: Env): TransferProvider {
  return env.TRANSFER_PROVIDER === 'mock'
    ? createMockTransferProvider()
    : liveProviderNotImplemented('transfers');
}

function resolvePlacesProvider(env: Env): PlacesProvider {
  return env.PLACES_PROVIDER === 'mock'
    ? createMockPlacesProvider()
    : liveProviderNotImplemented('places');
}

let registry: ProviderRegistry | undefined;

/** The process-wide registry, built on first use. */
export function getProviderRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry(getEnv());
    log.info(
      {
        flights: registry.flights.metadata.id,
        hotels: registry.hotels.metadata.id,
        weather: registry.weather.metadata.id,
        transfers: registry.transfers.metadata.id,
        places: registry.places.metadata.id,
        fullyMocked: registry.isFullyMocked(),
      },
      'provider registry initialised',
    );
  }

  return registry;
}

/** Test helper - drops the cached registry so a test can vary configuration. */
export function resetProviderRegistry(): void {
  registry = undefined;
}
