import { dayOfWeek, daysBetween, localDate } from '@/core/dates';
import type { AirportCode, FlightOffer, IsoDate } from '@/core/trip/types';
import { flightDestination } from './assemble';
import type { CalendarFlight, DateWindow } from './types';

/**
 * Date windows taken from the flights that exist, rather than guessed.
 *
 * A vendor that answers a month at a time (Aviasales' cached price points)
 * cannot be asked "is there a flight on exactly these two days": the cache
 * seldom holds that pair. So the question is turned round. Ask for the month,
 * then let the days the flights actually fly become the windows, and book the
 * hotel for those days. Every trip built from such a window flies exactly the
 * days it claims, because the window was read off the flight.
 *
 * Pure, and it produces no price: prices are only used to choose which pairs
 * are worth a hotel call, never shown.
 */

export interface WindowBounds {
  readonly earliestDeparture: IsoDate;
  readonly latestReturn: IsoDate;
  readonly minNights: number;
  readonly maxNights: number;
  /** Weekday rules of the preset ("a weekend"), or null for any day. */
  readonly departureDaysOfWeek?: readonly number[] | null;
  readonly returnDaysOfWeek?: readonly number[] | null;
}

export function windowsFromOffers(
  offers: readonly FlightOffer[],
  bounds: WindowBounds,
  perDestination: number,
  maxWindows: number,
  /**
   * How many further windows to add so that departure days are covered.
   *
   * Choosing the cheapest pairs alone prices a handful of days and leaves the
   * calendar mostly empty, which reads as "nothing on those days" when the
   * truth is "we only looked at the cheapest few". Each day that has a flight
   * and no window yet gets its cheapest pair, earliest days first, up to this
   * many. Zero keeps the old behaviour.
   */
  coverDays = 0,
): DateWindow[] {
  // destination -> pair key -> cheapest price seen for that pair.
  const byDestination = new Map<AirportCode, Map<string, { window: DateWindow; price: number }>>();
  // departure day -> the cheapest pair on it, across every destination.
  const byDay = new Map<IsoDate, { window: DateWindow; price: number }>();

  for (const offer of offers) {
    const destination = flightDestination(offer);
    const out = offer.outbound.segments[0]?.departsAt;
    const back = offer.inbound.segments[0]?.departsAt;
    if (!destination || !out || !back) continue;

    const departureDate = localDate(out);
    const returnDate = localDate(back);
    const nights = daysBetween(departureDate, returnDate);

    if (departureDate < bounds.earliestDeparture || returnDate > bounds.latestReturn) continue;
    if (nights < bounds.minNights || nights > bounds.maxNights) continue;
    // A weekend search must not be answered with the cheapest midweek pair,
    // which the constraints would then rule out and leave nothing.
    if (
      bounds.departureDaysOfWeek &&
      !bounds.departureDaysOfWeek.includes(dayOfWeek(departureDate))
    )
      continue;
    if (bounds.returnDaysOfWeek && !bounds.returnDaysOfWeek.includes(dayOfWeek(returnDate)))
      continue;

    const pairs = byDestination.get(destination) ?? new Map();
    const key = `${departureDate}|${returnDate}`;
    const seen = pairs.get(key);

    if (!seen || offer.price.amount < seen.price) {
      pairs.set(key, { window: { departureDate, returnDate, nights }, price: offer.price.amount });
    }
    byDestination.set(destination, pairs);

    const day = byDay.get(departureDate);
    if (!day || offer.price.amount < day.price) {
      byDay.set(departureDate, {
        window: { departureDate, returnDate, nights },
        price: offer.price.amount,
      });
    }
  }

  const chosen = new Map<string, { window: DateWindow; price: number }>();

  for (const pairs of byDestination.values()) {
    const cheapest = [...pairs.entries()]
      .sort(
        (a, b) =>
          a[1].price - b[1].price ||
          a[1].window.departureDate.localeCompare(b[1].window.departureDate),
      )
      .slice(0, perDestination);

    for (const [key, entry] of cheapest) {
      const existing = chosen.get(key);
      if (!existing || entry.price < existing.price) chosen.set(key, entry);
    }
  }

  const picked = [...chosen.values()]
    .sort(
      (a, b) => a.price - b.price || a.window.departureDate.localeCompare(b.window.departureDate),
    )
    .slice(0, maxWindows)
    .map((entry) => entry.window);

  // Days nobody picked, in date order, each with its own cheapest pair.
  if (coverDays > 0) {
    const covered = new Set(picked.map((window) => window.departureDate));

    for (const day of [...byDay.keys()].sort()) {
      if (picked.length >= maxWindows + coverDays) break;
      if (covered.has(day)) continue;

      covered.add(day);
      picked.push(byDay.get(day)!.window);
    }
  }

  return picked.sort(
    (a, b) =>
      a.departureDate.localeCompare(b.departureDate) || a.returnDate.localeCompare(b.returnDate),
  );
}

/**
 * The cheapest flight on each departure day, for the calendar.
 *
 * Read off the same month-at-a-time answer the windows come from, but without
 * the traveller's date window - that is what limits which days get a whole
 * trip, and the point here is to say something about the rest. The bounds on
 * the length of the stay are the caller's: the orchestrator passes a wider range
 * than the traveller typed, because the cheapest fare is often a shorter stay.
 * Pure, and it produces no total.
 */
export function calendarFlightsFromOffers(
  offers: readonly FlightOffer[],
  bounds: { readonly minNights: number; readonly maxNights: number },
): CalendarFlight[] {
  const byDay = new Map<IsoDate, CalendarFlight>();

  for (const offer of offers) {
    const destination = flightDestination(offer);
    const out = offer.outbound.segments[0]?.departsAt;
    const back = offer.inbound.segments[0]?.departsAt;
    if (!destination || !out || !back) continue;

    const departureDate = localDate(out);
    const returnDate = localDate(back);
    const nights = daysBetween(departureDate, returnDate);

    if (nights < bounds.minNights || nights > bounds.maxNights) continue;

    const seen = byDay.get(departureDate);
    if (!seen || offer.price.amount < seen.price.amount) {
      byDay.set(departureDate, {
        departureDate,
        returnDate,
        nights,
        price: offer.price,
        destination,
      });
    }
  }

  return [...byDay.values()].sort((a, b) => a.departureDate.localeCompare(b.departureDate));
}
