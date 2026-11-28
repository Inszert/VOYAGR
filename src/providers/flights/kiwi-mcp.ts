import { z } from 'zod';
import { fromMajor } from '@/core/money';
import { addDays, daysInMonth, startOfMonth } from '@/core/dates';
import type {
  FlightLeg,
  FlightOffer,
  FlightSegment,
  IsoDate,
  LocalDateTime,
  OneWayFare,
} from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import { createMcpClient, type McpClient } from '../mcp/client';
import { MCP_DEFAULT_DAILY_BUDGET } from '../mcp/constants';
import type {
  FlightProvider,
  FlightSearchQuery,
  OneWayQuery,
  ProviderHealth,
  ProviderPage,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';

/**
 * Flights from the Kiwi.com MCP server, behind the flight adapter interface.
 *
 * What the recorded answer taught us (`src/providers/mcp/fixtures/`):
 *
 * - The answer is a JSON **text** inside the MCP content, not structured
 *   content. It is parsed here and every itinerary is schema-checked on its own,
 *   so one malformed itinerary is dropped and counted, never fatal.
 * - A one-way search has `inbound: null`. A `FlightOffer` is a round trip and
 *   needs both legs, so one-way itineraries become `OneWayFare`s through
 *   `searchOneWay`, and `searchFlights` drops an itinerary with no inbound
 *   (counted as `no_inbound`) rather than invent a return.
 * - Prices are in the currency the answer names (EUR), as a decimal number, and
 *   become integer minor units through `fromMajor`. The price is taken as the
 *   total for the party asked for (`adults`); that is an assumption the server
 *   does not document and is recorded in `docs/autonomous-run/DECISIONS.md`.
 * - Times are local clock faces with no zone. An answer that carries a zone is
 *   dropped, not converted: `core` forbids arithmetic across zones.
 * - `bookingUrl` is Kiwi's own short link. It is kept exactly as sent, as the
 *   deep link, after checking only that it is https on a kiwi.com host.
 * - Baggage counts are stated, so they fill the baggage fields. Self transfer is
 *   **not** stated: it is `true` only when the segments prove it (the next flight
 *   leaves from a different airport than the last one reached) and `null`
 *   otherwise. `false` would be a claim the answer does not support.
 *
 * Tests inject a fake MCP client; nothing here touches the network on its own.
 */

const log = getLogger('providers.kiwi-mcp');

export const KIWI_MCP_PROVIDER_ID = 'kiwi-mcp';

const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/;

const localTime = z.string().regex(LOCAL_TIME);
const airport = z.string().regex(/^[A-Z]{3}$/);

const segmentSchema = z.object({
  from: airport,
  to: airport,
  departureTime: localTime,
  arrivalTime: localTime,
  durationSeconds: z.number().int().positive(),
  carrier: z.string().min(1),
  flightNumber: z.string().min(1),
});

const legSchema = z.object({
  from: airport,
  to: airport,
  durationSeconds: z.number().int().positive(),
  stops: z.number().int().min(0).optional(),
  segments: z.array(segmentSchema).min(1),
});

const baggageSchema = z.object({
  personalItem: z.number().int().min(0),
  cabinBag: z.number().int().min(0),
  checkedBag: z.number().int().min(0),
});

const bookingUrl = z
  .string()
  .max(512)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        (url.hostname === 'kiwi.com' || url.hostname.endsWith('.kiwi.com'))
      );
    } catch {
      return false;
    }
  });

const itinerarySchema = z.object({
  id: z.string().min(1).max(256),
  price: z.number().positive().finite(),
  bookingUrl,
  baggage: baggageSchema.nullish(),
  outbound: legSchema,
  inbound: legSchema.nullish(),
});

const envelopeSchema = z.object({
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  itineraries: z.array(z.unknown()),
  error: z.unknown().optional(),
});

export type KiwiSkipReason = 'malformed' | 'unparsable_time' | 'inconsistent_route' | 'no_inbound';

export type KiwiDropCounts = Record<KiwiSkipReason, number>;

export function emptyDropCounts(): KiwiDropCounts {
  return { malformed: 0, unparsable_time: 0, inconsistent_route: 0, no_inbound: 0 };
}

type ParsedItinerary = z.infer<typeof itinerarySchema>;
type ParsedLeg = z.infer<typeof legSchema>;

function toLocal(value: string): LocalDateTime {
  const match = LOCAL_TIME.exec(value)!;
  return `${match[1]}T${match[2]}`;
}

/**
 * A leg, or the reason it cannot be one honestly.
 *
 * The first segment must leave where the leg says and the last must arrive where
 * it says; otherwise the answer contradicts itself and nothing is guessed.
 */
function mapLeg(leg: ParsedLeg, baggage: ParsedItinerary['baggage']): FlightLeg | KiwiSkipReason {
  const first = leg.segments[0]!;
  const last = leg.segments[leg.segments.length - 1]!;
  if (first.from !== leg.from || last.to !== leg.to) return 'inconsistent_route';

  const segments: FlightSegment[] = leg.segments.map((s) => ({
    origin: s.from,
    destination: s.to,
    departsAt: toLocal(s.departureTime),
    arrivesAt: toLocal(s.arrivalTime),
    carrier: s.carrier,
    flightNumber: s.flightNumber,
  }));

  // Proof of separate tickets: the next flight leaves from another airport.
  const airportChange = leg.segments.some((s, i) => i > 0 && s.from !== leg.segments[i - 1]!.to);

  return {
    segments,
    durationMinutes: Math.round(leg.durationSeconds / 60),
    cabinBaggageIncluded: baggage ? baggage.cabinBag > 0 : null,
    checkedBaggageIncluded: baggage ? baggage.checkedBag > 0 : null,
    selfTransfer: airportChange ? true : null,
  };
}

/** Why the shape failed: a time with a zone is its own reason, everything else is `malformed`. */
function skipReasonFor(raw: unknown): KiwiSkipReason {
  const text = JSON.stringify(raw) ?? '';
  return /"(?:departureTime|arrivalTime)":"[^"]*(?:Z|[+-]\d{2}:?\d{2})"/.test(text)
    ? 'unparsable_time'
    : 'malformed';
}

type Mapped<T> = { readonly value: T } | { readonly skipped: KiwiSkipReason };

/** One itinerary as a return trip offer. */
export function mapReturnItinerary(
  raw: unknown,
  currency: string,
  observedAt: string,
): Mapped<FlightOffer> {
  const parsed = itinerarySchema.safeParse(raw);
  if (!parsed.success) return { skipped: skipReasonFor(raw) };
  const it = parsed.data;
  if (!it.inbound) return { skipped: 'no_inbound' };

  const outbound = mapLeg(it.outbound, it.baggage);
  const inbound = mapLeg(it.inbound, it.baggage);
  if (typeof outbound === 'string') return { skipped: outbound };
  if (typeof inbound === 'string') return { skipped: inbound };

  return {
    value: {
      id: `${KIWI_MCP_PROVIDER_ID}:${it.id}`,
      providerId: KIWI_MCP_PROVIDER_ID,
      outbound,
      inbound,
      price: fromMajor(it.price, currency.toUpperCase()),
      observedAt,
      expiresAt: null,
      deepLink: it.bookingUrl,
    },
  };
}

/** One itinerary as a single flight. */
export function mapOneWayItinerary(
  raw: unknown,
  currency: string,
  observedAt: string,
): Mapped<OneWayFare> {
  const parsed = itinerarySchema.safeParse(raw);
  if (!parsed.success) return { skipped: skipReasonFor(raw) };
  const it = parsed.data;

  const leg = mapLeg(it.outbound, it.baggage);
  if (typeof leg === 'string') return { skipped: leg };

  return {
    value: {
      id: `${KIWI_MCP_PROVIDER_ID}:${it.id}:one-way`,
      providerId: KIWI_MCP_PROVIDER_ID,
      leg,
      price: fromMajor(it.price, currency.toUpperCase()),
      observedAt,
      deepLink: it.bookingUrl,
    },
  };
}

export interface ParsedSearch<T> {
  readonly items: T[];
  readonly dropped: KiwiDropCounts;
}

/**
 * The text of a `search-flight` answer, as items and a count of what was dropped.
 * Pure: the same text gives the same answer. `{ failed }` when the text is not an answer at all.
 */
export function parseSearchFlight<T>(
  text: string,
  observedAt: string,
  map: (raw: unknown, currency: string, observedAt: string) => Mapped<T>,
): ParsedSearch<T> | { readonly failed: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { failed: 'not_json' };
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return { failed: 'unrecognised' };

  const { currency, itineraries, error } = envelope.data;
  if (itineraries.length === 0 && typeof error === 'string' && error.length > 0) {
    return { failed: 'server_error' };
  }

  const items: T[] = [];
  const dropped = emptyDropCounts();
  for (const raw of itineraries) {
    const mapped = map(raw, currency, observedAt);
    if ('value' in mapped) items.push(mapped.value);
    else dropped[mapped.skipped] += 1;
  }
  return { items, dropped };
}

/** `2026-12-15` as the `15/12/2026` the server asks for. String work: no `Date`. */
export function toKiwiDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export interface KiwiMcpOptions {
  readonly client?: McpClient;
  /** Calls per UTC day, from `KIWI_MCP_DAILY_BUDGET`. */
  readonly dailyBudget?: number;
  readonly now?: () => Date;
}

const METADATA = {
  id: KIWI_MCP_PROVIDER_ID,
  kind: 'flights',
  displayName: 'Kiwi.com',
  isMock: false,
  mode: 'live',
  // About one call a second, by our own pacing; Kiwi publishes no limit.
  rateLimitPerMinute: 60,
  typicalLatencyMs: null,
} as const;

export class KiwiMcpFlightProvider implements FlightProvider {
  readonly metadata = METADATA;

  private readonly client: McpClient;
  private readonly now: () => Date;

  constructor(options: KiwiMcpOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.client =
      options.client ??
      createMcpClient({ dailyBudget: options.dailyBudget ?? MCP_DEFAULT_DAILY_BUDGET });
  }

  async checkHealth(_options?: ProviderRequestOptions): Promise<ProviderHealth> {
    // A probe would spend the daily budget. Reporting configuration is the honest answer.
    return {
      status: 'healthy',
      checkedAt: this.now().toISOString(),
      latencyMs: null,
      message: 'Configured. No probe call made: it would spend the daily call budget.',
    };
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

    const result = await this.search(
      {
        flyFrom: query.origins.join(','),
        flyTo: query.destinations.join(','),
        departureDate: toKiwiDate(query.departureDate),
        returnDate: toKiwiDate(query.returnDate),
        adults: query.passengers,
        currency: query.currency.toUpperCase(),
        sort: 'price',
        ...(query.directOnly ? { max_sector_stopovers: 0 } : {}),
      },
      mapReturnItinerary,
      options,
    );
    if (!result.ok) return result;

    return ok({
      items: result.value.slice(0, query.maxResults ?? result.value.length),
      nextCursor: null,
    });
  }

  async searchOneWay(
    query: OneWayQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly OneWayFare[]>> {
    const first = startOfMonth(`${query.month}-01`);
    const last = addDays(first, daysInMonth(first) - 1);

    return this.search(
      {
        flyFrom: query.origin,
        flyTo: query.destination,
        departureDate: toKiwiDate(first),
        departureDateTo: toKiwiDate(last),
        adults: query.passengers,
        currency: query.currency.toUpperCase(),
        sort: 'price',
      },
      mapOneWayItinerary,
      options,
    );
  }

  private async search<T>(
    args: Record<string, unknown>,
    map: (raw: unknown, currency: string, observedAt: string) => Mapped<T>,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<T[]>> {
    if (options?.signal?.aborted) {
      return err(new AppError('PROVIDER_TIMEOUT', 'The flight search was cancelled.'));
    }

    const called = await this.client.callTool('search-flight', args);
    if (!called.ok) return err(called.error);

    const parsed = parseSearchFlight(called.value.text, this.now().toISOString(), map);
    if ('failed' in parsed) {
      log.warn({ reason: parsed.failed }, 'kiwi answer not usable');
      return err(new AppError('PROVIDER_ERROR', 'Kiwi returned an unrecognised response.'));
    }

    const droppedTotal = Object.values(parsed.dropped).reduce((a, b) => a + b, 0);
    if (droppedTotal > 0) {
      log.info({ ...parsed.dropped, kept: parsed.items.length }, 'kiwi itineraries not mapped');
    }
    return ok(parsed.items);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function createKiwiMcpFlightProvider(options: KiwiMcpOptions = {}): KiwiMcpFlightProvider {
  return new KiwiMcpFlightProvider(options);
}
