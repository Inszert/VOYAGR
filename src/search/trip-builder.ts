import { daysBetween, minutesIntoLocalDay } from '@/core/dates';
import { subtract } from '@/core/money';
import type { Money } from '@/core/money';
import type { SearchProfile } from '@/core/trip/types';
import { flightAlternatives, hotelAlternatives, type Alternative } from './alternatives';
import type { RankedTrip, SearchOutcome } from './types';

/**
 * Building a trip out of the parts a search already priced.
 *
 * A result is one flight, one hotel and one set of dates. Somebody looking at
 * it wants to ask: what if I left earlier, stayed somewhere else, or went a
 * day later - and what would that do to the total? Every one of those answers
 * is already in the search. The alternatives module evaluates each flight and
 * hotel the search saw for this route and these dates as a *whole trip*, and
 * the results hold the other dates it priced for the same place.
 *
 * So this composes, and computes nothing new. A chosen flight is swapped in
 * through `flightAlternatives`, then a chosen hotel through
 * `hotelAlternatives` on the result - each an `evaluateTrip` by the engine,
 * never a sum made here. The differences it reports are `subtract` on two
 * engine totals in the same currency; where the currencies differ there is
 * no difference to report, and it says nothing rather than something wrong.
 *
 * The choices are identified by offer id and carried in the URL, so a built
 * trip is a link: it survives a reload and can be sent to someone.
 */

export interface FlightChoice extends Alternative {
  /**
   * How much earlier (negative) or later (positive) this flight leaves than
   * the one in the trip, in minutes on the local clock. Null when either leg
   * has no segments to read a time from.
   */
  readonly departureShiftMinutes: number | null;
}

export interface DateChoice {
  readonly trip: RankedTrip;
  /** Days between this trip's departure and the built trip's. */
  readonly shiftDays: number;
  /** This trip's total less the built trip's, or null across currencies. */
  readonly totalDelta: Money | null;
}

export interface BuiltTrip {
  /** The trip as the traveller has built it. */
  readonly trip: RankedTrip;
  /** The trip they started from. */
  readonly original: RankedTrip;
  /** True when anything has been swapped. */
  readonly customised: boolean;
  /** The built total less the original, or null across currencies. */
  readonly deltaFromOriginal: Money | null;
  /** Every flight the search saw for this route and these dates. */
  readonly flights: readonly FlightChoice[];
  /** Every hotel the search saw for this route and these dates. */
  readonly hotels: readonly Alternative[];
  /** Other dates the search priced for the same place and length of stay. */
  readonly dates: readonly DateChoice[];
}

export interface BuildTripInput {
  readonly outcome: SearchOutcome;
  readonly profile: SearchProfile;
  readonly original: RankedTrip;
  /** A flight offer to swap in, by id. Ignored when the search did not see it. */
  readonly flightId?: string | null;
  /** A hotel offer to swap in, by id. Ignored when the search did not see it. */
  readonly hotelId?: string | null;
  readonly limit?: number;
}

/** `b - a`, when the two can be compared at all. */
function difference(a: Money, b: Money): Money | null {
  return a.currency === b.currency ? subtract(b, a) : null;
}

function departureMinutes(trip: RankedTrip): number | null {
  const first = trip.candidate.flight.outbound.segments[0];
  return first ? minutesIntoLocalDay(first.departsAt) : null;
}

export function buildTrip(input: BuildTripInput): BuiltTrip {
  const { outcome, profile, original } = input;
  const limit = input.limit ?? 6;

  // Flight first, then the hotel on top of it: the hotel's evaluation then
  // already carries the chosen flight, so the total is the whole trip's.
  let trip = original;

  if (input.flightId) {
    const chosen = flightAlternatives({ outcome, current: trip, profile, limit: 50 }).find(
      (alternative) => alternative.offerId === input.flightId,
    );
    if (chosen) trip = chosen.trip;
  }

  if (input.hotelId) {
    const chosen = hotelAlternatives({ outcome, current: trip, profile, limit: 50 }).find(
      (alternative) => alternative.offerId === input.hotelId,
    );
    if (chosen) trip = chosen.trip;
  }

  // The choices are offered against the trip as it now stands, so every
  // "cheaper" and "more" is measured from what is on the screen.
  const ownDeparture = departureMinutes(trip);
  const flights: FlightChoice[] = flightAlternatives({
    outcome,
    current: trip,
    profile,
    limit,
  }).map((alternative) => {
    const theirs = departureMinutes(alternative.trip);
    return {
      ...alternative,
      departureShiftMinutes:
        theirs === null || ownDeparture === null ? null : theirs - ownDeparture,
    };
  });

  const hotels = hotelAlternatives({ outcome, current: trip, profile, limit });

  const { candidate } = trip;
  const dates: DateChoice[] = outcome.results
    .filter(
      (other) =>
        other.candidate.destination === candidate.destination &&
        other.candidate.dates.nights === candidate.dates.nights &&
        other.candidate.dates.departureDate !== candidate.dates.departureDate,
    )
    // One per departure date: the best-ranked trip the search found for it.
    .filter(
      (other, index, all) =>
        all.findIndex(
          (earlier) =>
            earlier.candidate.dates.departureDate === other.candidate.dates.departureDate,
        ) === index,
    )
    .map((other) => ({
      trip: other,
      shiftDays: daysBetween(candidate.dates.departureDate, other.candidate.dates.departureDate),
      totalDelta: difference(trip.cost.total, other.cost.total),
    }))
    .sort((a, b) => a.shiftDays - b.shiftDays)
    .slice(0, limit);

  const customised = trip !== original;

  return {
    trip,
    original,
    customised,
    deltaFromOriginal: customised ? difference(original.cost.total, trip.cost.total) : null,
    flights,
    hotels,
    dates,
  };
}
