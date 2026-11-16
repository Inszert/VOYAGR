import { daysBetween } from '@/core/dates';
import { forParty } from '@/core/party';
import { pairOneWayFares } from '@/core/trip/one-way-pair';
import type { FlightLeg, FlightOffer, IsoDate, IsoDateTime, OneWayFare } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type { FetchLike } from '../http/types';
import { googleFlightsResponseSchema, googleFlightsRowSchema } from '../schema';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderHealth,
  ProviderPage,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';
import { parsePriceText } from './price-text';

/**
 * Google Flights, through the local sidecar in `services/google-flights/`.
 *
 * **An owner-approved exception to `docs/provider-policy.md`, off by default.** The sidecar wraps
 * `fast-flights`, an unofficial scraper. Google's terms do not permit automated access, the
 * library can be blocked or break without notice, and there is no SLA. Nothing here is reachable
 * unless `GOOGLE_FLIGHTS_SIDECAR_URL` is set *and* the registry is told to use this provider.
 *
 * What a row honestly is, which decides how it is mapped:
 *
 * - **A scraped listing price, not a quote.** There is no offer id, no expiry and no booking
 *   token. The provider says `indicative`, like Aviasales, and `expiresAt` is `null`. The link is
 *   a Google Flights *search*, never a booking.
 * - **Whole currency units.** The library returns an integer price with no cents. The sidecar
 *   carries it as a string; it is parsed here to exact minor units, and anything unreadable is
 *   dropped and counted.
 * - **One adult.** Every query asks for one adult, and the fare is multiplied out with
 *   `forParty`, exactly as the Aviasales adapter does. Whether Google lists a per-person or a
 *   party total depends on its page, and a guess would price four travellers as one or as sixteen.
 * - **No inbound flight for a return.** A Google round-trip result lists the *outbound*
 *   itineraries priced as the round trip, and `FlightOffer` needs an inbound leg we would have to
 *   invent. So a return is searched as **two one-way queries** and paired by `pairOneWayFares`,
 *   which marks every result `ticketing: 'two_one_way'`. That is what is actually being priced:
 *   two separate scraped fares, which is sometimes dearer than Google's own round trip.
 * - **Airline names, no flight numbers.** The library names airlines and never numbers a flight.
 *   `flightNumber` is required by the domain, so it carries `FLIGHT_NUMBER_UNSTATED`; a cleaner
 *   fix is a nullable `flightNumber` in `core/trip/types.ts`.
 * - **Times** are the zoneless clock faces Google prints for each airport (`LocalDateTime`).
 *   `observedAt` is the sidecar's `fetched_at`, which is the original fetch time even when the
 *   sidecar answered from its own cache.
 */

const log = getLogger('providers.google-flights');

/** Shown where a flight number would be: the library never states one. */
export const FLIGHT_NUMBER_UNSTATED = '—';

/** How many cheapest flights per direction are paired. 4 x 4 keeps a page to 16 trips. */
const PAIR_PER_DIRECTION = 4;

const DEFAULT_TIMEOUT_MS = 40_000;
const HEALTH_TIMEOUT_MS = 3_000;

const METADATA = {
  id: 'google-flights',
  kind: 'flights',
  displayName: 'Google Flights (unofficial scraper)',
  // Real prices, from a real page - but scraped, so never labelled `live`.
  isMock: false,
  mode: 'indicative',
  /*
   * Deliberately low, and the sidecar enforces its own floor of one upstream request every three
   * seconds on top. Twenty a minute would be the sidecar's ceiling; ten leaves headroom so a
   * search that needs two calls per trip does not start the day at the limit.
   */
  rateLimitPerMinute: 10,
} as const;

export interface GoogleFlightsOptions {
  /** Where the sidecar listens, e.g. `http://127.0.0.1:8765`. */
  readonly baseUrl: string;
  /** The shared secret for `X-Voyagr-Sidecar-Key`, when the sidecar demands one. */
  readonly key?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => Date;
}

/** A Google Flights *search* for the route, not a booking. Plain link, no tracking. */
export function googleFlightsSearchUrl(
  origin: string,
  destination: string,
  date: IsoDate,
  returnDate: IsoDate | null,
  currency: string,
): string {
  const url = new URL('https://www.google.com/travel/flights');
  const when = returnDate ? `on ${date} through ${returnDate}` : `on ${date} one way`;
  url.searchParams.set('q', `Flights from ${origin} to ${destination} ${when}`);
  url.searchParams.set('curr', currency.toUpperCase());
  url.searchParams.set('hl', 'en');
  return url.toString();
}

/** Why a sidecar row was not kept. Counted and logged, never silent. */
export type RowSkip = 'malformed' | 'unpriced' | 'unreadable_price' | 'incomplete_journey';

export interface RowContext {
  readonly providerId: string;
  readonly origin: string;
  readonly destination: string;
  readonly observedAt: IsoDateTime;
  readonly passengers: number;
  readonly deepLink: string;
}

/** The carrier for segment `index`, from the itinerary-level airline names. */
function carrierFor(airlines: readonly string[], index: number, segments: number): string {
  if (airlines.length === 0) return 'Unknown airline';
  // One name per hop lines up by position; otherwise the names are the itinerary's set, and
  // guessing which hop belongs to which would be inventing the middle of the journey.
  if (airlines.length === segments) return airlines[index]!;
  return airlines.join(' / ');
}

/** One sidecar row as a one-way fare, or the reason it is not one. */
export function mapRow(raw: unknown, context: RowContext): OneWayFare | RowSkip {
  const parsed = googleFlightsRowSchema.safeParse(raw);
  if (!parsed.success) return 'malformed';
  const row = parsed.data;

  if (row.price === null) return 'unpriced';
  const price = parsePriceText(row.price, row.currency);
  if (!price) return 'unreadable_price';

  // Whole journey needs its endpoints, its length and an itemised hop list that agrees with
  // the stop count; a leg built from less would be a guess presented as an itinerary.
  if (
    row.duration_minutes === null ||
    row.stops !== row.segments.length - 1 ||
    row.segments.some((hop) => !hop.from_airport || !hop.to_airport || !hop.departs_at)
  ) {
    return 'incomplete_journey';
  }

  const first = row.segments[0]!;
  const last = row.segments[row.segments.length - 1]!;
  // A flight to or from some other airport is not the route asked about.
  if (first.from_airport !== context.origin || last.to_airport !== context.destination) {
    return 'incomplete_journey';
  }

  const leg: FlightLeg = {
    segments: row.segments.map((hop, index) => ({
      origin: hop.from_airport!,
      destination: hop.to_airport!,
      departsAt: hop.departs_at!,
      // Null when Google printed none; it is never derived from the departure and a duration.
      arrivesAt: hop.arrives_at,
      carrier: carrierFor(row.airlines, index, row.segments.length),
      flightNumber: FLIGHT_NUMBER_UNSTATED,
    })),
    durationMinutes: row.duration_minutes,
    // Google's list page states nothing about bags or ticketing in what the library returns.
    cabinBaggageIncluded: null,
    checkedBaggageIncluded: null,
    selfTransfer: null,
  };

  const departs = first.departs_at!;
  return {
    id: `${context.providerId}:${context.origin}-${context.destination}:${departs}:${row.airlines.join('+')}`,
    providerId: context.providerId,
    leg,
    price: forParty(price, context.passengers),
    observedAt: context.observedAt,
    deepLink: context.deepLink,
  };
}

export interface RowsOutcome {
  readonly fares: OneWayFare[];
  readonly skipped: Readonly<Record<RowSkip, number>>;
}

/** Every row of one sidecar answer, or null when the envelope itself is not recognised. */
export function mapResponse(
  body: unknown,
  context: Omit<RowContext, 'observedAt'>,
): RowsOutcome | null {
  const envelope = googleFlightsResponseSchema.safeParse(body);
  if (!envelope.success) return null;

  const skipped: Record<RowSkip, number> = {
    malformed: 0,
    unpriced: 0,
    unreadable_price: 0,
    incomplete_journey: 0,
  };
  const fares: OneWayFare[] = [];

  for (const raw of envelope.data.offers) {
    const mapped = mapRow(raw, { ...context, observedAt: envelope.data.fetched_at });
    if (typeof mapped === 'string') skipped[mapped] += 1;
    else fares.push(mapped);
  }

  return { fares, skipped };
}

/** Cheapest first; ties keep the earlier departure, which is stable and says nothing else. */
function cheapest(fares: readonly OneWayFare[], count: number): OneWayFare[] {
  return [...fares]
    .sort(
      (a, b) =>
        a.price.amount - b.price.amount ||
        (a.leg.segments[0]!.departsAt < b.leg.segments[0]!.departsAt ? -1 : 1),
    )
    .slice(0, count);
}

export class GoogleFlightsProvider implements FlightProvider {
  readonly metadata = METADATA;

  private readonly baseUrl: string;
  private readonly key: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: GoogleFlightsOptions) {
    if (!options.baseUrl) {
      throw new AppError(
        'CONFIGURATION_ERROR',
        'The Google Flights provider needs GOOGLE_FLIGHTS_SIDECAR_URL.',
      );
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.key = options.key;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
  }

  async checkHealth(options?: ProviderRequestOptions): Promise<ProviderHealth> {
    const started = this.now().getTime();
    try {
      // The sidecar's /health never touches Google, so this costs no scraping quota.
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: this.signal(options, HEALTH_TIMEOUT_MS),
      });
      return {
        status: response.ok ? 'healthy' : 'degraded',
        checkedAt: this.now().toISOString(),
        latencyMs: this.now().getTime() - started,
        message: response.ok
          ? 'Sidecar answers. Whether Google still serves it is only known by a search.'
          : `Sidecar answered ${response.status}.`,
      };
    } catch {
      return {
        status: 'unavailable',
        checkedAt: this.now().toISOString(),
        latencyMs: null,
        message: 'The Google Flights sidecar could not be reached.',
      };
    }
  }

  async searchFlights(
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ProviderPage<FlightOffer>>> {
    const origin = query.origins[0];
    const destination = query.destinations[0];

    if (!origin || !destination) {
      return err(
        new AppError('VALIDATION_ERROR', 'A flight search needs an origin and a destination.'),
      );
    }

    // `forParty` throws on anything else, and an adapter returns a `Result`.
    if (!Number.isSafeInteger(query.passengers) || query.passengers < 1) {
      return err(new AppError('VALIDATION_ERROR', 'A flight search needs at least one passenger.'));
    }

    const out = await this.oneWay(origin, destination, query.departureDate, query, options);
    if (!out.ok) return err(out.error);

    const back = await this.oneWay(destination, origin, query.returnDate, query, options);
    if (!back.ok) return err(back.error);

    const nights = daysBetween(query.departureDate, query.returnDate);
    const offers: FlightOffer[] = [];

    for (const outbound of cheapest(out.value, PAIR_PER_DIRECTION)) {
      for (const inbound of cheapest(back.value, PAIR_PER_DIRECTION)) {
        offers.push(
          ...pairOneWayFares([outbound], [inbound], { minNights: nights, maxNights: nights }),
        );
      }
    }

    offers.sort((a, b) => a.price.amount - b.price.amount);

    return ok({
      items: offers.slice(0, query.maxResults ?? offers.length),
      // One scrape is one page; there is no cursor to hand back.
      nextCursor: null,
    });
  }

  /** One direction on one day: one sidecar call, rows schema-checked, never a throw. */
  private async oneWay(
    from: string,
    to: string,
    date: IsoDate,
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly OneWayFare[]>> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('origin', from);
    url.searchParams.set('destination', to);
    url.searchParams.set('date', date);
    // Always one adult: see the module comment. The party is multiplied out in `mapRow`.
    url.searchParams.set('adults', '1');
    url.searchParams.set('currency', query.currency.toUpperCase());
    if (query.directOnly) url.searchParams.set('max_stops', '0');

    try {
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          Accept: 'application/json',
          ...(this.key ? { 'X-Voyagr-Sidecar-Key': this.key } : {}),
        },
        signal: this.signal(options),
      });

      if (!response.ok) return err(await this.failure(response));

      const outcome = mapResponse(await response.json(), {
        providerId: METADATA.id,
        origin: from,
        destination: to,
        passengers: query.passengers,
        deepLink: googleFlightsSearchUrl(from, to, date, null, query.currency),
      });
      if (!outcome) {
        return err(
          new AppError(
            'PROVIDER_ERROR',
            'The Google Flights sidecar sent an unrecognised response.',
          ),
        );
      }

      const dropped = Object.values(outcome.skipped).reduce((total, count) => total + count, 0);
      if (dropped > 0) {
        log.info(
          { ...outcome.skipped, kept: outcome.fares.length },
          'google flights rows not used',
        );
      }
      return ok(outcome.fares);
    } catch (error) {
      const timedOut =
        error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
      // No URL in the log: the query string is the traveller's route and dates.
      log.warn({ err: error }, 'google flights sidecar request failed');
      return err(
        new AppError(
          timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          timedOut
            ? 'The Google Flights sidecar did not answer in time.'
            : 'The Google Flights sidecar could not be reached.',
        ),
      );
    }
  }

  /** What the sidecar said went wrong, as an `AppError` that names the cause plainly. */
  private async failure(response: Response): Promise<AppError> {
    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: { code?: unknown } };
      if (typeof body.error?.code === 'string') code = body.error.code;
    } catch {
      // A body that is not JSON just means no code to report.
    }

    log.warn({ status: response.status, code }, 'google flights sidecar responded with an error');

    if (code === 'consent_wall') {
      return new AppError(
        'PROVIDER_UNAVAILABLE',
        'Google Flights is blocking the scraper (consent page served instead of results).',
      );
    }
    if (response.status === 401) {
      return new AppError('PROVIDER_ERROR', 'The Google Flights sidecar rejected our key.');
    }
    if (response.status === 504) {
      return new AppError('PROVIDER_TIMEOUT', 'Google Flights did not answer the sidecar in time.');
    }
    return new AppError(
      response.status === 429 || response.status === 503
        ? 'PROVIDER_UNAVAILABLE'
        : 'PROVIDER_ERROR',
      `The Google Flights sidecar responded with ${response.status}${code ? ` (${code})` : ''}.`,
    );
  }

  /** The caller's signal and our own deadline, whichever comes first. */
  private signal(options?: ProviderRequestOptions, fallbackMs?: number): AbortSignal {
    const deadline = AbortSignal.timeout(options?.timeoutMs ?? fallbackMs ?? this.timeoutMs);
    return options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  }
}

export function createGoogleFlightsProvider(options: GoogleFlightsOptions): FlightProvider {
  return new GoogleFlightsProvider(options);
}
