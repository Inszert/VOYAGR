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

/**
 * The components the search saw for this trip's route.
 *
 * Read from `routeOffers`, which the orchestrator collects from every
 * candidate it evaluated, rather than from the results list. Deriving the
 * options from a truncated ranking means what a user can swap into depends on
 * how many results the page happens to show - which they would experience as
 * options appearing and disappearing for no reason.
 */
function offersForRoute(outcome: SearchOutcome, current: RankedTrip) {
  const match = outcome.routeOffers.find(
    (route) =>
      route.destination === current.candidate.destination &&
      route.departureDate === current.candidate.dates.departureDate &&
      route.nights === current.candidate.dates.nights,
  );

  // Falling back to the trip's own components means the panel shows "Chosen"
  // and nothing else, which is honest, rather than throwing.
  return {
    flights: match?.flights ?? [current.candidate.flight],
    hotels: match?.hotels ?? [current.candidate.hotel],
  };
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

  for (const flight of offersForRoute(input.outcome, current).flights) {
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

  for (const hotel of offersForRoute(input.outcome, current).hotels) {
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
