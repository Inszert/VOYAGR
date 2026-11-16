import { format, toMajor, type Money } from '@/core/money';
import { perTraveller } from '@/core/party';
import type { IsoDate } from '@/core/trip/types';
import type { MonthDayPrices } from './day-prices';

/**
 * A month of day prices as the calendar receives it.
 *
 * Formatted here, on the server, from `Money`: the browser is handed strings
 * to show and one number to order days by, and never adds, divides or
 * converts a price.
 *
 * Every day carries two figures. `exact` is the **party total** to the cent,
 * for the day's accessible name; `perPerson` is that total per traveller in
 * whole units (`perTraveller`, rounded down to the minor unit first), for a
 * cell with room for five characters. The calendar's legend says which one
 * the cells show.
 */

export interface DayPriceJson {
  readonly returnDate: IsoDate;
  /** The party total, to the cent, for the accessible name. */
  readonly exact: string;
  /** The party total in whole units. */
  readonly whole: string;
  /** Per traveller, whole units, for the cell. */
  readonly perPerson: string;
  /** Only for ordering days by cost. Never added to anything. */
  readonly amount: number;
}

/** A one-way fare out. Never a return price; the calendar labels it "one way from". */
export interface OneWayPriceJson {
  readonly exact: string;
  readonly perPerson: string;
  readonly amount: number;
}

export interface MonthPricesJson {
  readonly month: string;
  /** The party every figure is for. */
  readonly passengers: number;
  readonly days: Readonly<Record<IsoDate, DayPriceJson>>;
  /** Days with a one-way fare out. A day can be here and in `days`. */
  readonly oneWay: Readonly<Record<IsoDate, OneWayPriceJson>>;
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

/** A party total per traveller, in whole units. */
export function formatPerPersonWhole(total: Money, travellers: number): string {
  return formatWhole(perTraveller(total, travellers).each);
}

export function toMonthPricesJson(prices: MonthDayPrices): MonthPricesJson {
  const days: Record<IsoDate, DayPriceJson> = {};

  for (const [day, entry] of prices.days) {
    days[day] = {
      returnDate: entry.returnDate,
      exact: format(entry.price),
      whole: formatWhole(entry.price),
      perPerson: formatPerPersonWhole(entry.price, prices.passengers),
      amount: toMajor(entry.price),
    };
  }

  const oneWay: Record<IsoDate, OneWayPriceJson> = {};
  for (const [day, entry] of prices.oneWay) {
    oneWay[day] = {
      exact: format(entry.price),
      perPerson: formatPerPersonWhole(entry.price, prices.passengers),
      amount: toMajor(entry.price),
    };
  }

  return {
    month: prices.month,
    passengers: prices.passengers,
    days,
    oneWay,
    reason: prices.reason,
  };
}
