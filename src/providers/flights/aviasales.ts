import { z } from 'zod';
import { fromMajor } from '@/core/money';
import { forParty } from '@/core/party';
import type {
  FlightOffer,
  IsoDate,
  IsoDateTime,
  LocalDateTime,
  OneWayFare,
} from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type { FetchLike } from '../http/types';
import { redactUrl } from '../http/redact';
import type {
  DayFare,
  FlightProvider,
  FlightSearchQuery,
  MonthFareQuery,
  MonthFareSource,
  OneWayQuery,
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
 *   Nor is there an arrival time, so `arrivesAt` is `null` too.
 * - **A price is for one adult.** The cache is of other people's searches,
 *   and the link the vendor builds for every row ends in the passenger count
 *   - `/search/VIE0112FCO1` - which is `1` on every row recorded. A
 *   `FlightOffer` is priced for the whole party, so the fare is multiplied out
 *   by `forParty`, exactly; it was once passed through as the party's total,
 *   which priced four travellers' flights as one.
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

/**
 * The Travelpayouts Data API throttles per token: 600 calls per rolling
 * window, answered with a bare `429 Too Many Requests` (text/plain) and the
 * headers `x-rate-limit`, `x-rate-limit-remaining` and `x-rate-limit-reset`
 * (seconds until the window frees up). Measured against the live API, the
 * reset on a 429 ranged from about 7 to 55 seconds.
 *
 * A 429 whose reset is short is waited out once. A longer one is returned
 * as it came, so the search degrades and says so rather than stalling for
 * most of a minute. The wait is the vendor's own number, never a guess.
 */
const RATE_LIMIT_MAX_WAIT_SECONDS = 8;

/** The pause when a 429 carries no reset header, and the longest pause ever held. */
export const RATE_LIMIT_DEFAULT_PAUSE_SECONDS = 10;
export const RATE_LIMIT_MAX_PAUSE_SECONDS = 60;

/**
 * One pause per process, for the vendor as a whole.
 *
 * A 429 means the token's window is spent for every caller, not only the one
 * that heard it. Without this, each queued call went on to ask and be refused,
 * which kept the window spent. While paused, a call makes no network request
 * and fails at once as `PROVIDER_UNAVAILABLE`, without a retry.
 *
 * Per process: web and worker each hold their own. A pause shared between them
 * would need Redis and is a known limit.
 */
interface AviasalesPause {
  until: number;
  startedAt: number;
  /** Calls refused without a network request during this pause. */
  skipped: number;
}

declare global {
  var __voyagrAviasalesPause: AviasalesPause | null | undefined;
}

/** Clears the pause. For tests; nothing in the product calls it. */
export function resetAviasalesPause(): void {
  globalThis.__voyagrAviasalesPause = null;
}

/** The pause if one is active at `at`; an ended one is logged and cleared. */
function activePause(at: number): AviasalesPause | null {
  const pause = globalThis.__voyagrAviasalesPause;
  if (!pause) return null;
  if (at < pause.until) return pause;

  log.info(
    { pausedSeconds: Math.round((at - pause.startedAt) / 1000), skippedCalls: pause.skipped },
    'aviasales pause ended, calls resume',
  );
  globalThis.__voyagrAviasalesPause = null;
  return null;
}

function startPause(at: number, seconds: number): void {
  const until = at + seconds * 1000;
  const existing = globalThis.__voyagrAviasalesPause;
  if (existing) {
    existing.until = Math.max(existing.until, until);
    return;
  }
  globalThis.__voyagrAviasalesPause = { until, startedAt: at, skipped: 0 };
  log.warn({ pauseSeconds: seconds }, 'aviasales pause started, calls fail without a request');
}

async function fetchHonouringRateLimit(
  doFetch: FetchLike,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const paused = activePause(now());
  if (paused) {
    paused.skipped += 1;
    // No request is made. A 429 is what every caller already maps to
    // `PROVIDER_UNAVAILABLE`, and it is not retried.
    return new Response(null, { status: 429 });
  }

  const response = await doFetch(url, init);
  if (response.status !== 429) return response;

  const header = response.headers.get('x-rate-limit-reset');
  const reset = Number(header);
  const known = header !== null && Number.isFinite(reset);
  log.warn(
    {
      limit: response.headers.get('x-rate-limit'),
      remaining: response.headers.get('x-rate-limit-remaining'),
      resetSeconds: known ? reset : null,
    },
    'aviasales rate limited',
  );
  const waitable = known && reset <= RATE_LIMIT_MAX_WAIT_SECONDS && !init?.signal?.aborted;
  if (!waitable) {
    startPause(
      now(),
      Math.min(RATE_LIMIT_MAX_PAUSE_SECONDS, known ? reset : RATE_LIMIT_DEFAULT_PAUSE_SECONDS),
    );
    return response;
  }

  await sleep(Math.max(1, reset) * 1000 + 250);
  // Another call may have paused the vendor while this one slept.
  if (activePause(now())) return new Response(null, { status: 429 });

  const retry = await doFetch(url, init);
  if (retry.status === 429) {
    const again = Number(retry.headers.get('x-rate-limit-reset'));
    startPause(
      now(),
      Math.min(
        RATE_LIMIT_MAX_PAUSE_SECONDS,
        retry.headers.get('x-rate-limit-reset') !== null && Number.isFinite(again)
          ? again
          : RATE_LIMIT_DEFAULT_PAUSE_SECONDS,
      ),
    );
  }
  return retry;
}

export interface AviasalesOptions {
  readonly token: string;
  /** Defaults to `dates`, so behaviour is unchanged unless asked for. */
  readonly window?: AviasalesWindow;
  /** Affiliate marker. Public; used only to build the outbound link. */
  readonly partnerId?: string;
  readonly fetchImpl?: FetchLike;
  /** Injectable so a test does not really wait out a rate-limit window. */
  readonly sleep?: (ms: number) => Promise<void>;
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
 * A connecting price point names the airline and the total duration but never
 * the connection. It becomes an offer whose leg states its connection count
 * (`connectionsStated`) without a segment list invented to fill the gap - that
 * would be a fabricated itinerary shown to a traveller.
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
  /** The party the offer is for. The vendor's fare is for one of them. */
  passengers = 1,
): { offer: FlightOffer } | { skipped: SkipReason } {
  const parsed = priceSchema.safeParse(raw);
  if (!parsed.success) return { skipped: 'malformed' };

  const price = parsed.data;

  const departsAt = toLocalDateTime(price.departure_at);
  const returnsAt = toLocalDateTime(price.return_at);
  if (!departsAt || !returnsAt) return { skipped: 'unparsable_time' };

  const flightNumber = `${price.airline}${price.flight_number}`;

  /*
   * The arrival is not in the response. The departure plus the stated
   * duration would be arithmetic on a wall clock across two time zones,
   * which is exactly what `core/dates.ts` exists to forbid, so the arrival is
   * `null`: unknown. (It was once set equal to the departure, and a card then
   * printed "06:10 VIE -> 06:10 FCO" for a 1h 45m flight.)
   * `FlightLeg.durationMinutes` carries the real figure.
   */
  const leg = (
    from: string,
    to: string,
    at: LocalDateTime,
    minutes: number,
    connections: number,
  ) => ({
    /*
     * A connecting price point counts its stops but never names them, so the
     * leg is one segment for the whole journey plus the stated count. No
     * connection airport is invented; the card says "1 stop" and stops there.
     * The flight number is the first flight's, which is all the vendor gives.
     */
    ...(connections > 0 ? { connectionsStated: connections } : {}),
    segments: [
      {
        origin: from,
        destination: to,
        departsAt: at,
        arrivesAt: null,
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
      outbound: leg(from, to, departsAt, price.duration_to, price.transfers),
      inbound: leg(to, from, returnsAt, price.duration_back, price.return_transfers),
      // `fromMajor`, never a float: the vendor quotes whole currency units,
      // for one adult; `forParty` makes it the party's total, exactly.
      price: forParty(fromMajor(price.price, currency), passengers),
      observedAt: observedFromLink(price.link, observedAt),
      // Cached prices come with no promise of how long they hold.
      expiresAt: null,
      ...(price.link ? { deepLink: `https://www.aviasales.com${price.link}` } : {}),
    } as FlightOffer,
  };
}

/*
 * --- Single days of a month, for the calendar ---------------------------
 *
 * `prices_for_dates` asked for a month answers with whole round trips, and
 * only on the days somebody happened to search a return. Measured for
 * VIE-FCO in December 2026 (`tests/fixtures/providers/aviasales-day-coverage-vie-fco.json`):
 * 16 departure days with a return of 2 to 14 nights. Three further questions
 * are asked here, each recorded in that cassette:
 *
 *  - `prices_for_dates` with `one_way=true`: the cheapest single flight out on
 *    each day, airport by airport - 30 of 31 days, 15 of them days with no
 *    return fare at all. A one-way fare is never a return price: it becomes a
 *    `DayFare` with `returnDate: null`, and the page labels it "one way from".
 *  - `v1/prices/calendar` (documented: "Tickets for each day of a month"),
 *    asked by departure day with returns in the month.
 *  - `v2/prices/latest` (documented: the latest prices found), asked for the
 *    month.
 *
 * The last two answer **by city**, not by airport: asked for FCO they reply
 * for ROM, which includes Ciampino. A Ciampino fare is not a Fiumicino fare,
 * so their rows are kept only where the city they name is the code that was
 * asked (VIE, KZN) and dropped - counted, not guessed at - where it is not.
 * `v2/prices/month-matrix` is documented too, but answered only one-way fares
 * by city, which the airport-level one-way question already covers.
 *
 * Every fare here is for one adult, like every price this API serves, and is
 * multiplied out for the party by `forParty`.
 */

const DATA_API = 'https://api.travelpayouts.com';

const dayPrefix = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

/** A `prices_for_dates` row as a day fare: the same fields, the return optional. */
const v3DayRow = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  origin_airport: z.string().length(3).optional(),
  destination_airport: z.string().length(3).optional(),
  departure_at: dayPrefix,
  return_at: dayPrefix.optional(),
  price: z.number().positive().finite(),
  link: z.string().optional(),
});

/** `v1/prices/calendar`: `data` is keyed by day. */
const v1CalendarRow = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  departure_at: dayPrefix,
  return_at: dayPrefix.optional(),
  price: z.number().positive().finite(),
});

/** `v2/prices/latest`: `return_date` is `""` for a one-way fare. */
const v2LatestRow = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  depart_date: dayPrefix,
  return_date: z.string(),
  value: z.number().positive().finite(),
  found_at: z.string().optional(),
});

const dayEnvelope = z.object({
  success: z.boolean().optional(),
  currency: z.string().length(3).optional(),
  data: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
});

/** An instant only when it says which zone it is in; otherwise unknown. */
function instantOrNull(value: string | undefined): IsoDateTime | null {
  if (!value || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** The airport asked for, or its city when the city is what was asked. */
function sameEnd(asked: string, city: string, airport: string | undefined): boolean {
  return airport === asked || city === asked;
}

export interface DayRowsOutcome {
  readonly fares: DayFare[];
  /** Rows that failed the schema or priced another airport. Counted, never silent. */
  readonly dropped: number;
}

export type DayRowReader = (
  raw: unknown,
  query: MonthFareQuery,
  currency: string,
  fetchedAt: IsoDateTime,
) => DayFare | 'drop';

export const readV3DayRow: DayRowReader = (raw, query, currency, fetchedAt) => {
  const row = v3DayRow.safeParse(raw);
  if (!row.success) return 'drop';
  const r = row.data;
  if (!sameEnd(query.origin, r.origin, r.origin_airport)) return 'drop';
  if (!sameEnd(query.destination, r.destination, r.destination_airport)) return 'drop';

  const observed = observedFromLink(r.link, fetchedAt);
  return {
    departureDate: r.departure_at.slice(0, 10),
    returnDate: r.return_at ? r.return_at.slice(0, 10) : null,
    price: forParty(fromMajor(r.price, currency), query.passengers),
    // `observedFromLink` falls back to the fetch, which is not when the
    // vendor saw the fare; that fallback is reported as unknown here.
    observedAt: observed === fetchedAt ? null : observed,
  };
};

export const readV1CalendarRow: DayRowReader = (raw, query, currency) => {
  const row = v1CalendarRow.safeParse(raw);
  if (!row.success) return 'drop';
  const r = row.data;
  if (r.origin !== query.origin || r.destination !== query.destination) return 'drop';

  return {
    departureDate: r.departure_at.slice(0, 10),
    returnDate: r.return_at ? r.return_at.slice(0, 10) : null,
    price: forParty(fromMajor(r.price, currency), query.passengers),
    // The calendar says when a price expires, never when it was found.
    observedAt: null,
  };
};

export const readV2LatestRow: DayRowReader = (raw, query, currency) => {
  const row = v2LatestRow.safeParse(raw);
  if (!row.success) return 'drop';
  const r = row.data;
  if (r.origin !== query.origin || r.destination !== query.destination) return 'drop';

  return {
    departureDate: r.depart_date.slice(0, 10),
    returnDate: /^\d{4}-\d{2}-\d{2}/.test(r.return_date) ? r.return_date.slice(0, 10) : null,
    price: forParty(fromMajor(r.value, currency), query.passengers),
    // Sent without a zone in the recording, which makes it no instant at all.
    observedAt: instantOrNull(r.found_at),
  };
};

interface DayQuestion {
  readonly id: string;
  readonly url: (query: MonthFareQuery) => URL;
  readonly read: DayRowReader;
}

const DAY_QUESTIONS: readonly DayQuestion[] = [
  {
    id: 'aviasales.prices_for_dates.one_way',
    url: (q) => {
      const url = new URL('/aviasales/v3/prices_for_dates', DATA_API);
      url.searchParams.set('origin', q.origin);
      url.searchParams.set('destination', q.destination);
      url.searchParams.set('departure_at', q.month);
      url.searchParams.set('one_way', 'true');
      url.searchParams.set('currency', q.currency.toLowerCase());
      url.searchParams.set('unique', 'false');
      url.searchParams.set('sorting', 'price');
      url.searchParams.set('limit', '1000');
      url.searchParams.set('direct', 'false');
      return url;
    },
    read: readV3DayRow,
  },
  {
    id: 'aviasales.prices.calendar',
    url: (q) => {
      const url = new URL('/v1/prices/calendar', DATA_API);
      url.searchParams.set('origin', q.origin);
      url.searchParams.set('destination', q.destination);
      url.searchParams.set('depart_date', q.month);
      url.searchParams.set('return_date', q.month);
      url.searchParams.set('calendar_type', 'departure_date');
      url.searchParams.set('currency', q.currency.toLowerCase());
      return url;
    },
    read: readV1CalendarRow,
  },
  {
    id: 'aviasales.prices.latest',
    url: (q) => {
      const url = new URL('/v2/prices/latest', DATA_API);
      url.searchParams.set('origin', q.origin);
      url.searchParams.set('destination', q.destination);
      url.searchParams.set('period_type', 'month');
      url.searchParams.set('beginning_of_period', `${q.month}-01`);
      url.searchParams.set('one_way', 'false');
      url.searchParams.set('currency', q.currency.toLowerCase());
      url.searchParams.set('limit', '1000');
      url.searchParams.set('show_to_affiliates', 'true');
      url.searchParams.set('sorting', 'price');
      return url;
    },
    read: readV2LatestRow,
  },
];

/** Every row of a day answer, whichever envelope the endpoint uses; null for an unrecognised body. */
export function readDayRows(
  body: unknown,
  query: MonthFareQuery,
  read: DayRowReader,
  fetchedAt: IsoDateTime,
): DayRowsOutcome | null {
  const parsed = dayEnvelope.safeParse(body);
  if (!parsed.success) return null;

  const currency = parsed.data.currency?.toUpperCase() ?? query.currency.toUpperCase();
  const rows = Array.isArray(parsed.data.data) ? parsed.data.data : Object.values(parsed.data.data);

  const fares: DayFare[] = [];
  let dropped = 0;
  for (const raw of rows) {
    const fare = read(raw, query, currency, fetchedAt);
    if (fare === 'drop') dropped += 1;
    else fares.push(fare);
  }
  return { fares, dropped };
}

/*
 * --- Single flights, for trips built from two one-way tickets -------------
 *
 * The same one-way question the calendar asks, read as flights rather than as
 * day prices. Measured for VIE-KZN in November 2026 (by the search's own
 * debugging): two round-trip rows for the month, against single flights on 13
 * outbound days and 8 return days. Recorded for VIE-FCO in
 * `aviasales-day-coverage-vie-fco.json`.
 */
const oneWayRow = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  origin_airport: z.string().length(3).optional(),
  destination_airport: z.string().length(3).optional(),
  departure_at: z.string().min(1),
  airline: z.string().min(1),
  flight_number: z.union([z.string(), z.number()]),
  price: z.number().positive().finite(),
  transfers: z.number().int().min(0),
  duration_to: z.number().int().positive().optional(),
  duration: z.number().int().positive().optional(),
  link: z.string().optional(),
});

/** One recorded one-way row as a `OneWayFare`, or why not. Counted, never silent. */
export function mapOneWay(
  raw: unknown,
  query: OneWayQuery,
  currency: string,
  fetchedAt: IsoDateTime,
  providerId: string,
): OneWayFare | 'malformed' | 'other_airport' {
  const parsed = oneWayRow.safeParse(raw);
  if (!parsed.success) return 'malformed';
  const r = parsed.data;

  const from = r.origin_airport ?? r.origin;
  const to = r.destination_airport ?? r.destination;
  if (!sameEnd(query.origin, r.origin, r.origin_airport)) return 'other_airport';
  if (!sameEnd(query.destination, r.destination, r.destination_airport)) return 'other_airport';

  const departsAt = toLocalDateTime(r.departure_at);
  const minutes = r.duration_to ?? r.duration;
  if (!departsAt || !minutes) return 'malformed';

  const flightNumber = `${r.airline}${r.flight_number}`;
  return {
    id: `${providerId}:${from}-${to}:${r.departure_at}:${flightNumber}:one-way`,
    providerId,
    leg: {
      ...(r.transfers > 0 ? { connectionsStated: r.transfers } : {}),
      segments: [
        {
          origin: from,
          destination: to,
          departsAt,
          // Not in the response, and not derivable without the destination's zone.
          arrivesAt: null,
          carrier: r.airline,
          flightNumber,
        },
      ],
      durationMinutes: minutes,
      cabinBaggageIncluded: null,
      checkedBaggageIncluded: null,
      selfTransfer: null,
    },
    // For one adult, like every price here; the party's total exactly.
    price: forParty(fromMajor(r.price, currency), query.passengers),
    observedAt: observedFromLink(r.link, fetchedAt),
    ...(r.link ? { deepLink: `https://www.aviasales.com${r.link}` } : {}),
  };
}

const BASE_METADATA = {
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

export class AviasalesFlightProvider implements FlightProvider {
  /**
   * Set in the constructor: whether the vendor is asked a month at a time is a
   * property of how this instance was built, which a field initializer could
   * not read yet.
   */
  readonly metadata: typeof BASE_METADATA & { readonly answersByMonth: boolean };

  private readonly token: string;
  private readonly window: AviasalesWindow;
  private readonly partnerId: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  /** See "Single days of a month" above. Each is one leaf call. */
  readonly monthFareSources: readonly MonthFareSource[];

  constructor(options: AviasalesOptions) {
    if (!options.token) {
      throw new AppError('CONFIGURATION_ERROR', 'Aviasales provider needs AVIASALES_API_TOKEN.');
    }

    this.token = options.token;
    this.window = options.window ?? 'dates';
    this.metadata = { ...BASE_METADATA, answersByMonth: this.window === 'calendar' };
    this.partnerId = options.partnerId;
    const rawFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = (url, init) =>
      fetchHonouringRateLimit(rawFetch, sleep, () => this.now().getTime(), url, init);
    this.monthFareSources = DAY_QUESTIONS.map((question) => ({
      id: question.id,
      fetch: (query: MonthFareQuery, requestOptions?: ProviderRequestOptions) =>
        this.askDays(question, query, requestOptions),
    }));
  }

  /** Single flights one way for a month: one call, rows schema-checked, never a throw. */
  async searchOneWay(
    query: OneWayQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly OneWayFare[]>> {
    const url = DAY_QUESTIONS[0]!.url(query);
    url.searchParams.set('token', this.token);
    if (this.partnerId) url.searchParams.set('marker', this.partnerId);
    const href = url.toString();

    try {
      const response = await this.fetchImpl(href, {
        headers: { Accept: 'application/json' },
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      if (!response.ok) {
        log.warn(
          { status: response.status, url: redactUrl(href) },
          'aviasales one-way error status',
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

      const currency = body.data.currency?.toUpperCase() ?? query.currency.toUpperCase();
      const fetchedAt = this.now().toISOString();
      const fares: OneWayFare[] = [];
      let dropped = 0;
      for (const raw of body.data.data) {
        const fare = mapOneWay(raw, query, currency, fetchedAt, this.metadata.id);
        if (typeof fare === 'string') dropped += 1;
        else fares.push(fare);
      }
      if (dropped > 0) log.info({ dropped, kept: fares.length }, 'aviasales one-way rows not used');
      return ok(fares);
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      log.warn({ err: error, url: redactUrl(href) }, 'aviasales one-way request failed');
      return err(
        new AppError(
          aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          aborted ? 'Aviasales did not answer in time.' : 'Aviasales could not be reached.',
        ),
      );
    }
  }

  /** One day question: one call, its rows schema-checked, never a throw. */
  private async askDays(
    question: DayQuestion,
    query: MonthFareQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly DayFare[]>> {
    const url = question.url(query);
    url.searchParams.set('token', this.token);
    if (this.partnerId) url.searchParams.set('marker', this.partnerId);
    const href = url.toString();

    try {
      const response = await this.fetchImpl(href, {
        headers: { Accept: 'application/json' },
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (!response.ok) {
        log.warn(
          { status: response.status, url: redactUrl(href), source: question.id },
          'aviasales day prices responded with an error status',
        );
        return err(
          new AppError(
            response.status === 429 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
            `Aviasales responded with ${response.status}.`,
          ),
        );
      }

      const read = readDayRows(
        await response.json(),
        query,
        question.read,
        this.now().toISOString(),
      );
      if (!read) {
        return err(new AppError('PROVIDER_ERROR', 'Aviasales returned an unrecognised response.'));
      }
      if (read.dropped > 0) {
        log.info(
          { source: question.id, dropped: read.dropped, kept: read.fares.length },
          'aviasales day rows not used',
        );
      }
      return ok(read.fares);
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      log.warn(
        { err: error, url: redactUrl(href), source: question.id },
        'aviasales day request failed',
      );
      return err(
        new AppError(
          aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
          aborted ? 'Aviasales did not answer in time.' : 'Aviasales could not be reached.',
        ),
      );
    }
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

    /*
     * Several destinations in a month-at-a-time search are asked as one
     * question: "the cheapest flight from here to everywhere". The vendor
     * answers it with one row per destination - its cheapest, with the real
     * days it flies - which is exactly what a map of prices needs, in one call
     * instead of one per place. The rows are then kept to the destinations
     * that were asked about.
     */
    const anywhere = this.window === 'calendar' && query.destinations.length > 1;
    const wanted = new Set(query.destinations.map((code) => code.toUpperCase()));
    const url = this.buildUrl(origin, anywhere ? null : destination, query);

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
        const mapped = mapOffer(raw, currency, observedAt, this.metadata.id, query.passengers);

        if ('offer' in mapped) {
          const arrival = mapped.offer.outbound.segments.at(-1)?.destination.toUpperCase();
          if (anywhere && (!arrival || !wanted.has(arrival))) continue;
          offers.push(mapped.offer);
        } else skipped[mapped.skipped] += 1;
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
  private buildUrl(origin: string, destination: string | null, query: FlightSearchQuery): string {
    const url = new URL(BASE_URL);

    url.searchParams.set('origin', origin);
    // No destination means "everywhere": one cheapest row per destination.
    if (destination) url.searchParams.set('destination', destination);
    else url.searchParams.set('unique', 'true');

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
    if (destination) url.searchParams.set('unique', 'false');
    url.searchParams.set('sorting', 'price');
    // A month holds many day pairs and the assembler keeps only those matching a
    // window, so the cheapest few would crowd the right ones out. Ask for all.
    url.searchParams.set(
      'limit',
      String(this.window === 'calendar' ? 1000 : Math.min(query.maxResults ?? 30, 1000)),
    );
    // Connecting fares are mapped too (see `mapOffer`), so do not exclude them.
    url.searchParams.set('direct', 'false');
    url.searchParams.set('token', this.token);

    if (this.partnerId) url.searchParams.set('marker', this.partnerId);

    return url.toString();
  }
}

export function createAviasalesFlightProvider(options: AviasalesOptions): FlightProvider {
  return new AviasalesFlightProvider(options);
}
