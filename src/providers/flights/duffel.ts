import { z } from 'zod';
import { fromMajor } from '@/core/money';
import type { FlightLeg, FlightOffer, FlightSegment } from '@/core/trip/types';
import type { ProviderMode } from '@/core/trip/provenance';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err } from '@/lib/result';
import type { FetchLike } from '../http/types';
import type {
  FlightProvider,
  FlightSearchQuery,
  ProviderHealth,
  ProviderPage,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';

/**
 * Duffel, behind the flight adapter interface.
 *
 * Unlike the cached fare calendar beside it, this is an offer API: a search
 * creates an offer request and comes back with priced itineraries, each with
 * **every segment** - origin, destination, both local times, marketing
 * carrier and flight number - and, on almost all of them, the baggage
 * allowance. That is the whole of what `FlightOffer` needs, so nothing has to
 * be refused for being unrepresentable and nothing is invented.
 *
 * **Test mode is not live mode, and this adapter says which.** Duffel marks
 * every offer with `live_mode`, and a sandbox key returns realistic
 * itineraries on real carriers for seats that do not exist. The adapter reads
 * that flag off the response rather than trusting configuration, so a result
 * is labelled `test` because the vendor said so, not because an environment
 * variable did.
 *
 * The key authenticates and never leaves the server.
 */

const log = getLogger('providers.duffel');

const BASE_URL = 'https://api.duffel.com';

/** The version this adapter's mapping was written and verified against. */
const API_VERSION = 'v2';

/** An ISO 8601 duration as minutes. Duffel sends `PT4H10M`. */
export function durationMinutes(value: string | null | undefined): number | null {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(value ?? '');
  if (!match || (!match[1] && !match[2] && !match[3])) return null;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);

  return days * 1440 + hours * 60 + minutes;
}

const place = z.object({ iata_code: z.string().length(3).nullable().optional() });

const segmentSchema = z.object({
  origin: place,
  destination: place,
  /** Local wall clock at the airport, with no zone. Exactly what we want. */
  departing_at: z.string().min(1),
  arriving_at: z.string().min(1),
  duration: z.string().nullable().optional(),
  marketing_carrier: z
    .object({ iata_code: z.string().nullable().optional() })
    .nullable()
    .optional(),
  marketing_carrier_flight_number: z.string().nullable().optional(),
  passengers: z
    .array(
      z.object({
        baggages: z
          .array(z.object({ type: z.string(), quantity: z.number() }))
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional(),
});

const sliceSchema = z.object({
  duration: z.string().nullable().optional(),
  segments: z.array(segmentSchema).min(1),
});

const offerSchema = z.object({
  id: z.string().min(1),
  /** Duffel's own word on whether this is real inventory. */
  live_mode: z.boolean(),
  total_amount: z.string().min(1),
  total_currency: z.string().length(3),
  /** When Duffel created it. The honest `observedAt`. */
  created_at: z.string().min(1),
  /** Offers expire, typically within about fifteen minutes. */
  expires_at: z.string().min(1).nullable().optional(),
  owner: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  slices: z.array(sliceSchema).min(1),
});

/**
 * Both shapes, because the two endpoints differ.
 *
 * `/air/offer_requests?return_offers=true` nests the offers under
 * `data.offers`; `/air/offers` answers with `data` as the array itself.
 * Accepting either keeps the adapter working whichever is used.
 */
const responseSchema = z.object({
  data: z.union([
    z.array(z.unknown()),
    z.object({ live_mode: z.boolean().optional(), offers: z.array(z.unknown()).optional() }),
  ]),
});

export interface DuffelOptions {
  readonly token: string;
  readonly fetchImpl?: FetchLike;
  /** Cap on offers kept. Duffel returned 742 for one round trip. */
  readonly maxOffers?: number;
  /**
   * Cap on origin-destination pairs asked for in one search.
   *
   * Each pair is a separate vendor call, so this is the difference between a
   * wide search and an expensive one.
   */
  readonly maxRoutes?: number;
  /** How long Duffel may wait for the airlines. See `supplier_timeout`. */
  readonly supplierTimeoutMs?: number;
}

/**
 * A baggage allowance, or `null` when the carrier did not state one.
 *
 * Duffel reports baggage per passenger per segment. An empty list is the
 * vendor saying nothing, which the domain models as `null` - never as
 * "no baggage included", which would be a claim we cannot support in exactly
 * the field the No-Surprise check reads.
 */
function baggage(segments: z.infer<typeof segmentSchema>[], type: string): boolean | null {
  const stated = segments.flatMap((segment) =>
    (segment.passengers ?? []).flatMap((passenger) => passenger.baggages ?? []),
  );

  if (stated.length === 0) return null;

  // Included only when every segment of the leg allows it: a bag that has to
  // be rechecked on the second flight is not an allowance for the journey.
  return segments.every((segment) =>
    (segment.passengers ?? []).some((passenger) =>
      (passenger.baggages ?? []).some((bag) => bag.type === type && bag.quantity > 0),
    ),
  );
}

/** Duffel's local times carry no zone, so they are `LocalDateTime` already. */
function localTime(value: string): string {
  // Defensive: strip a zone if one ever appears, rather than letting a value
  // the domain refuses reach the boundary.
  return value.replace(/(?:Z|[+-]\d{2}:?\d{2})$/, '').slice(0, 16);
}

function toLeg(slice: z.infer<typeof sliceSchema>): FlightLeg | null {
  const segments: FlightSegment[] = [];

  for (const segment of slice.segments) {
    const origin = segment.origin.iata_code;
    const destination = segment.destination.iata_code;
    const carrier = segment.marketing_carrier?.iata_code;

    // Without these a segment cannot describe a journey, and a partial one is
    // worse than none: it would be an itinerary with a hole in it.
    if (!origin || !destination || !carrier) return null;

    segments.push({
      origin,
      destination,
      departsAt: localTime(segment.departing_at),
      arrivesAt: localTime(segment.arriving_at),
      carrier,
      flightNumber: `${carrier}${segment.marketing_carrier_flight_number ?? ''}`,
    });
  }

  /*
   * The slice's own duration, which includes the connections.
   *
   * Falling back to the sum of the segments would undercount a journey by the
   * length of its layovers - which is precisely the number a traveller cares
   * about. If Duffel states neither, the leg is refused rather than guessed.
   */
  const minutes =
    durationMinutes(slice.duration) ??
    (slice.segments.every((s) => s.duration)
      ? slice.segments.reduce((total, s) => total + (durationMinutes(s.duration) ?? 0), 0)
      : null);

  if (minutes === null || minutes <= 0) return null;

  return {
    segments,
    durationMinutes: minutes,
    cabinBaggageIncluded: baggage(slice.segments, 'carry_on'),
    checkedBaggageIncluded: baggage(slice.segments, 'checked'),
    /*
     * Duffel sells a single ticket per offer, so a missed connection is the
     * airline's problem rather than the traveller's. Stated as `false`
     * because it is known, not assumed.
     */
    selfTransfer: false,
  };
}

export type SkipReason = 'malformed' | 'one_way' | 'incomplete_segment';

/** One Duffel offer as a `FlightOffer`, or why it cannot be one. */
export function mapDuffelOffer(
  raw: unknown,
  providerId: string,
): { offer: FlightOffer; liveMode: boolean } | { skipped: SkipReason } {
  const parsed = offerSchema.safeParse(raw);
  if (!parsed.success) return { skipped: 'malformed' };

  const offer = parsed.data;

  /*
   * Two slices, because `FlightOffer` is a return trip.
   *
   * A one-way offer is not a lesser round trip, it is a different thing, and
   * the domain has no shape for it yet. Refused rather than bent.
   */
  const [out, back] = offer.slices;
  if (!out || !back) return { skipped: 'one_way' };

  const outbound = toLeg(out);
  const inbound = toLeg(back);
  if (!outbound || !inbound) return { skipped: 'incomplete_segment' };

  const amount = Number(offer.total_amount);
  if (!Number.isFinite(amount) || amount < 0) return { skipped: 'malformed' };

  return {
    liveMode: offer.live_mode,
    offer: {
      id: offer.id,
      providerId,
      outbound,
      inbound,
      // A string of major units from the vendor, through `fromMajor`.
      price: fromMajor(amount, offer.total_currency),
      // When Duffel made the offer, not when we read it.
      observedAt: offer.created_at,
    },
  };
}

export class DuffelFlightProvider implements FlightProvider {
  /**
   * What the last response said about itself.
   *
   * Seeded from the key's prefix, which Duffel makes unambiguous, and
   * corrected by `live_mode` on the offers if the two ever disagree. Held in
   * a field behind a getter rather than written onto `metadata`, because
   * `metadata` is readonly by contract and a search that mutates the object
   * its callers are reading is a race waiting to happen.
   */
  private observedMode: ProviderMode;

  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxOffers: number;
  private readonly maxRoutes: number;
  private readonly supplierTimeoutMs: number;

  constructor(options: DuffelOptions) {
    if (!options.token) {
      throw new AppError('CONFIGURATION_ERROR', 'Duffel provider needs the DUFFEL API key.');
    }

    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.maxOffers = options.maxOffers ?? 60;
    /*
     * Three, because of the rate limit rather than because of taste.
     *
     * Duffel allows thirty calls a minute, which `concurrencyFor` turns into
     * one in flight at a time. A search spans several date windows and each
     * window asks for every route, so the count multiplies fast: at eight
     * routes a wide "anywhere" search took twenty-seven seconds and would
     * have breached the quota on the way. Three keeps it usable.
     *
     * This is a real ceiling on what a live flight provider at thirty a
     * minute can serve, not a number that wants tuning.
     */
    this.maxRoutes = options.maxRoutes ?? 3;
    // Duffel accepts 2000-60000; outside that it rejects the request.
    this.supplierTimeoutMs = Math.min(
      60_000,
      Math.max(2_000, Math.floor(options.supplierTimeoutMs ?? 8_000)),
    );

    /*
     * The mode is read from the key, then corrected by the response.
     *
     * Duffel's test keys are prefixed, which is enough to label the provider
     * before any call is made. It is only a hint though - `live_mode` on the
     * response is the fact, and `searchFlights` downgrades to `test` if a key
     * that looked live answers with sandbox offers.
     */
    this.observedMode = options.token.startsWith('duffel_test_') ? 'test' : 'live';
  }

  get metadata(): FlightProvider['metadata'] {
    return {
      id: 'duffel',
      kind: 'flights',
      displayName: 'Duffel',
      isMock: false,
      mode: this.observedMode,
      // Measured from `ratelimit-limit` on a real response.
      rateLimitPerMinute: 30,
      /*
       * A search must be allowed to take as long as Duffel takes.
       *
       * Eight seconds is right for a vendor that answers from an index. It
       * is wrong for one that polls airlines: every live flight call was
       * being aborted at eight seconds and a live search came back with
       * nothing, which looked like an empty market rather than a timeout.
       *
       * Twelve, not twenty-five, because it sits just above the supplier
       * wait above. Duffel usually honours that wait and sometimes does not
       * - BUD-VIE took twenty seconds having been asked for three - and the
       * routes that overshoot are dropped rather than held on to. Five
       * destinations priced in twelve seconds is a better search than six in
       * twenty, and a route that answered nothing is simply a route with no
       * trips rather than a number we guessed at.
       */
      operationOverrides: { search: { timeoutMs: 12_000 } },
      /*
       * The eight-second supplier wait plus a round trip for the page and
       * Duffel's own overhead. Measured before that wait was asked for, five
       * cold routes took 11.4s, 6.1s, 20.1s, 20.1s and 5.8s; almost all of
       * it is the offer request, where Duffel polls the airlines, and the
       * page fetch that follows is a tenth of a second.
       *
       * Declaring it is what lets the search drive this vendor at the four
       * calls the quota actually allows rather than the one a flat
       * one-second assumption allowed - thirty a minute times nine seconds a
       * call is four in flight - so a search's date windows run as one round
       * instead of four.
       */
      typicalLatencyMs: 9_000,
    };
  }

  async checkHealth(_options?: ProviderRequestOptions): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      message: `Configured in ${this.metadata.mode} mode. No probe call made: a search is the only real check.`,
    };
  }

  async searchFlights(
    query: FlightSearchQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ProviderPage<FlightOffer>>> {
    /*
     * One request per route, because that is what the API takes.
     *
     * A Duffel offer request describes **one** journey: an origin, a
     * destination and dates. It has no concept of "price these six cities".
     * The adapter used to send `origins[0]` and `destinations[0]` and drop
     * the rest silently, so a search across six destinations returned six
     * copies of the first one - which looked exactly like the product only
     * knowing about one city.
     *
     * So the pairs are expanded here and asked for separately. The count is
     * bounded, because this multiplies directly into vendor calls: a wide
     * search is a wide search, not a licence to make sixty requests.
     */
    const routes: Array<{ origin: string; destination: string }> = [];

    for (const origin of query.origins) {
      for (const destination of query.destinations) {
        if (origin === destination) continue;
        routes.push({ origin, destination });
        if (routes.length >= this.maxRoutes) break;
      }

      if (routes.length >= this.maxRoutes) break;
    }

    if (routes.length === 0) {
      return err(
        new AppError('VALIDATION_ERROR', 'A flight search needs an origin and a destination.'),
      );
    }

    const perRoute = Math.max(1, Math.floor(this.maxOffers / routes.length));

    const settled = await Promise.all(
      routes.map((route) => this.searchRoute(route, query, perRoute, options)),
    );

    const offers: FlightOffer[] = [];
    const failures: number[] = [];
    let anyLive = false;
    let anyTest = false;

    for (const result of settled) {
      if ('status' in result) {
        failures.push(result.status);
        continue;
      }

      offers.push(...result.offers);
      if (result.anyLive) anyLive = true;
      if (result.anyTest) anyTest = true;
    }

    /*
     * Every route failing is a failure; some failing is a thinner answer.
     * One unreachable city must not empty a six-city search.
     *
     * Which failure it was still matters: a quota breach is a reason to back
     * off and try later, and a malformed response is not.
     */
    if (failures.length === routes.length) {
      if (failures.includes(408)) {
        return err(new AppError('PROVIDER_TIMEOUT', 'Duffel did not answer in time.'));
      }

      return err(
        failures.every((status) => status === 429 || status === 0)
          ? new AppError('PROVIDER_UNAVAILABLE', 'Duffel could not be reached.')
          : new AppError('PROVIDER_ERROR', 'Duffel returned an unexpected response.'),
      );
    }

    if (anyTest) {
      if (this.observedMode !== 'test') {
        log.warn({}, 'duffel returned sandbox offers from a key that looked live');
      }

      this.observedMode = 'test';
    } else if (anyLive) {
      this.observedMode = 'live';
    }

    return { ok: true, value: { items: offers.slice(0, this.maxOffers), nextCursor: null } };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Duffel-Version': API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** One origin-destination pair. Returns null when that route failed. */
  private async searchRoute(
    route: { origin: string; destination: string },
    query: FlightSearchQuery,
    limit: number,
    options?: ProviderRequestOptions,
  ): Promise<{ offers: FlightOffer[]; anyLive: boolean; anyTest: boolean } | { status: number }> {
    const body = {
      data: {
        slices: [
          {
            origin: route.origin,
            destination: route.destination,
            departure_date: query.departureDate,
          },
          {
            origin: route.destination,
            destination: route.origin,
            departure_date: query.returnDate,
          },
        ],
        passengers: Array.from({ length: Math.max(1, query.passengers) }, () => ({
          type: 'adult' as const,
        })),
        cabin_class: 'economy' as const,
        /*
         * How long Duffel waits for the airlines, in milliseconds.
         *
         * The single biggest thing wrong with this adapter. A Duffel offer
         * request polls every supplier and answers when the slowest one has,
         * which measured at **twenty seconds** for one route - and at twenty
         * seconds for six routes in parallel, because the wait is Duffel's,
         * not ours. Against an eight-second client timeout that meant every
         * call was aborted and a live flight search returned nothing at all.
         *
         * `supplier_timeout` is Duffel's own answer: it returns whatever
         * arrived in time instead of waiting for the last airline. Fewer
         * offers, in a fraction of the time, and the ones that arrive first
         * are real offers rather than a subset we invented.
         *
         * Eight seconds is a product decision, not a derived one: it is how
         * long a person waiting on a search page is willing to give the
         * airlines. Duffel honours it for most routes and overshoots on
         * some - BUD-VIE still took twenty - which is why the client timeout
         * above it is a separate, longer number rather than this one plus a
         * margin.
         */
        supplier_timeout: this.supplierTimeoutMs,
      },
    };

    try {
      /*
       * Two calls, and the second one is the point.
       *
       * `return_offers=true` hands back **every** offer Duffel found - nine
       * and a half megabytes and seven hundred and forty-two itineraries for
       * one round trip - of which this adapter kept sixty and threw the rest
       * away. Parsing that much JSON, several times over for a search that
       * spans date windows and destinations, was the whole of why a wide
       * search took half a minute.
       *
       * Creating the request without offers and then asking for a sorted
       * page costs two round trips and about two hundred kilobytes. It is
       * also **more correct**: `sort=total_amount` means the page we keep is
       * the cheapest offers rather than whichever ones arrived first.
       */
      const created = await this.fetchImpl(`${BASE_URL}/air/offer_requests?return_offers=false`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!created.ok) {
        log.warn(
          { status: created.status, route: `${route.origin}-${route.destination}` },
          'duffel responded with an error status',
        );

        return { status: created.status };
      }

      const requestId = ((await created.json()) as { data?: { id?: string }; live_mode?: boolean })
        ?.data?.id;

      if (!requestId) return { status: 502 };

      const response = await this.fetchImpl(
        `${BASE_URL}/air/offers?offer_request_id=${encodeURIComponent(requestId)}` +
          `&limit=${limit}&sort=total_amount`,
        { headers: this.headers(), ...(options?.signal ? { signal: options.signal } : {}) },
      );

      if (!response.ok) {
        log.warn({ status: response.status }, 'duffel offer page failed');
        return { status: response.status };
      }

      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) return { status: 502 };

      const offers: FlightOffer[] = [];
      const skipped: Record<SkipReason, number> = {
        malformed: 0,
        one_way: 0,
        incomplete_segment: 0,
      };

      let anyLive = false;
      let anyTest = false;

      const rows = Array.isArray(parsed.data.data)
        ? parsed.data.data
        : (parsed.data.data.offers ?? []);

      for (const raw of rows) {
        const mapped = mapDuffelOffer(raw, this.metadata.id);

        if ('skipped' in mapped) {
          skipped[mapped.skipped] += 1;
          continue;
        }

        if (mapped.liveMode) anyLive = true;
        else anyTest = true;

        offers.push(mapped.offer);
        if (offers.length >= limit) break;
      }

      if (Object.values(skipped).some((n) => n > 0)) {
        log.info({ ...skipped, kept: offers.length }, 'duffel offers not mapped');
      }

      return { offers, anyLive, anyTest };
    } catch (error) {
      log.warn(
        { err: error, route: `${route.origin}-${route.destination}` },
        'duffel request failed',
      );

      // 0 stands for "never reached the vendor", which is a timeout or a
      // network fault rather than something it said.
      return { status: error instanceof Error && error.name === 'AbortError' ? 408 : 0 };
    }
  }
}

export function createDuffelFlightProvider(options: DuffelOptions): FlightProvider {
  return new DuffelFlightProvider(options);
}
