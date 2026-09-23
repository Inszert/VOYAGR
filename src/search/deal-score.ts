import { subtract, type Money } from '@/core/money';
import type { DestinationSummary } from './destinations';
import type { RankedTrip } from './types';

/**
 * How good a deal a trip is, against its own destination.
 *
 * The comparison is with the typical total of every eligible trip this same
 * search found for the same place - not a price history, not a market rate,
 * nothing from outside the search - so it can only ever say "cheaper than
 * most of what we found here". It says nothing when there are too few trips
 * to have a typical one, or when the currencies differ.
 */

/** Fewest trips at a destination before "typical" means anything. */
export const MIN_TRIPS_FOR_TYPICAL = 3;

export interface DealAgainstTypical {
  readonly typical: Money;
  /** This trip's total less the typical one. Negative is cheaper. */
  readonly difference: Money;
  /** How many trips the typical total was taken from. */
  readonly basis: number;
}

export function dealAgainstTypical(
  trip: RankedTrip,
  summaries: readonly DestinationSummary[],
): DealAgainstTypical | null {
  const summary = summaries.find((entry) => entry.destination === trip.candidate.destination);
  if (!summary || summary.tripCount < MIN_TRIPS_FOR_TYPICAL) return null;
  if (summary.typicalTotal.currency !== trip.cost.total.currency) return null;

  return {
    typical: summary.typicalTotal,
    difference: subtract(trip.cost.total, summary.typicalTotal),
    basis: summary.tripCount,
  };
}
