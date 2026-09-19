import type { PriceObservationRecord } from '@/db/repository';
import type { RankedTrip } from '@/search/types';

/**
 * Turning a refreshed trip into price observations (specification section 22).
 *
 * Pure. A trip and a timestamp go in, the rows that should be written come out,
 * so what gets recorded is testable without a database.
 *
 * The rule the whole table exists to serve: a price without provenance cannot
 * honestly be shown. Every row carries who quoted it, when we saw it, in what
 * currency and under what conditions - because "EUR 612" means nothing without
 * "from mock-hotels, on 19 September, cabin baggage only, non-refundable".
 *
 * Both the total and its parts are recorded. The total is what a user watches;
 * the parts are what explains it, and "the flight dropped but the hotel rose"
 * is not answerable from a single number.
 */

export type ObservationInput = Omit<PriceObservationRecord, 'id'>;

/** The conditions the cost engine already attached to a category, if any. */
function conditionsFor(trip: RankedTrip, category: string): string | null {
  return trip.cost.lines.find((line) => line.category === category)?.conditions ?? null;
}

/**
 * How much of a total was quoted rather than estimated.
 *
 * Recorded as a condition of the total because it is one: a cheap total that is
 * mostly our own estimates is not the same observation as a cheap total a
 * provider stood behind, and six months later nobody will remember which.
 */
function totalConditions(trip: RankedTrip): string {
  const quoted = Math.round(trip.cost.knownShare * 100);
  return `${quoted}% of this total was quoted by a provider`;
}

/**
 * The observations to record for one refreshed trip.
 *
 * `observedAt` is when *we* saw the price, not when the provider first quoted
 * it. The provider's own timestamp is on the offer; this column is what makes
 * the rows a time series, and a cached upstream response must not be able to
 * backdate itself into one.
 */
export function observationsFor(
  watchId: string,
  trip: RankedTrip,
  observedAt: string,
): ObservationInput[] {
  const { candidate, cost } = trip;

  const observations: ObservationInput[] = [
    {
      watchId,
      componentType: 'trip_total',
      componentId: candidate.id,
      amount: cost.total,
      // The total is assembled by the cost engine from several providers, so
      // the engine is its source. Naming one provider would be a lie about
      // where the number came from.
      providerId: 'voyagr.cost-engine',
      observedAt,
      conditions: totalConditions(trip),
    },
    {
      watchId,
      componentType: 'flight',
      componentId: candidate.flight.id,
      amount: candidate.flight.price,
      providerId: candidate.flight.providerId,
      observedAt,
      conditions: conditionsFor(trip, 'flight'),
    },
    {
      watchId,
      componentType: 'hotel',
      componentId: candidate.hotel.id,
      amount: candidate.hotel.totalPrice,
      providerId: candidate.hotel.providerId,
      observedAt,
      conditions: conditionsFor(trip, 'hotel'),
    },
  ];

  // Only when one was actually priced. An unpriced transfer is an excluded cost
  // line, not a zero, and recording a zero here would poison every later
  // comparison with a price nobody was ever offered.
  if (candidate.transfer) {
    observations.push({
      watchId,
      componentType: 'transfer',
      componentId: candidate.transfer.id,
      amount: candidate.transfer.pricePerDirection,
      providerId: candidate.transfer.providerId,
      observedAt,
      conditions: `Per direction, ${candidate.transfer.mode}`,
    });
  }

  return observations;
}
