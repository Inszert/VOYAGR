import { addDays, daysBetween } from '@/core/dates';
import {
  bestSaving,
  flexOptions,
  MAX_FLEX_DAYS,
  oldestAgeMs,
  type FlexDayPrice,
  type FlexOption,
  type FlexSaving,
} from '@/core/flex-dates';
import type { IsoDate } from '@/core/trip/types';
import { loadMonthDayPrices, type DayPriceDeps } from './day-prices';

/**
 * "Fly a few days earlier or later": the prices behind the strip.
 *
 * A thin reader over `loadMonthDayPrices`, so it shares that loader's cache,
 * limiter and degradation. Nothing here prices anything: it asks for the months
 * the window touches (one, or two across a month end) and hands the days to
 * `src/core/flex-dates.ts`, which owns every difference.
 *
 * **Same stay, not any stay.** The calendar's own bounds are a range of
 * nights; a strip that says "the same trip, two days earlier" has to compare
 * the same number of nights, so the days are read for exactly that stay. A day
 * with no fare for that stay is unknown rather than being filled from a fare
 * for a different one.
 */

export interface FlexDatesQuery {
  readonly origin: string;
  readonly destination: string;
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly currency: string;
  readonly passengers?: number;
  readonly windowDays: number;
}

export interface FlexDates {
  readonly options: readonly FlexOption[];
  readonly best: FlexSaving | null;
  /** Age of the oldest price shown, or null when none is, or one is undated. */
  readonly ageMs: number | null;
  /** Why prices are missing, when the provider could not be read. */
  readonly reason: string | null;
}

export async function loadFlexDates(
  query: FlexDatesQuery,
  deps: DayPriceDeps = {},
): Promise<FlexDates> {
  const nights = daysBetween(query.departureDate, query.returnDate);
  const windowDays = Math.min(Math.max(0, Math.trunc(query.windowDays)), MAX_FLEX_DAYS);

  const first = addDays(query.departureDate, -windowDays).slice(0, 7);
  const last = addDays(query.departureDate, windowDays).slice(0, 7);
  const months = first === last ? [first] : [first, last];

  const loaded = await Promise.all(
    months.map((month) =>
      loadMonthDayPrices(
        {
          origin: query.origin,
          destinations: [query.destination],
          month,
          currency: query.currency,
          ...(query.passengers ? { passengers: query.passengers } : {}),
          minNights: nights,
          maxNights: nights,
        },
        deps,
      ),
    ),
  );

  const prices = new Map<IsoDate, FlexDayPrice>();
  for (const month of loaded) {
    for (const [day, entry] of month.days) {
      // The stay is exact, so a fare whose return does not match is not a
      // price for this trip.
      if (entry.returnDate !== addDays(day, nights)) continue;
      prices.set(day, { price: entry.price, observedAt: entry.observedAt });
    }
  }

  const now = (deps.now ?? Date.now)();
  const options = flexOptions({
    departureDate: query.departureDate,
    returnDate: query.returnDate,
    windowDays,
    prices,
    now,
  });

  return {
    options,
    best: bestSaving(options),
    ageMs: oldestAgeMs(options, now),
    reason: loaded.find((month) => month.reason !== null)?.reason ?? null,
  };
}
