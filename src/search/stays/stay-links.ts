import type { StayLinkOffer, StayQuery } from '@/core/stay/types';
import type { TripCandidate } from '@/core/trip/types';
import { createLimiter } from '@/lib/concurrency';
import type { DataSource } from '@/providers/data-source';
import { findAllStayLinks } from '@/providers/stays/fanout';
import { getStayProviders } from '@/providers/stays/registry';

/**
 * "Find a stay" links for places the product could not price.
 *
 * The one place a page asks for them, so the trip card, the destination page
 * and `/stays` all show the same link for the same search - and none of them
 * knows which vendor it came from.
 */

/** The stay a trip implies: its destination, its dates, its travellers. */
export function stayQueryForTrip(candidate: TripCandidate): StayQuery {
  return {
    destination: {
      code: candidate.destination,
      name: candidate.destinationName,
      position: null,
      radiusKm: null,
    },
    checkIn: candidate.dates.departureDate,
    checkOut: candidate.dates.returnDate,
    occupancy: { adults: candidate.passengers, children: 0, rooms: 1 },
    currency: candidate.flight.price.currency,
  };
}

export async function loadStayLinks(
  query: StayQuery,
  source: DataSource = 'api',
): Promise<readonly StayLinkOffer[]> {
  return findAllStayLinks(getStayProviders(undefined, source), query, {
    limiter: createLimiter(2),
  });
}

/**
 * A link for every trip that has no priced stay, keyed by candidate id.
 *
 * Trips that already have a priced stay get none: a link beside a price would
 * read as a second, competing quote.
 */
export async function loadStayLinksForTrips(
  candidates: readonly TripCandidate[],
  source: DataSource = 'api',
): Promise<ReadonlyMap<string, StayLinkOffer>> {
  const links = new Map<string, StayLinkOffer>();

  await Promise.all(
    candidates
      .filter((candidate) => candidate.hotel === null)
      .map(async (candidate) => {
        const [first] = await loadStayLinks(stayQueryForTrip(candidate), source);
        if (first) links.set(candidate.id, first);
      }),
  );

  return links;
}
