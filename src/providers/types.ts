import type { Result } from '@/lib/result';
import type { AppError } from '@/lib/errors';
import type {
  AirportCode,
  FlightOffer,
  HotelOffer,
  IsoDate,
  TransferOffer,
  WeatherOutlook,
} from '@/core/trip/types';

/**
 * Provider adapter contracts.
 *
 * Every external travel data source sits behind one of these interfaces. The
 * search, cost, scoring and monitoring engines depend only on these types, never
 * on a vendor SDK, so swapping or adding a provider is an adapter change and
 * nothing more (specification section 4, "Provider abstraction").
 *
 * Adapters return `Result` rather than throwing. One provider timing out must
 * degrade a search, not abort it.
 */

export type ProviderKind = 'flights' | 'hotels' | 'weather' | 'transfers' | 'places';

export interface ProviderMetadata {
  /** Stable identifier recorded on every offer and price observation. */
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  /** True when the adapter serves fixtures rather than calling a live API. */
  readonly isMock: boolean;
  /**
   * Provider-declared rate limit, used by the scheduler to pace background
   * Travel Watch refreshes. `null` when the adapter has no meaningful limit.
   */
  readonly rateLimitPerMinute: number | null;
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ProviderHealth {
  readonly status: ProviderHealthStatus;
  readonly checkedAt: string;
  /** Round-trip latency of the health probe, in milliseconds. */
  readonly latencyMs: number | null;
  readonly message?: string;
}

/** Per-request controls every adapter must honour. */
export interface ProviderRequestOptions {
  readonly signal?: AbortSignal;
  /** Correlation id threaded through logs and provider request records. */
  readonly requestId?: string;
  readonly timeoutMs?: number;
}

export type ProviderResult<T> = Result<T, AppError>;

export interface ProviderAdapter {
  readonly metadata: ProviderMetadata;
  /**
   * Cheap liveness probe. Must not consume search quota and must never throw:
   * a failing provider reports `unavailable`, it does not crash the caller.
   */
  checkHealth(options?: ProviderRequestOptions): Promise<ProviderHealth>;
}

// --- Flights ---------------------------------------------------------------

export interface FlightSearchQuery {
  readonly origins: readonly AirportCode[];
  readonly destinations: readonly AirportCode[];
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly passengers: number;
  readonly currency: string;
  readonly directOnly?: boolean;
  readonly maxResults?: number;
}

export interface FlightProvider extends ProviderAdapter {
  readonly metadata: ProviderMetadata & { kind: 'flights' };
  searchFlights(
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly FlightOffer[]>>;
}

// --- Hotels ----------------------------------------------------------------

export interface HotelSearchQuery {
  readonly destination: AirportCode;
  readonly checkIn: IsoDate;
  readonly checkOut: IsoDate;
  readonly guests: number;
  readonly currency: string;
  readonly minReviewScore?: number;
  readonly freeCancellationOnly?: boolean;
  readonly maxResults?: number;
}

export interface HotelProvider extends ProviderAdapter {
  readonly metadata: ProviderMetadata & { kind: 'hotels' };
  searchHotels(
    query: HotelSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly HotelOffer[]>>;
}

// --- Weather ---------------------------------------------------------------

export interface WeatherQuery {
  readonly destination: AirportCode;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
}

export interface WeatherProvider extends ProviderAdapter {
  readonly metadata: ProviderMetadata & { kind: 'weather' };
  getOutlook(
    query: WeatherQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly WeatherOutlook[]>>;
}

// --- Transfers -------------------------------------------------------------

export interface TransferQuery {
  readonly airport: AirportCode;
  readonly destinationName: string;
  readonly passengers: number;
  readonly currency: string;
}

export interface TransferProvider extends ProviderAdapter {
  readonly metadata: ProviderMetadata & { kind: 'transfers' };
  searchTransfers(
    query: TransferQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly TransferOffer[]>>;
}

// --- Places (restaurants, activities, points of interest) ------------------

export type PlaceCategory =
  'restaurant' | 'cafe' | 'beach' | 'attraction' | 'activity' | 'nightlife';

export interface Place {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly category: PlaceCategory;
  /** Provider price tier, 1 (cheapest) to 4 (most expensive), or null. */
  readonly priceLevel: number | null;
  readonly rating: number | null;
  readonly ratingCount: number;
  readonly distanceFromCentreMetres: number | null;
}

export interface PlacesQuery {
  readonly destination: AirportCode;
  readonly categories: readonly PlaceCategory[];
  readonly maxResults?: number;
}

export interface PlacesProvider extends ProviderAdapter {
  readonly metadata: ProviderMetadata & { kind: 'places' };
  searchPlaces(
    query: PlacesQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly Place[]>>;
}

/** Union of every adapter shape, for registry bookkeeping. */
export type AnyProvider =
  FlightProvider | HotelProvider | WeatherProvider | TransferProvider | PlacesProvider;
