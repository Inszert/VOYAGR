import { addDays, isIsoDate } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';

/**
 * What the search form shows a stranger who has typed nothing.
 *
 * Dates are derived from an injected `today`, never written down: a constant
 * date is a bug with a fuse, and it went off when June 2026 passed and the
 * homepage began offering searches for the past. Pure - the caller owns the
 * clock and passes it in (the server reads it once per request).
 *
 * Out in two weeks, back in three: far enough that fares are bookable and
 * cheap enough to be interesting, near enough that a weather forecast exists.
 */
export const DEFAULT_DEPARTURE_OFFSET_DAYS = 14;
export const DEFAULT_TRIP_LENGTH_DAYS = 7;
/** How wide the flexible window is, from the earliest departure to the latest return. */
export const DEFAULT_WINDOW_DAYS = 30;

export function searchFormDefaults(today: IsoDate): Readonly<Record<string, string>> {
  if (!isIsoDate(today)) {
    // Fail loudly: silently falling back to a fixed date is exactly the defect
    // this function exists to remove.
    throw new RangeError('searchFormDefaults() needs today as a YYYY-MM-DD date.');
  }

  const departure = addDays(today, DEFAULT_DEPARTURE_OFFSET_DAYS);

  return {
    origins: 'VIE',
    destinations: 'AYT, CHQ, SPU',
    flexibility: 'custom',
    departureDate: departure,
    returnDate: addDays(departure, DEFAULT_TRIP_LENGTH_DAYS),
    earliestDeparture: departure,
    latestReturn: addDays(departure, DEFAULT_WINDOW_DAYS),
    // The trip length is not set: there is no `tripLength` default, so the control has
    // nothing chosen and applies no limit. The nights are the whole range the control
    // can name (1 to 30), so they limit nothing until the visitor sets a length.
    minNights: '1',
    maxNights: '30',
    passengers: '2',
    currency: 'EUR',
    targetBudget: '650',
    maxBudget: '850',
    travelStyle: 'balanced',
    optimisationMode: 'best_value',
  };
}
