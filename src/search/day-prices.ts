import { cacheKey, getCacheStore, readThrough, type CacheStore } from '@/cache';
import { localDate, addDays, daysBetween, datesBetween, addMonths } from '@/core/dates';
import { money, type Money } from '@/core/money';
import type { FlexDayPrice } from '@/core/flex-dates';
import type { FlightOffer, IsoDate, IsoDateTime } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import type { LimiterPool } from '@/lib/concurrency';
import { sharedVendorLimiters } from '@/providers/limiters';
import { FixedWindowLimiter } from '@/lib/fixed-window';
import { getLogger } from '@/lib/logger';
import { isOk } from '@/lib/result';
import { concurrencyFor } from '@/providers/rate';
import { getProviderRegistry } from '@/providers/registry';
import type { DayFare, FlightProvider, MonthFareSource } from '@/providers/types';
import { MAX_RETURN_OPTIONS } from './day-prices-json';

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
 * **Every figure is for the whole party**, and the party is in the cache key.
 * A vendor that can price single days some other way (`monthFareSources`) is
 * asked those questions too, each through the same limiter; per day the
 * cheapest fare wins and keeps its own observed time. One-way fares go into
 * `oneWay`, never into `days`.
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

/**
 * How many months of provider loads one process will start per minute.
 *
 * The cache absorbs repeats, but a caller who varies the query (another
 * origin, another month, another currency) misses it every time, and each miss
 * is a burst of vendor calls. The concurrency limiter bounds how many run at
 * once, not how many are queued behind them, so on its own it lets a flood
 * grow a queue and burn the vendor's rate allowance for every user. This is the
 * ceiling on cost: past it a month simply reports that it could not be loaded.
 * Cache hits do not count. A real session needs a handful a minute.
 */
export const DAY_PRICE_LOADS_PER_MINUTE = 120;

declare global {
  var __voyagrDayPriceBudget: FixedWindowLimiter | undefined;
}

function admitFromSharedBudget(): boolean {
  globalThis.__voyagrDayPriceBudget ??= new FixedWindowLimiter({
    max: DAY_PRICE_LOADS_PER_MINUTE,
    windowMs: 60_000,
    maxKeys: 1,
  });
  return globalThis.__voyagrDayPriceBudget.take('loads').allowed;
}

export interface DayPriceDeps {
  /**
   * Asked before a cache miss goes to the provider. Defaults to the shared
   * per-process budget; a caller that injects its own `store` (a test) gets no
   * budget unless it passes one.
   */
  readonly admit?: () => boolean;
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

/** The cheapest single flight out on a day: never a return price. */
export interface OneWayEntry {
  readonly price: Money;
  readonly observedAt: IsoDateTime | null;
}

export interface MonthDayPrices {
  readonly month: string;
  /** Return fares, for the whole party. */
  readonly days: ReadonlyMap<IsoDate, DayPriceEntry>;
  /**
   * Up to `MAX_RETURN_OPTIONS` returns per departure day, cheapest first, one
   * per return date. The first of each is what `days` holds for that day.
   */
  readonly returns: ReadonlyMap<IsoDate, readonly DayPriceEntry[]>;
  /**
   * One-way fares out, for the whole party, kept apart from `days` so no page
   * can show one as a return price. A day can be in both.
   */
  readonly oneWay: ReadonlyMap<IsoDate, OneWayEntry>;
  /**
   * Up to `MAX_RETURN_OPTIONS` single flights out per day, cheapest first, one
   * per distinct price. The first of each is what `oneWay` holds for that day.
   */
  readonly oneWayOptions: ReadonlyMap<IsoDate, readonly OneWayEntry[]>;
  /** The party every figure is for. */
  readonly passengers: number;
  /** When the cached answer was loaded; null when nothing is known. */
  readonly loadedAt: IsoDateTime | null;
  /** Why there are no (or stale) prices, in words a page can show. Null when fine. */
  readonly reason: string | null;
}

interface StoredFare {
  readonly amount: number;
  readonly currency: string;
  readonly observedAt: IsoDateTime | null;
}

interface StoredDay extends StoredFare {
  readonly returnDate: IsoDate;
}

/**
 * What one cache entry holds. Its shape is part of the cache key
 * (`STORED_SHAPE`), so an entry written before one-way fares existed is never
 * read as this one.
 */
interface StoredMonth {
  /** Per departure day: its returns, cheapest first, at most `MAX_RETURN_OPTIONS`. */
  readonly returns: Record<IsoDate, StoredDay[]>;
  /** Per day: single flights out, cheapest first, at most `MAX_RETURN_OPTIONS`. */
  readonly oneWay: Record<IsoDate, StoredFare[]>;
}

const STORED_SHAPE = 4;

function toOneWayEntry(stored: StoredFare): OneWayEntry {
  return { price: money(stored.amount, stored.currency), observedAt: stored.observedAt };
}

function defaultPool(): LimiterPool {
  return sharedVendorLimiters();
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function firstOf(month: string): IsoDate {
  return `${month}-01`;
}

/**
 * Keep a day's cheapest single flights, one per distinct price.
 *
 * The vendor's one-way question answers with every fare it has seen; the
 * cheapest is the "from" price and the others are kept, up to
 * `MAX_RETURN_OPTIONS`, so a day can list several. A second currency is not
 * comparable, so the first stays. The vendor states a price, not a flight
 * number, so two rows at one price are one option.
 */
function keepOneWays(into: Map<IsoDate, StoredFare[]>, day: IsoDate, fare: StoredFare): void {
  const list = into.get(day);
  if (!list) {
    into.set(day, [fare]);
    return;
  }
  if (list[0]!.currency !== fare.currency) return;
  if (list.some((seen) => seen.amount === fare.amount)) return;

  list.push(fare);
  list.sort((a, b) => a.amount - b.amount);
  if (list.length > MAX_RETURN_OPTIONS) list.length = MAX_RETURN_OPTIONS;
}

/**
 * Keep a departure day's cheapest returns, one per return date.
 *
 * The list is ordered cheapest first and holds at most `MAX_RETURN_OPTIONS`.
 * A second currency for one day is not comparable, so the first stays; the
 * same return date seen twice keeps the cheaper fare.
 */
function keepReturns(into: Map<IsoDate, StoredDay[]>, day: IsoDate, fare: StoredDay): void {
  const list = into.get(day);
  if (!list) {
    into.set(day, [fare]);
    return;
  }
  if (list[0]!.currency !== fare.currency) return;

  const same = list.findIndex((seen) => seen.returnDate === fare.returnDate);
  if (same >= 0) {
    if (list[same]!.amount <= fare.amount) return;
    list.splice(same, 1);
  }

  list.push(fare);
  list.sort((a, b) => a.amount - b.amount || a.returnDate.localeCompare(b.returnDate));
  if (list.length > MAX_RETURN_OPTIONS) list.length = MAX_RETURN_OPTIONS;
}

/** A return fare for a departure inside the month and a stay inside the bounds. */
function inBounds(
  departure: IsoDate,
  returnDate: IsoDate,
  month: string,
  minNights: number,
  maxNights: number,
): boolean {
  const nights = daysBetween(departure, returnDate);
  return departure.startsWith(month) && nights >= minNights && nights <= maxNights;
}

/** The cheapest returns per departure day inside a month, within the stay bounds. */
function cheapestPerDay(
  offers: readonly FlightOffer[],
  month: string,
  minNights: number,
  maxNights: number,
  into: Map<IsoDate, StoredDay[]>,
): void {
  for (const offer of offers) {
    const out = offer.outbound.segments[0]?.departsAt;
    const back = offer.inbound.segments[0]?.departsAt;
    if (!out || !back) continue;

    const departure = localDate(out);
    const returnDate = localDate(back);
    if (!inBounds(departure, returnDate, month, minNights, maxNights)) continue;

    keepReturns(into, departure, {
      amount: offer.price.amount,
      currency: offer.price.currency,
      returnDate,
      observedAt: offer.observedAt ?? null,
    });
  }
}

/** Day fares from a month source: returns into `days`, one-way fares into `oneWay`. */
function mergeDayFares(
  fares: readonly DayFare[],
  month: string,
  minNights: number,
  maxNights: number,
  days: Map<IsoDate, StoredDay[]>,
  oneWay: Map<IsoDate, StoredFare[]>,
): void {
  for (const fare of fares) {
    const fields = {
      amount: fare.price.amount,
      currency: fare.price.currency,
      observedAt: fare.observedAt,
    };

    if (fare.returnDate === null) {
      if (fare.departureDate.startsWith(month)) keepOneWays(oneWay, fare.departureDate, fields);
      continue;
    }

    if (!inBounds(fare.departureDate, fare.returnDate, month, minNights, maxNights)) continue;
    keepReturns(days, fare.departureDate, { ...fields, returnDate: fare.returnDate });
  }
}

async function fetchMonth(
  query: DayPriceQuery,
  flights: FlightProvider,
  pool: LimiterPool,
): Promise<StoredMonth> {
  const minNights = query.minNights ?? DEFAULT_MIN_NIGHTS;
  const maxNights = query.maxNights ?? DEFAULT_MAX_NIGHTS;
  // Every figure that comes back is for this party; see the cache key.
  const passengers = query.passengers ?? 1;

  const limiter = pool.for(
    flights.metadata.id,
    concurrencyFor(
      flights.metadata.rateLimitPerMinute,
      CONCURRENCY_CEILING,
      flights.metadata.typicalLatencyMs ?? null,
    ),
  );

  const found = new Map<IsoDate, StoredDay[]>();
  const oneWay = new Map<IsoDate, StoredFare[]>();
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

  /*
   * The vendor's further day questions (see `monthFareSources`): each a leaf
   * call with its own slot in the same limiter. A failing one is one fewer
   * source for the month, never the month.
   */
  const askSource = async (source: MonthFareSource, destination: string) => {
    const result = await limiter.run(() =>
      source.fetch({
        origin: query.origin,
        destination,
        month: query.month,
        currency: query.currency,
        passengers,
      }),
    );

    if (!isOk(result)) {
      failures.push(result.error);
      log.debug({ source: source.id, err: result.error }, 'day-price source failed');
      return;
    }

    mergeDayFares(result.value, query.month, minNights, maxNights, found, oneWay);
  };

  for (const destination of query.destinations) {
    if (flights.metadata.answersByMonth) {
      // Two questions, because the vendor filters the return by month too: a
      // trip leaving on the 30th and coming back on the 4th is in neither the
      // month's own return nor, with one question, anywhere at all.
      requests.push(ask(destination, first, `${query.month}-28`));
      requests.push(ask(destination, first, firstOf(nextMonth)));
      for (const source of flights.monthFareSources ?? []) {
        requests.push(askSource(source, destination));
      }
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
  if (found.size === 0 && oneWay.size === 0 && failures.length > 0) throw failures[0];

  return { returns: Object.fromEntries(found), oneWay: Object.fromEntries(oneWay) };
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
  const passengers = query.passengers ?? 1;
  const empty = (reason: string): MonthDayPrices => ({
    month: query.month,
    days: new Map(),
    returns: new Map(),
    oneWay: new Map(),
    oneWayOptions: new Map(),
    passengers,
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
      /*
       * Every figure stored is a party total, so the party is in the key: a
       * party of four never reads a month priced for two.
       */
      cacheKey('flex', {
        shape: STORED_SHAPE,
        provider: flights.metadata.id,
        origin: query.origin,
        destinations: [...query.destinations].sort(),
        month: query.month,
        currency: query.currency,
        passengers,
        minNights: query.minNights ?? DEFAULT_MIN_NIGHTS,
        maxNights: query.maxNights ?? DEFAULT_MAX_NIGHTS,
      }),
      {
        freshMs: DAY_PRICES_FRESH_MS,
        staleMs: DAY_PRICES_STALE_MS,
        now,
        load: () => {
          const admit = deps.admit ?? (deps.store ? undefined : admitFromSharedBudget);
          if (admit && !admit()) {
            throw new AppError('RATE_LIMITED', 'Day-price load budget spent', {
              publicMessage: 'Prices are busy right now. Try again shortly.',
              retryable: true,
            });
          }
          return fetchMonth(query, flights, pool);
        },
      },
    );

    if (read.value === null) {
      log.warn({ month: query.month, err: read.error }, 'day prices could not be loaded');
      return empty('Prices for this month could not be loaded. Try again in a moment.');
    }

    const days = new Map<IsoDate, DayPriceEntry>();
    const returns = new Map<IsoDate, readonly DayPriceEntry[]>();
    for (const [day, list] of Object.entries(read.value.returns)) {
      if (deps.today && day < deps.today) continue;

      const entries = list.map((stored) => ({
        price: money(stored.amount, stored.currency),
        observedAt: stored.observedAt,
        returnDate: stored.returnDate,
      }));
      if (entries.length === 0) continue;

      days.set(day, entries[0]!);
      returns.set(day, entries);
    }

    const oneWay = new Map<IsoDate, OneWayEntry>();
    const oneWayOptions = new Map<IsoDate, readonly OneWayEntry[]>();
    for (const [day, list] of Object.entries(read.value.oneWay)) {
      if (deps.today && day < deps.today) continue;
      const entries = list.map(toOneWayEntry);
      if (entries.length === 0) continue;
      oneWay.set(day, entries[0]!);
      oneWayOptions.set(day, entries);
    }

    return {
      month: query.month,
      days,
      returns,
      oneWay,
      oneWayOptions,
      passengers,
      loadedAt: read.observedAt,
      reason: read.error ? 'Showing earlier prices; they could not be refreshed.' : null,
    };
  } catch (error) {
    // Registry or store trouble is a missing price, never a broken page.
    log.warn({ month: query.month, err: error }, 'day prices unavailable');
    return empty('Prices for this month could not be loaded. Try again in a moment.');
  }
}

/**
 * The single flights coming back, per day of the month: from the destination
 * to the origin, cheapest first, at most `MAX_RETURN_OPTIONS` a day.
 *
 * Read from the cache before any call, and stored in its own entry (the
 * direction is in the key). The vendor answers by month, so a day that is not
 * stored is a month that is not stored: one question per destination and
 * source, then the whole month is kept. A vendor with no month questions, or a
 * failing one, gives an empty map and a reason; it never throws. Each fare is
 * for one direction and labelled "flights only" by the page, never a trip price.
 */
export async function loadMonthReturnFlights(
  query: DayPriceQuery,
  deps: DayPriceDeps = {},
): Promise<{
  readonly flights: ReadonlyMap<IsoDate, readonly OneWayEntry[]>;
  readonly reason: string | null;
}> {
  const none = (reason: string | null) => ({
    flights: new Map<IsoDate, readonly OneWayEntry[]>(),
    reason,
  });
  if (!isMonth(query.month) || query.destinations.length === 0) return none('No month to price.');

  try {
    const flights = deps.flights ?? getProviderRegistry().flights;
    const store = deps.store ?? getCacheStore();
    const pool = deps.pool ?? defaultPool();
    const passengers = query.passengers ?? 1;
    if (!flights.metadata.answersByMonth || !flights.monthFareSources?.length) return none(null);

    const read = await readThrough<Record<IsoDate, StoredFare[]>>(
      store,
      cacheKey('flex', {
        shape: STORED_SHAPE,
        direction: 'back',
        provider: flights.metadata.id,
        origin: query.origin,
        destinations: [...query.destinations].sort(),
        month: query.month,
        currency: query.currency,
        passengers,
      }),
      {
        freshMs: DAY_PRICES_FRESH_MS,
        staleMs: DAY_PRICES_STALE_MS,
        now: deps.now ?? Date.now,
        load: async () => {
          const admit = deps.admit ?? (deps.store ? undefined : admitFromSharedBudget);
          if (admit && !admit()) {
            throw new AppError('RATE_LIMITED', 'Day-price load budget spent', {
              publicMessage: 'Prices are busy right now. Try again shortly.',
              retryable: true,
            });
          }
          const limiter = pool.for(
            flights.metadata.id,
            concurrencyFor(
              flights.metadata.rateLimitPerMinute,
              CONCURRENCY_CEILING,
              flights.metadata.typicalLatencyMs ?? null,
            ),
          );
          const found = new Map<IsoDate, StoredFare[]>();
          const failures: AppError[] = [];
          const asks: Promise<void>[] = [];
          for (const destination of query.destinations) {
            for (const source of flights.monthFareSources ?? []) {
              asks.push(
                (async () => {
                  // Flying back: the destination is where the flight starts.
                  const result = await limiter.run(() =>
                    source.fetch({
                      origin: destination,
                      destination: query.origin,
                      month: query.month,
                      currency: query.currency,
                      passengers,
                    }),
                  );
                  if (!isOk(result)) {
                    failures.push(result.error);
                    return;
                  }
                  for (const fare of result.value) {
                    if (fare.returnDate !== null || !fare.departureDate.startsWith(query.month)) {
                      continue;
                    }
                    keepOneWays(found, fare.departureDate, {
                      amount: fare.price.amount,
                      currency: fare.price.currency,
                      observedAt: fare.observedAt,
                    });
                  }
                })(),
              );
            }
          }
          await Promise.all(asks);
          if (found.size === 0 && failures.length > 0) throw failures[0];
          return Object.fromEntries(found) as Record<IsoDate, StoredFare[]>;
        },
      },
    );

    if (read.value === null) return none('Flights back could not be loaded.');

    const out = new Map<IsoDate, readonly OneWayEntry[]>();
    for (const [day, list] of Object.entries(read.value)) {
      if (deps.today && day < deps.today) continue;
      if (list.length > 0) out.set(day, list.map(toOneWayEntry));
    }
    return {
      flights: out,
      reason: read.error ? 'Showing earlier prices; they could not be refreshed.' : null,
    };
  } catch (error) {
    log.warn({ month: query.month, err: error }, 'flights back unavailable');
    return none('Flights back could not be loaded.');
  }
}
