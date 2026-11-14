import { format, toMajor, type Money } from '@/core/money';
import type { IsoDate } from '@/core/trip/types';
import type { MonthDayPrices } from './day-prices';

/**
 * A month of day prices as the calendar receives it.
 *
 * Formatted here, on the server, from `Money`: the browser is handed strings
 * to show and one number to order days by, and never adds or converts a price.
 */

export interface DayPriceJson {
  readonly returnDate: IsoDate;
  /** To the cent, for the accessible name. */
  readonly exact: string;
  /** Whole units, for a cell with room for four or five characters. */
  readonly whole: string;
  /** Only for ordering days by cost. Never added to anything. */
  readonly amount: number;
}

export interface MonthPricesJson {
  readonly month: string;
  readonly days: Readonly<Record<IsoDate, DayPriceJson>>;
  readonly reason: string | null;
}

/** A total in whole units for a cell that has room for four or five characters. */
export function formatWhole(total: Money): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: total.currency,
    maximumFractionDigits: 0,
  }).format(toMajor(total));
}

export function toMonthPricesJson(prices: MonthDayPrices): MonthPricesJson {
  const days: Record<IsoDate, DayPriceJson> = {};

  for (const [day, entry] of prices.days) {
    days[day] = {
      returnDate: entry.returnDate,
      exact: format(entry.price),
      whole: formatWhole(entry.price),
      amount: toMajor(entry.price),
    };
  }

  return { month: prices.month, days, reason: prices.reason };
}
