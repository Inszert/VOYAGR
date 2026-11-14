import { lessThan, type Money } from '@/core/money';
import { costCoverage } from '@/core/trip/coverage';
import { connectionCount } from '@/core/trip/legs';
import type { AirportCode, CostCategory } from '@/core/trip/types';
import type { DateWeather } from './date-options';
import type { RankedTrip } from './types';

/**
 * What a search found at each destination.
 *
 * Computed from *every* eligible trip, not from the page of results that
 * survived truncation - the same rule, and for the same reason, as the swap
 * options in `routeOffers`. The discovery map asks "where can I go?", and
 * answering it from the top forty ranked trips would quietly drop the cheap
 * places that lost on score, which are exactly the ones somebody browsing a
 * map is looking for.
 *
 * Every figure here belongs to one real trip: the cheapest total is a cost the
 * engine produced for a specific combination, not a minimum assembled out of
 * the cheapest flight and the cheapest hotel that never shared a date.
 */

export interface DestinationSummary {
  readonly destination: AirportCode;
  readonly destinationName: string;
  readonly cheapestTotal: Money;
  /** Best score at this destination, from the scoring engine. */
  readonly bestScore: number;
  /** Shortest total flying time, both legs. */
  readonly fastestMinutes: number;
  /** Fewest connections on the busier leg. */
  readonly fewestStops: number;
  /** The outlook for the cheapest trip's dates, or null when none was fetched. */
  readonly weather: DateWeather | null;
  readonly tripCount: number;
  /**
   * The middle total of every eligible trip found here - the lower of the two
   * middles when the count is even, so it is always a total some real trip
   * had, never an average of two. What "typical" means on a result.
   */
  readonly typicalTotal: Money;
  /** What the cheapest trip's total leaves out, so "all in" is only said when it is true. */
  readonly excludedCategories: readonly CostCategory[];
}

function stopsOf(trip: RankedTrip): number {
  const { outbound, inbound } = trip.candidate.flight;
  return Math.max(connectionCount(outbound), connectionCount(inbound));
}

function minutesOf(trip: RankedTrip): number {
  return (
    trip.candidate.flight.outbound.durationMinutes + trip.candidate.flight.inbound.durationMinutes
  );
}

function weatherOf(trip: RankedTrip): DateWeather | null {
  const days = trip.candidate.weather;
  if (days.length === 0) return null;

  return {
    minC: Math.min(...days.map((day) => day.temperatureMinC)),
    maxC: Math.max(...days.map((day) => day.temperatureMaxC)),
    // The weakest claim wins, as everywhere: a week whose last days are
    // climatology is not a forecast because its first days were.
    confidence: Math.min(...days.map((day) => day.confidence)),
    rainChance: Math.max(...days.map((day) => day.precipitationProbability)),
  };
}

export function summariseDestinations(trips: readonly RankedTrip[]): readonly DestinationSummary[] {
  const grouped = new Map<AirportCode, RankedTrip[]>();

  for (const trip of trips) {
    const existing = grouped.get(trip.candidate.destination);
    if (existing) existing.push(trip);
    else grouped.set(trip.candidate.destination, [trip]);
  }

  return [...grouped].map(([destination, found]) => {
    const cheapest = found.reduce((best, trip) =>
      lessThan(trip.cost.total, best.cost.total) ? trip : best,
    );

    return {
      destination,
      destinationName: cheapest.candidate.destinationName,
      cheapestTotal: cheapest.cost.total,
      bestScore: found.reduce((best, trip) => Math.max(best, trip.score.score), 0),
      fastestMinutes: Math.min(...found.map(minutesOf)),
      fewestStops: Math.min(...found.map(stopsOf)),
      weather: weatherOf(cheapest),
      excludedCategories: costCoverage(cheapest.cost.excluded).excluded,
      tripCount: found.length,
      typicalTotal: [...found].sort((a, b) => a.cost.total.amount - b.cost.total.amount)[
        Math.floor((found.length - 1) / 2)
      ]!.cost.total,
    };
  });
}
