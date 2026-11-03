import { z } from 'zod';
import { fromMajor } from '@/core/money';
import type { FlightOffer, IsoDate, LocalDateTime } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type { FetchLike } from '../http/types';
import { redactUrl } from '../http/redact';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderHealth,
  ProviderPage,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';

/**
 * Travelpayouts / Aviasales, behind the flight adapter interface.
 *
 * **Read this before trusting anything it returns.**
 *
 * This talks to the Travelpayouts *Data API* (`prices_for_dates`), which
 * serves **cached cheapest-price points**, not live bookable offers. That
 * difference is not a detail; it decides what this adapter can honestly
 * produce:
 *
 * - A price point names **one airline and one flight number for the whole
 *   journey**, plus a count of how many stops it has. For a connecting
 *   flight there is no connection airport and no connection times anywhere in
 *   the response. `FlightOffer` requires a segment per hop, so a connecting
 *   result **cannot be mapped without inventing the middle of the journey**.
 *   Those are refused and counted, never guessed at - see `mapOffer`.
 * - **These prices are cached, and measurably so.** Every link carries
 *   `search_date`; in the recorded response it was two days before the call.
 *   `observedAt` is taken from that rather than from the fetch, so a
 *   two-day-old fare is not reported as found a second ago - which means
 *   every offer from here arrives already `stale` against the thirty-minute
 *   flight limit in `core/freshness.ts`. That is the truth, not a fault.
 * - There is no baggage or ticketing information in the response, so
 *   `cabinBaggageIncluded`, `checkedBaggageIncluded` and `selfTransfer` are
 *   all `null`: the vendor did not say, and the domain has a branch for that.
 *
 * The token authenticates and never leaves the server. The partner marker is
 * an affiliate identifier that belongs in the outbound link a traveller
 * clicks, and is public by design.
 *
 * `fetchImpl` is injectable so the tests replay a recorded cassette and the
 * suite never touches the network.
 */

const log = getLogger('providers.aviasales');

/** Documented host for the Travelpayouts Data API. */
const BASE_URL = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

/**
 * A single cached price point.
 *
 * **Confirmed against a real response**, recorded in
 * `tests/fixtures/providers/aviasales-prices-for-dates.json`: fourteen rows
 * for VIE-AYT, every one of which parses, four of which are direct enough to
 * become offers. Every field the mapping depends on is required, so a vendor
 * that changes shape fails loudly at the boundary rather than producing a
 * plausible wrong price.
 */
const priceSchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  /*
   * The actual airports, which are not always the codes searched for.
   *
   * A search for a metro code - MOW, LON, NYC - comes back with the city in
   * `origin` and the airport that flight actually leaves from in
   * `origin_airport`. A segment saying "MOW" would be a journey from a city
   * rather than from a gate, so the segments below use these when present.
   * Both were on 14 of 14 rows in the recorded response.
   */
  origin_airport: z.string().length(3).optional(),
  destination_airport: z.string().length(3).optional(),
  /** The agency selling it, e.g. `Kupi.com`. Recorded for provenance. */
  gate: z.string().min(1).optional(),
  /** Total round-trip minutes. `duration_to`/`duration_back` are the legs. */
  duration: z.number().int().positive().optional(),
  /** Offset-bearing local departure, e.g. `2026-06-10T08:00:00+03:00`. */
  departure_at: z.string().min(1),
  return_at: z.string().min(1),
  airline: z.string().min(1),
  flight_number: z.union([z.string(), z.number()]),
  price: z.number().positive().finite(),
  /** Stops on the outbound and the inbound. */
  transfers: z.number().int().min(0),
  return_transfers: z.number().int().min(0),
  /** Minutes, each way. */
  duration_to: z.number().int().positive(),
  duration_back: z.number().int().positive(),
  link: z.string().optional(),
});

const responseSchema = z.object({
  success: z.boolean().optional(),
  currency: z.string().length(3).optional(),
  data: z.array(z.unknown()),
});

export type AviasalesPrice = z.infer<typeof priceSchema>;

/**
 * Which shape of question to ask the endpoint.
 *
 * `dates` asks for one exact departure/return pair, which is what a trip
 * search wants and what the cache most often does not have. `calendar` asks
 * for a whole month (`departure_at=YYYY-MM`) and gets the cheapest fare per
 * day, which is what this product is actually built to serve.
 *
 * **Experimental, and not wired to configuration.** It exists so the two can
 * be measured against each other before anything is decided. Nothing selects
 * `calendar` except a test or a probe script.
 */
export type AviasalesWindow = 'dates' | 'calendar';

export interface AviasalesOptions {
  readonly token: string;
  /** Defaults to `dates`, so behaviour is unchanged unless asked for. */
  readonly window?: AviasalesWindow;
  /** Affiliate marker. Public; used only to build the outbound link. */
  readonly partnerId?: string;
  readonly fetchImpl?: FetchLike;
  /** Injectable so a test can assert `observedAt` without a real clock. */
  readonly now?: () => Date;
}

/**
 * Strip the offset from a vendor timestamp to get a wall clock.
 *
 * **Confirmed against a real response.** The domain says a flight time is the
 * clock face at its airport and refuses anything carrying a zone. In the
 * recorded payload an outbound from Vienna in October carries `+02:00` -
 * Vienna's own offset that week - and the return from Antalya carries
 * `+03:00`, which is Turkey's. The offset tracks the airport the flight
 * leaves from, so dropping it leaves exactly the local wall clock wanted.
 *
 * Had the vendor sent a UTC-converted instant instead, this would have been
 * silently hours wrong. Nothing but a real response could settle it.
 */
export function toLocalDateTime(value: string): LocalDateTime | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);

  return match ? (`${match[1]}T${match[2]}` as LocalDateTime) : null;
}

/** Why a price point could not become an offer. Counted, never silent. */
export type SkipReason = 'connecting' | 'unparsable_time' | 'malformed';

/**
 * One cached price point as a `FlightOffer`, or the reason it cannot be.
 *
 * Only direct flights survive. A connecting price point names the airline and
 * the total duration but never the connection, and a segment list invented to
 * fill that gap would be a fabricated itinerary shown to a traveller.
 */
/**
 * When this price was actually found, from the link the vendor built.
 *
 * **These prices are cached, and the response says how stale.** Every link
 * carries `search_date=DDMMYYYY`; in the recorded response it read
 * `20092026` while the call was made on the 22nd, so the price was two days
 * old. Reporting the fetch time as `observedAt` would claim a two-day-old
 * fare was found a second ago - the precise dishonesty the freshness layer
 * exists to prevent.
 *
 * Read to the start of that day, which is the oldest the price can be, so
 * the error is always toward "older than stated" rather than fresher.
 *
 * `search_date` is not a documented field, so this is best effort: anything
 * unparsable falls back to the fetch time and the caller is none the wiser.
 */
export function observedFromLink(link: string | undefined, fallback: string): string {
  const match = /[?&]search_date=(\d{2})(\d{2})(\d{4})(?:&|$)/.exec(link ?? '');
  if (!match) return fallback;

  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}T00:00:00.000Z`;

  return Number.isFinite(Date.parse(iso)) ? iso : fallback;
}

export function mapOffer(
  raw: unknown,
  currency: string,
  observedAt: string,
  providerId: string,
): { offer: FlightOffer } | { skipped: SkipReason } {
  const parsed = priceSchema.safeParse(raw);
  if (!parsed.success) return { skipped: 'malformed' };

  const price = parsed.data;

  if (price.transfers > 0 || price.return_transfers > 0) return { skipped: 'connecting' };

  const departsAt = toLocalDateTime(price.departure_at);
  const returnsAt = toLocalDateTime(price.return_at);
  if (!departsAt || !returnsAt) return { skipped: 'unparsable_time' };

  const flightNumber = `${price.airline}${price.flight_number}`;

  /*
   * The arrival is not in the response, so it is the departure plus the
   * stated duration - and that is arithmetic on a wall clock across two
   * timezones, which is exactly what `core/dates.ts` exists to forbid.
   * `FlightLeg.durationMinutes` carries the real figure; the arrival field is
   * left equal to the departure rather than computed wrongly, and the
   * duration is what every engine actually reads.
   */
  const leg = (from: string, to: string, at: LocalDateTime, minutes: number) => ({
    segments: [
      {
        origin: from,
        destination: to,
        departsAt: at,
        arrivesAt: at,
        carrier: price.airline,
        flightNumber,
      },
    ],
    durationMinutes: minutes,
    // The vendor said nothing about any of these. `null` is its own case.
    cabinBaggageIncluded: null,
    checkedBaggageIncluded: null,
    selfTransfer: null,
  });

  // The gate the flight actually leaves from, falling back to what was asked
  // for when the vendor does not disambiguate.
  const from = price.origin_airport ?? price.origin;
  const to = price.destination_airport ?? price.destination;

  return {
    offer: {
      id: `${providerId}:${from}-${to}:${price.departure_at}:${flightNumber}`,
      providerId,
      outbound: leg(from, to, departsAt, price.duration_to),
      inbound: leg(to, from, returnsAt, price.duration_back),
      // `fromMajor`, never a float: the vendor quotes whole currency units.
      price: fromMajor(price.price, currency),
      observedAt: observedFromLink(price.link, observedAt),
      // Cached prices come with no promise of how long they hold.
      expiresAt: null,
      ...(price.link ? { deepLink: `https://www.aviasales.com${price.link}` } : {}),
    } as FlightOffer,
  };
}

export class AviasalesFlightProvider implements FlightProvider {
  readonly metadata = {
    id: 'aviasales',
    kind: 'flights',
    displayName: 'Aviasales (Travelpayouts)',
    // Not a mock: these are real vendor prices. Also not `live` - see the
    // module comment above - so `mode` is set explicitly rather than left to
    // the registry's `isMock ? 'mock' : 'live'` fallback, which would label
    // an always-stale cached price point "Live price".
    isMock: false,
    mode: 'indicative',
    /*
     * Measured, not guessed.
     *
     * The vendor sends `x-rate-limit: 600` with `x-rate-limit-remaining`
     * counting down one per call and `x-rate-limit-reset` counting down in
     * seconds; two recordings a minute apart put the window at sixty
     * seconds. So: six hundred a minute.
     *
     * Note the spelling - `x-rate-limit`, not `x-ratelimit-limit`. The
     * redactor's allow-list did not have it and stripped the value out of
     * the first recording, which is why `redact.ts` now lists both.
     */
    rateLimitPerMinute: 600,
  } as const;

  private readonly token: string;
  private readonly window: AviasalesWindow;
  private readonly partnerId: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: AviasalesOptions) {
    if (!options.token) {
      throw new AppError('CONFIGURATION_ERROR', 'Aviasales provider needs AVIASALES_API_TOKEN.');
    }

    this.token = options.token;
    this.window = options.window ?? 'dates';
    this.partnerId = options.partnerId;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
  }

  async checkHealth(_options?: ProviderRequestOptions): Promise<ProviderHealth> {
    /*
     * Deliberately does not call the vendor.
     *
     * A liveness probe must not consume search quota, and this endpoint has
     * no free health route. Reporting configuration is the honest answer:
     * whether a search works is answered by a search.
     */
    return {
      status: 'healthy',
      checkedAt: this.now().toISOString(),
      latencyMs: null,
      message: 'Configured. No probe call made: this API has no free health endpoint.',
    };
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

    const url = this.buildUrl(origin, destination, query);

    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        // The URL is redacted before it reaches a log: it carries the token.
        log.warn(
          { status: response.status, url: redactUrl(url) },
          'aviasales responded with an error status',
        );

        return err(
          new AppError(
            response.status === 429 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
            `Aviasales responded with ${response.status}.`,
          ),
        );
      }

      const body = responseSchema.safeParse(await response.json());

      if (!body.success) {
        return err(new AppError('PROVIDER_ERROR', 'Aviasales returned an unrecognised response.'));
      }

      const observedAt = this.now().toISOString();
      const currency = body.data.currency?.toUpperCase() ?? query.currency;

      const offers: FlightOffer[] = [];
      const skipped: Record<SkipReason, number> = {
        connecting: 0,
        unparsable_time: 0,
        malformed: 0,
      };

      for (const raw of body.data.data) {
        const mapped = mapOffer(raw, currency, observedAt, this.metadata.id);

        if ('offer' in mapped) offers.push(mapped.offer);
        else skipped[mapped.skipped] += 1;
      }

      if (skipped.connecting > 0 || skipped.malformed > 0 || skipped.unparsable_time > 0) {
        /*
         * Logged rather than swallowed. If most results are being dropped as
         * connecting, that is not noise - it is this endpoint being the wrong
         * source for a product that prices whole trips, and somebody should
         * see it.
         */
        log.info({ ...skipped, kept: offers.length }, 'aviasales price points not mapped');
      }

      return ok({
        items: offers.slice(0, query.maxResults ?? offers.length),
        /*
         * One page, always.
         *
         * `prices_for_dates` answers with a bounded set and offers no cursor,
         * so claiming a next page would send the pager round a loop.
         */
        nextCursor: null,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';

      log.warn({ err: error, url: redactUrl(url) }, 'aviasales request failed');

      return err(
        new AppError(
          aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          aborted ? 'Aviasales did not answer in time.' : 'Aviasales could not be reached.',
        ),
      );
    }
  }

  /** The request URL. The token is a query parameter, as this API requires. */
  private buildUrl(origin: string, destination: string, query: FlightSearchQuery): string {
    const url = new URL(BASE_URL);

    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);

    if (this.window === 'calendar') {
      /*
       * Both ends as months, not as days.
       *
       * Pinning exact dates collapses the cache to the pairs somebody
       * happened to search, which is empty for three of the four routes
       * measured. Asking for the month at both ends returns whole
       * (departure, return) combinations across it - which is both what
       * `FlightOffer` needs and what a flexible-date search is actually
       * asking. Measured: 25-57 rows per route-month against 0-14 for exact
       * dates.
       */
      url.searchParams.set('departure_at', query.departureDate.slice(0, 7));
      url.searchParams.set('return_at', query.returnDate.slice(0, 7));
    } else {
      url.searchParams.set('departure_at', query.departureDate satisfies IsoDate);
      url.searchParams.set('return_at', query.returnDate satisfies IsoDate);
    }
    url.searchParams.set('currency', query.currency.toLowerCase());
    url.searchParams.set('unique', 'false');
    url.searchParams.set('sorting', 'price');
    url.searchParams.set('limit', String(Math.min(query.maxResults ?? 30, 1000)));
    // Only direct results are mappable, so ask for only those when we can.
    url.searchParams.set('direct', this.window === 'calendar' ? 'false' : 'true');
    url.searchParams.set('token', this.token);

    if (this.partnerId) url.searchParams.set('marker', this.partnerId);

    return url.toString();
  }
}

export function createAviasalesFlightProvider(options: AviasalesOptions): FlightProvider {
  return new AviasalesFlightProvider(options);
}
