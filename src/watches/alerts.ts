import { format } from '@/core/money';
import type { DealVerdict } from '@/core/deal-detection';
import type { RankedTrip } from '@/search/types';
import type { TripSearchRecord } from '@/db/repository';

/**
 * Wording an alert that has already been decided on.
 *
 * Every number here comes from a figure the deterministic core produced. The
 * only thing this module does is arrange them into a sentence.
 *
 * This is the seam where a model may eventually write the prose (§24.5, premium
 * AI). It could replace the wording and nothing else: the decision to send, the
 * severity and every figure are settled before this is called, and
 * `src/ai/guardrails.ts` would scan the result for numbers its source facts do
 * not support. Today it is a template, which is honest and free.
 */

export interface AlertContent {
  readonly title: string;
  readonly body: string;
  /** Where the notification takes the user. */
  readonly url: string;
}

export interface AlertInput {
  readonly search: TripSearchRecord;
  readonly trip: RankedTrip;
  readonly verdict: DealVerdict;
  /** Query string that reproduces the search, from `searchProfileToQuery`. */
  readonly searchQuery: string;
}

export function buildAlertContent(input: AlertInput): AlertContent {
  const { search, trip, verdict } = input;
  const percent = Math.round(verdict.dropShare * 100);

  return {
    title: `${format(verdict.drop)} off ${search.name}`,
    // Both figures are stated, because "12% cheaper" and "EUR 84 cheaper" are
    // each incomplete on their own, and the total is what the user will pay.
    body:
      `${trip.candidate.destinationName} is now ${format(trip.cost.total)} total, ` +
      `${percent}% below the best we had seen. ` +
      `${trip.candidate.dates.departureDate} to ${trip.candidate.dates.returnDate}.`,
    // Deep-links to the search that found it, so the trip is on screen rather
    // than the user having to remember what they had asked for.
    url: `/?${input.searchQuery}`,
  };
}
