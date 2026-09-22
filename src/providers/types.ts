import type { OperationPolicy, ProviderOperation } from './policy';
import type { Result } from '@/lib/result';
import type { ProviderMode } from '@/core/trip/provenance';
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

/**
 * `stays` is separate from `hotels` on purpose.
 *
 * `hotels` is the original trip-search adapter, which answers with the one
 * cheapest room per property so a whole trip can be costed. `stays` is the
 * provider-neutral accommodation search: properties, rooms and rates, several
 * per property, comparable across providers. They answer different questions
 * and collapsing them would force one to pretend to be the other.
 */
export type ProviderKind = 'flights' | 'hotels' | 'stays' | 'weather' | 'transfers' | 'places';

/**
 * A provider's own pagination cursor.
 *
 * Opaque, and provider-specific by design: Duffel returns a `meta.after`
 * string, Booking.com a `next_page` token, and another vendor will do
 * something else again. Nothing outside the adapter that produced a cursor may
 * parse, compare or construct one - it is a token to hand back, not data.
 */
export type PageCursor = string;

/**
 * One page of results.
 *
 * Every list-returning provider method returns this rather than a bare array,
 * because "one call returns everything worth having" turned out to be false
 * for every vendor evaluated. An adapter that genuinely has no pagination
 * returns all its items with a null cursor, and callers cannot tell the
 * difference - which is the point.
 */
export interface ProviderPage<T> {
  readonly items: readonly T[];
  /** Cursor for the next page, or null when this is the last one. */
  readonly nextCursor: PageCursor | null;
}

export interface ProviderMetadata {
  /** Stable identifier recorded on every offer and price observation. */
  readonly id: string;
  readonly kind: ProviderKind;
  readonly displayName: string;
  /** True when the adapter serves fixtures rather than calling a live API. */
  readonly isMock: boolean;
  /**
   * How this adapter is running, which decides what its answers are worth.
   *
   * `isMock` is a boolean and cannot tell a live account from a sandbox one.
   * A provider in test mode returns real shapes and real carrier names for
   * seats that do not exist, and inheriting "Live price" from `isMock: false`
   * is a lie told by a boolean. Optional so existing adapters are unchanged:
   * absent means `isMock ? 'mock' : 'live'`.
   */
  readonly mode?: ProviderMode;
  /**
   * Provider-declared rate limit, used by the scheduler to pace background
   * Travel Watch refreshes. `null` when the adapter has no meaningful limit.
   */
  readonly rateLimitPerMinute: number | null;
  /**
   * How long one call to this vendor has been measured to take.
   *
   * A rate limit alone cannot say how fast a provider can be driven: a
   * semaphore bounds calls *in flight*, a quota bounds calls *per minute*,
   * and only latency joins them (see `concurrencyFor`). Until now that join
   * used a flat one-second floor, which is wrong in both directions - it
   * throttles a vendor whose calls take five seconds down to one at a time,
   * and it lets a millisecond-fast one spend a minute's quota at once.
   *
   * `null` means nobody has measured it, and the one-second floor applies.
   * A number here is a **measurement**, not a target: it is what a real call
   * took, and it belongs to the adapter that made that call.
   */
  readonly typicalLatencyMs?: number | null;
  /**
   * Per-operation policy this provider needs that differs from the default.
   *
   * Timeouts and attempt counts are vendor facts - one vendor's search budget
   * is not another's. The retry *stance* is deliberately not overridable: that
   * an order creation must never be replayed is a property of what the
   * operation does, not of who serves it.
   */
  readonly operationOverrides?: Partial<
    Record<ProviderOperation, Partial<Omit<OperationPolicy, 'stance'>>>
  >;
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
  /** Items per page. A provider may cap this below what is asked. */
  readonly maxResults?: number;
  /** Continue from a previous page. Omit for the first. */
  readonly cursor?: PageCursor;
}

export interface FlightProvider extends ProviderAdapter {
  readonly metadata: ProviderMetadata & { kind: 'flights' };
  searchFlights(
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ProviderPage<FlightOffer>>>;
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
  readonly cursor?: PageCursor;
}

export interface HotelProvider extends ProviderAdapter {
  readonly metadata: ProviderMetadata & { kind: 'hotels' };
  searchHotels(
    query: HotelSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ProviderPage<HotelOffer>>>;
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
