import { z } from 'zod';
import { isLocalDateTime } from '@/core/dates';
import { fromMajor, type Money } from '@/core/money';
import type { FlightLeg, FlightOffer, FlightSegment, IsoDate } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type { FetchLike } from '../http/types';
import { flightOfferSchema, validateOffers } from '../schema';
import type { ProviderRequestOptions, ProviderResult } from '../types';

/**
 * Round-trip flight offers from LiteAPI: `POST /v3.0/flights/rates`
 * (docs.nuitee.com, `reference/post_flights-rates`, read 2026-11-17).
 *
 * **This is the live fetch, and only the worker's scheduled job may call it**
 * (`src/liteapi-snapshot/flights-job.ts`). A visitor reads stored rows through
 * `liteapi-snapshot.ts`; `src/liteapi-snapshot/import-guard.test.ts` keeps every file under
 * `src/app/**` from reaching this one.
 *
 * What was read, and so what is mapped:
 *
 * - Request: `legs` (outbound then inbound, each `origin`, `destination`, `date`, `direction`),
 *   `adults`, `currency`, `cabinClass`, and a price sort. `margin` is not sent: the owner keeps
 *   markup at 0 in the dashboard.
 * - Response: `data[].journeys[]`. A round trip is one journey whose `segments[]` carry a
 *   `direction`; `legDurations[]` carry the elapsed minutes per direction, **which is where a
 *   leg's duration comes from. It is never worked out from two clock faces.** A journey's
 *   `offers[]` each carry `offerId`, `expiration` and `pricing.display.total`.
 * - Segment times are zoneless local date-times in the vendor's samples
 *   (`2026-07-01T16:10:00`), so they are the clock face at the airport, as `LocalDateTime` is.
 *   A time that is not that shape drops the journey; it is never converted or guessed.
 * - A journey with a missing direction, a missing leg duration, or a price not in the requested
 *   currency is dropped and reported, never repaired.
 * - Baggage: `baggage.hasCarryOnBag` and `hasCheckedBag` where stated, otherwise `null`. They
 *   are offer-level, so both legs carry the same answer. `selfTransfer` is not stated: `null`.
 * - The price is `pricing.display.total` as exact minor units, taken to be for the whole party
 *   (the page calls it the total selling price and lists per-passenger amounts apart from it).
 *   That reading is still to be confirmed against a recorded sandbox response.
 */

const log = getLogger('providers.flights.liteapi');

export const LITEAPI_FLIGHTS_ID = 'liteapi';

const BASE_URL = 'https://api.liteapi.travel/v3.0';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface LiteApiFlightsQuery {
  /** Airport or city IATA code. */
  readonly origin: string;
  readonly destination: string;
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly adults: number;
  readonly currency: string;
  /** For example `ECONOMY`. */
  readonly cabin: string;
}

export interface LiteApiFlightsOptions {
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => Date;
}

const minutes = z.object({ minutes: z.number().int().positive() }).passthrough();

const segmentSchema = z
  .object({
    originCode: z.string().regex(/^[A-Za-z]{3}$/),
    destinationCode: z.string().regex(/^[A-Za-z]{3}$/),
    departureTime: z.string(),
    arrivalTime: z.string().nullish(),
    direction: z.enum(['OUTBOUND', 'INBOUND']).nullish(),
    carrier: z.object({ marketingCode: z.string().min(1) }).passthrough(),
    flight: z.object({ marketingNumber: z.string().min(1) }).passthrough(),
  })
  .passthrough();

const vendorOfferSchema = z
  .object({
    offerId: z.string().min(1),
    expiration: z.string().nullish(),
    pricing: z
      .object({
        display: z
          .object({ total: z.number().finite().nonnegative(), currency: z.string() })
          .passthrough(),
      })
      .passthrough(),
    baggage: z
      .object({
        hasCarryOnBag: z.boolean().nullish().catch(null),
        hasCheckedBag: z.boolean().nullish().catch(null),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const journeySchema = z
  .object({
    journeyKey: z.string().min(1),
    segments: z.array(segmentSchema).min(1),
    legDurations: z
      .array(
        z.object({ direction: z.enum(['OUTBOUND', 'INBOUND']), duration: minutes }).passthrough(),
      )
      .min(1),
    offers: z.array(z.unknown()),
  })
  .passthrough();

const envelopeSchema = z
  .object({ data: z.array(z.object({ journeys: z.array(z.unknown()) }).passthrough()) })
  .passthrough();

function toMoney(amount: number, currency: string): Money | null {
  try {
    return fromMajor(amount, currency);
  } catch {
    return null;
  }
}

/** An instant that states its zone, or null. An expiry with no zone is not believed. */
function instantOrNull(value: string | null | undefined): string | null {
  if (!value || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** `LH` and `1234` is `LH1234`; a number that already starts with the code is left alone. */
function flightNumberOf(code: string, number: string): string {
  const carrier = code.toUpperCase();
  const trimmed = number.trim().toUpperCase().replace(/\s+/g, '');
  return trimmed.startsWith(carrier) ? trimmed : `${carrier}${trimmed}`;
}

type VendorSegment = z.infer<typeof segmentSchema>;
type VendorOffer = z.infer<typeof vendorOfferSchema>;

function mapSegment(segment: VendorSegment): FlightSegment | null {
  if (!isLocalDateTime(segment.departureTime)) return null;
  const arrival = segment.arrivalTime ?? null;
  if (arrival !== null && !isLocalDateTime(arrival)) return null;

  return {
    origin: segment.originCode.toUpperCase(),
    destination: segment.destinationCode.toUpperCase(),
    departsAt: segment.departureTime,
    arrivesAt: arrival,
    carrier: segment.carrier.marketingCode.toUpperCase(),
    flightNumber: flightNumberOf(segment.carrier.marketingCode, segment.flight.marketingNumber),
  };
}

function mapLeg(
  segments: readonly VendorSegment[],
  durationMinutes: number,
  offer: VendorOffer,
): FlightLeg | null {
  const mapped = segments.map(mapSegment);
  if (mapped.length === 0 || mapped.some((segment) => segment === null)) return null;

  return {
    segments: mapped as FlightSegment[],
    // The vendor's own elapsed time for the direction, layovers included.
    durationMinutes,
    cabinBaggageIncluded: offer.baggage?.hasCarryOnBag ?? null,
    checkedBaggageIncluded: offer.baggage?.hasCheckedBag ?? null,
    selfTransfer: null,
  };
}

export type MappedJourney =
  { readonly offer: FlightOffer } | { readonly reason: string; readonly id: string | null };

/**
 * One vendor journey as a `FlightOffer` at its cheapest usable offer, or the reason it cannot
 * be one. Exported for the tests.
 */
export function mapJourney(raw: unknown, currency: string, observedAt: string): MappedJourney {
  const parsed = journeySchema.safeParse(raw);
  if (!parsed.success) {
    const key = (raw as { journeyKey?: unknown } | null)?.journeyKey;
    return {
      reason: 'journey is not in the documented shape',
      id: typeof key === 'string' ? key : null,
    };
  }
  const journey = parsed.data;
  const id = journey.journeyKey;

  // The cheapest offer that states a price in the requested currency.
  let best: { offer: VendorOffer; price: Money } | null = null;
  for (const candidate of journey.offers) {
    const checked = vendorOfferSchema.safeParse(candidate);
    if (!checked.success) continue;
    const { total, currency: stated } = checked.data.pricing.display;
    if (stated.toUpperCase() !== currency.toUpperCase()) continue;
    const price = toMoney(total, stated);
    if (!price || price.amount <= 0) continue;
    if (!best || price.amount < best.price.amount) best = { offer: checked.data, price };
  }
  if (!best) return { reason: 'no offer with a usable price in the requested currency', id };

  const outboundSegments = journey.segments.filter((segment) => segment.direction === 'OUTBOUND');
  const inboundSegments = journey.segments.filter((segment) => segment.direction === 'INBOUND');
  if (
    outboundSegments.length === 0 ||
    inboundSegments.length === 0 ||
    outboundSegments.length + inboundSegments.length !== journey.segments.length
  ) {
    return { reason: 'segments do not all state a direction', id };
  }

  const outboundMinutes = journey.legDurations.find((leg) => leg.direction === 'OUTBOUND');
  const inboundMinutes = journey.legDurations.find((leg) => leg.direction === 'INBOUND');
  if (!outboundMinutes || !inboundMinutes) return { reason: 'a leg states no duration', id };

  const outbound = mapLeg(outboundSegments, outboundMinutes.duration.minutes, best.offer);
  const inbound = mapLeg(inboundSegments, inboundMinutes.duration.minutes, best.offer);
  if (!outbound || !inbound) return { reason: 'a segment time is not a local date-time', id };

  return {
    offer: {
      id: `${LITEAPI_FLIGHTS_ID}:${best.offer.offerId}`,
      providerId: LITEAPI_FLIGHTS_ID,
      outbound,
      inbound,
      price: best.price,
      observedAt,
      expiresAt: instantOrNull(best.offer.expiration),
    },
  };
}

/** The live fetch. One request per call; the caller wraps it in the shared limiter. */
export class LiteApiFlightsClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: LiteApiFlightsOptions) {
    if (!options.apiKey) {
      throw new AppError('CONFIGURATION_ERROR', 'The LiteAPI adapter needs LITEAPI_API_KEY.');
    }
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
  }

  /**
   * One `flights/rates` call for one route and pair of days. The offers are the cheapest first,
   * schema-checked and mapped. An empty list is a real answer (nothing flies), not a failure.
   */
  async fetchOffers(
    query: LiteApiFlightsQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly FlightOffer[]>> {
    const timeout = AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let body: unknown;
    try {
      const response = await this.fetchImpl(`${BASE_URL}/flights/rates`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({
          legs: [
            {
              origin: query.origin,
              destination: query.destination,
              date: query.departureDate,
              direction: 'OUTBOUND',
            },
            {
              origin: query.destination,
              destination: query.origin,
              date: query.returnDate,
              direction: 'INBOUND',
            },
          ],
          adults: query.adults,
          currency: query.currency.toUpperCase(),
          cabinClass: query.cabin.toUpperCase(),
          sort: { sortBy: 'price', sortOrder: 'asc' },
        }),
        signal,
      });
      if (!response.ok) {
        // Status only: never a header, never the key.
        log.warn({ status: response.status }, 'liteapi flights error status');
        const unavailable =
          response.status === 429 || response.status === 401 || response.status === 403;
        return err(
          new AppError(
            unavailable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
            `LiteAPI responded with ${response.status}.`,
          ),
        );
      }
      body = await response.json();
    } catch (cause) {
      const timedOut = timeout.aborted;
      return err(
        new AppError(
          timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
          timedOut ? 'LiteAPI did not respond in time.' : 'LiteAPI could not be reached.',
          { cause },
        ),
      );
    }

    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) {
      return err(
        new AppError('PROVIDER_ERROR', 'LiteAPI returned an unrecognised flights response.'),
      );
    }

    // The instant of this call, after the answer arrived.
    const observedAt = this.now().toISOString();
    const mapped: FlightOffer[] = [];
    let dropped = 0;
    for (const batch of envelope.data.data) {
      for (const journey of batch.journeys) {
        const result = mapJourney(journey, query.currency, observedAt);
        if ('offer' in result) mapped.push(result.offer);
        else dropped += 1;
      }
    }

    // The same check every provider's offers pass before they reach `src/core/`.
    const checked = validateOffers(flightOfferSchema, mapped);
    dropped += checked.rejected.length;
    if (dropped > 0) log.warn({ dropped }, 'liteapi flight journeys were dropped');

    const accepted = new Set(checked.accepted.map((offer) => offer.id));
    return ok(
      mapped
        .filter((offer) => accepted.has(offer.id))
        .sort((a, b) => a.price.amount - b.price.amount),
    );
  }
}
