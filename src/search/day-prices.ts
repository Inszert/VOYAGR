import { cacheKey, getCacheStore, readThrough, type CacheStore } from '@/cache';
import { localDate, addDays, daysBetween, datesBetween, addMonths } from '@/core/dates';
import { money } from '@/core/money';
import type { FlexDayPrice } from '@/core/flex-dates';
import type { FlightOffer, IsoDate, IsoDateTime } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { createLimiterPool, type LimiterPool } from '@/lib/concurrency';
import { getLogger } from '@/lib/logger';
import { isOk } from '@/lib/result';
import { concurrencyFor } from '@/providers/rate';
import { getProviderRegistry } from '@/providers/registry';
import type { FlightProvider } from '@/providers/types';

/**
 * The cheapest flight on each day of a month, through the cache.
 *
 * One loader behind both the price calendar and the flexible-dates strip, so a
 * month fetched for one is already in hand for the other and neither makes a
 * provider call the other has just made.
 *
 * **A day with no price is absent, not zero and not estimated.** Only days the
 * vendor actually has a flight on appear in `days`.
 *
 * **A failing provider degrades, it never throws.** The result then carries an
 * empty `days` and a `reason`, so the calendar stays usable with no prices.
 * A failure is thrown out of the cache loader so it is never stored as an
 * answer, exactly as the weather outlook does.
 */

const log = getLogger('search.day-prices');

/** Fresh for an hour, usable for a day more: how fast a cached fare calendar moves. */
export const DAY_PRICES_FRESH_MS = 60 * 60_000;
export const DAY_PRICES_STALE_MS = 24 * 60 * 60_000;

/** The same stay lengths the search's own calendar considers. */
export const DEFAULT_MIN_NIGHTS = 2;
export const DEFAULT_MAX_NIGHTS = 14;

/**
 * How long the stay is when a vendor must be asked about an exact pair of days
 * rather than a month. Only such vendors (the mock) use it.
 */
const EXACT_PAIR_NIGHTS = 4;

/** The ceiling the pool's limiter is sized under, before the vendor's own rate. */
const CONCURRENCY_CEILING = 4;

export interface DayPriceQuery {
  readonly origin: string;
  /** Never empty: "anywhere" is resolved by the caller to a bounded list of places. */
  readonly destinations: readonly string[];
  /** `YYYY-MM`. */
  readonly month: string;
  readonly currency: string;
  readonly passengers?: number;
  readonly minNights?: number;
  readonly maxNights?: number;
}

export interface DayPriceDeps {
  readonly flights?: FlightProvider;
  readonly store?: CacheStore;
  readonly pool?: LimiterPool;
  readonly now?: () => number;
  /** Days before this are dropped: a flight cannot be taken yesterday. */
  readonly today?: IsoDate;
}

export interface DayPriceEntry extends FlexDayPrice {
  /** The return that goes with the cheapest fare on this day. */
  readonly returnDate: IsoDate;
}

export interface MonthDayPrices {
  readonly month: string;
  readonly days: ReadonlyMap<IsoDate, DayPriceEntry>;
  /** When the cached answer was loaded; null when nothing is known. */
  readonly loadedAt: IsoDateTime | null;
  /** Why there are no (or stale) prices, in words a page can show. Null when fine. */
  readonly reason: string | null;
}

interface StoredDay {
  readonly amount: number;
  readonly currency: string;
  readonly returnDate: IsoDate;
  readonly observedAt: IsoDateTime | null;
}

type StoredMonth = Record<IsoDate, StoredDay>;

declare global {
  var __voyagrDayPricePool: LimiterPool | undefined;
}

function defaultPool(): LimiterPool {
  globalThis.__voyagrDayPricePool ??= createLimiterPool(CONCURRENCY_CEILING);
  return globalThis.__voyagrDayPricePool;
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function firstOf(month: string): IsoDate {
  return `${month}-01`;
}

/** The cheapest offer per departure day inside a month, within the stay bounds. */
function cheapestPerDay(
  offers: readonly FlightOffer[],
  month: string,
  minNights: number,
  maxNights: number,
  into: Map<IsoDate, StoredDay>,
): void {
  for (const offer of offers) {
    const out = offer.outbound.segments[0]?.departsAt;
    const back = offer.inbound.segments[0]?.departsAt;
    if (!out || !back) continue;

    const departure = localDate(out);
    const returnDate = localDate(back);
    const nights = daysBetween(departure, returnDate);

    if (!departure.startsWith(month) || nights < minNights || nights > maxNights) continue;

    const seen = into.get(departure);
    if (seen && seen.currency === offer.price.currency && seen.amount <= offer.price.amount) {
      continue;
    }

    // A second currency for one day is not comparable; the first one stays.
    if (seen && seen.currency !== offer.price.currency) continue;

    into.set(departure, {
      amount: offer.price.amount,
      currency: offer.price.currency,
      returnDate,
      observedAt: offer.observedAt ?? null,
    });
  }
}

async function fetchMonth(
  query: DayPriceQuery,
  flights: FlightProvider,
  pool: LimiterPool,
): Promise<StoredMonth> {
  const minNights = query.minNights ?? DEFAULT_MIN_NIGHTS;
  const maxNights = query.maxNights ?? DEFAULT_MAX_NIGHTS;
  const passengers = query.passengers ?? 1;

  const limiter = pool.for(
    flights.metadata.id,
    concurrencyFor(
      flights.metadata.rateLimitPerMinute,
      CONCURRENCY_CEILING,
      flights.metadata.typicalLatencyMs ?? null,
    ),
  );

  const found = new Map<IsoDate, StoredDay>();
  const failures: AppError[] = [];

  // One leaf call per request, each taking its own slot; the fan-out around
  // them takes none, so a task never holds a slot while waiting for another.
  const ask = async (destination: string, departureDate: IsoDate, returnDate: IsoDate) => {
    const result = await limiter.run(() =>
      flights.searchFlights({
        origins: [query.origin],
        destinations: [destination],
        departureDate,
        returnDate,
        passengers,
        currency: query.currency,
      }),
    );

    if (!isOk(result)) {
      failures.push(result.error);
      return;
    }

    cheapestPerDay(result.value.items, query.month, minNights, maxNights, found);
  };

  const first = firstOf(query.month);
  const nextMonth = addMonths(first, 1).slice(0, 7);
  const requests: Promise<void>[] = [];

  for (const destination of query.destinations) {
    if (flights.metadata.answersByMonth) {
      // Two questions, because the vendor filters the return by month too: a
      // trip leaving on the 30th and coming back on the 4th is in neither the
      // month's own return nor, with one question, anywhere at all.
      requests.push(ask(destination, first, `${query.month}-28`));
      requests.push(ask(destination, first, firstOf(nextMonth)));
    } else {
      // The stay asked about must be one the bounds accept: a strip that wants
      // exactly seven nights asked for four, and every answer was then dropped
      // for being the wrong length.
      const stay = Math.min(Math.max(EXACT_PAIR_NIGHTS, minNights), maxNights);
      for (const day of datesBetween(first, addDays(firstOf(nextMonth), -1))) {
        requests.push(ask(destination, day, addDays(day, stay)));
      }
    }
  }

  await Promise.all(requests);

  // Failing everywhere is a failure; failing for some places while others
  // answered is a month with fewer days, which the page can show as it is.
  if (found.size === 0 && failures.length > 0) throw failures[0];

  return Object.fromEntries(found);
}

/**
 * Prices for one month, from the cache or the provider.
 *
 * @throws never.
 */
export async function loadMonthDayPrices(
  query: DayPriceQuery,
  deps: DayPriceDeps = {},
): Promise<MonthDayPrices> {
  const empty = (reason: string): MonthDayPrices => ({
    month: query.month,
    days: new Map(),
    loadedAt: null,
    reason,
  });

  if (!isMonth(query.month)) return empty('That is not a month.');
  if (query.destinations.length === 0) return empty('No destination to price.');

  try {
    const flights = deps.flights ?? getProviderRegistry().flights;
    const store = deps.store ?? getCacheStore();
    const pool = deps.pool ?? defaultPool();
    const now = deps.now ?? Date.now;

    const read = await readThrough<StoredMonth>(
      store,
      cacheKey('flex', {
        provider: flights.metadata.id,
        origin: query.origin,
        destinations: [...query.destinations].sort(),
        month: query.month,
        currency: query.currency,
        passengers: query.passengers ?? 1,
        minNights: query.minNights ?? DEFAULT_MIN_NIGHTS,
        maxNights: query.maxNights ?? DEFAULT_MAX_NIGHTS,
      }),
      {
        freshMs: DAY_PRICES_FRESH_MS,
        staleMs: DAY_PRICES_STALE_MS,
        now,
        load: () => fetchMonth(query, flights, pool),
      },
    );

    if (read.value === null) {
      log.warn({ month: query.month, err: read.error }, 'day prices could not be loaded');
      return empty('Prices for this month could not be loaded.');
    }

    const days = new Map<IsoDate, DayPriceEntry>();
    for (const [day, stored] of Object.entries(read.value)) {
      if (deps.today && day < deps.today) continue;

      days.set(day, {
        price: money(stored.amount, stored.currency),
        observedAt: stored.observedAt,
        returnDate: stored.returnDate,
      });
    }

    return {
      month: query.month,
      days,
      loadedAt: read.observedAt,
      reason: read.error ? 'Showing earlier prices; they could not be refreshed.' : null,
    };
  } catch (error) {
    // Registry or store trouble is a missing price, never a broken page.
    log.warn({ month: query.month, err: error }, 'day prices unavailable');
    return empty('Prices for this month could not be loaded.');
  }
}
