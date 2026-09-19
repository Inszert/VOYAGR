import { swapFlight, swapHotel, SwapError } from '@/core/trip/swap';
import { getLogger } from '@/lib/logger';
import type { SearchProfile } from '@/core/trip/types';
import type { RankedTrip, SearchOutcome } from './types';
import { evaluateTrip } from './evaluate';

/**
 * Alternative components for a trip already on screen (plan 1.10).
 *
 * Every distinct flight and hotel the search saw for this route becomes an
 * option, and each option is *evaluated as a whole trip* rather than compared
 * on its own price. A cheaper flight that lands at midnight can easily make the
 * trip worse, and a list that showed only the fare would be inviting the user
 * to make that mistake.
 *
 * The combinations offered here are not all pre-computed by the search: it caps
 * how many flight-and-hotel pairs it assembles per route. Swapping is therefore
 * a real recalculation, not a lookup.
 */

const log = getLogger('search.alternatives');

export interface Alternative {
  /** The offer being offered, identified for a link. */
  readonly offerId: string;
  readonly label: string;
  readonly detail: string;
  /** The whole trip as it would be with this component. */
  readonly trip: RankedTrip;
  /** Difference in total against the trip currently shown, in minor units. */
  readonly totalDeltaMinorUnits: number;
  /** Difference in score against the trip currently shown. */
  readonly scoreDelta: number;
  readonly isCurrent: boolean;
}

export interface AlternativesInput {
  readonly outcome: SearchOutcome;
  readonly current: RankedTrip;
  readonly profile: SearchProfile;
  readonly limit?: number;
}

/** Trips for the same place and dates: the only ones a component can swap into. */
function sameRoute(outcome: SearchOutcome, current: RankedTrip): RankedTrip[] {
  return [...outcome.results, ...outcome.nearMisses].filter(
    (trip) =>
      trip.candidate.destination === current.candidate.destination &&
      trip.candidate.dates.departureDate === current.candidate.dates.departureDate &&
      trip.candidate.dates.nights === current.candidate.dates.nights,
  );
}

function compare(
  candidateTrip: RankedTrip,
  current: RankedTrip,
): Pick<Alternative, 'totalDeltaMinorUnits' | 'scoreDelta'> {
  return {
    totalDeltaMinorUnits: candidateTrip.cost.total.amount - current.cost.total.amount,
    scoreDelta: candidateTrip.score.score - current.score.score,
  };
}

/** Best first, and the trip already chosen always leads. */
function order(alternatives: Alternative[]): Alternative[] {
  return alternatives.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return (
      b.trip.score.score - a.trip.score.score || a.totalDeltaMinorUnits - b.totalDeltaMinorUnits
    );
  });
}

export function flightAlternatives(input: AlternativesInput): Alternative[] {
  const { current, profile } = input;
  const seen = new Set<string>();
  const alternatives: Alternative[] = [];

  for (const trip of sameRoute(input.outcome, current)) {
    const flight = trip.candidate.flight;
    if (seen.has(flight.id)) continue;
    seen.add(flight.id);

    try {
      const swapped =
        flight.id === current.candidate.flight.id
          ? current
          : evaluateTrip(swapFlight(current.candidate, flight), profile);

      alternatives.push({
        offerId: flight.id,
        label: `${flight.outbound.segments[0]?.carrier ?? 'Flight'} ${flight.outbound.segments
          .map((segment) => segment.destination)
          .join(' via ')}`,
        detail: `Out ${flight.outbound.segments[0]?.departsAt.slice(11, 16)}, back ${
          flight.inbound.segments[0]?.departsAt.slice(11, 16) ?? '—'
        } · ${flight.outbound.durationMinutes} min`,
        trip: swapped,
        isCurrent: flight.id === current.candidate.flight.id,
        ...compare(swapped, current),
      });
    } catch (error) {
      // A refused swap is one fewer option, never a broken page.
      if (!(error instanceof SwapError)) throw error;
      log.debug({ offerId: flight.id, reason: error.message }, 'flight alternative rejected');
    }
  }

  return order(alternatives).slice(0, input.limit ?? 5);
}

export function hotelAlternatives(input: AlternativesInput): Alternative[] {
  const { current, profile } = input;
  const seen = new Set<string>();
  const alternatives: Alternative[] = [];

  for (const trip of sameRoute(input.outcome, current)) {
    const hotel = trip.candidate.hotel;
    if (seen.has(hotel.id)) continue;
    seen.add(hotel.id);

    try {
      const swapped =
        hotel.id === current.candidate.hotel.id
          ? current
          : evaluateTrip(swapHotel(current.candidate, hotel), profile);

      alternatives.push({
        offerId: hotel.id,
        label: hotel.name,
        detail: [
          hotel.starRating === null ? null : `${hotel.starRating} star`,
          hotel.reviewScore === null ? null : `guests ${hotel.reviewScore}`,
          hotel.freeCancellation ? 'free cancellation' : 'non-refundable',
        ]
          .filter(Boolean)
          .join(' · '),
        trip: swapped,
        isCurrent: hotel.id === current.candidate.hotel.id,
        ...compare(swapped, current),
      });
    } catch (error) {
      if (!(error instanceof SwapError)) throw error;
      log.debug({ offerId: hotel.id, reason: error.message }, 'hotel alternative rejected');
    }
  }

  return order(alternatives).slice(0, input.limit ?? 5);
}
