import { candidateId } from './identity';
import type { FlightOffer, HotelOffer, TransferOffer, TripCandidate } from './types';

/**
 * Swapping one component of a trip (implementation plan 1.10).
 *
 * Pure. A candidate and a replacement go in, a new candidate comes out. Nothing
 * here recalculates a total, a score or a duration, and that is the point: the
 * swap produces a new trip, and the same engines that costed the original cost
 * the replacement. A swap that did its own arithmetic would be a second place
 * for a number to come from.
 *
 * Every returned candidate is new rather than mutated, because a swap is
 * usually shown *beside* the original - "this flight instead" - and mutating
 * would quietly change the thing being compared against.
 */

/** A swap is refused rather than silently producing an impossible trip. */
export class SwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapError';
  }
}

function endpointsOf(flight: FlightOffer): { origin: string; destination: string } | null {
  const origin = flight.outbound.segments[0]?.origin;
  const destination = flight.outbound.segments.at(-1)?.destination;

  return origin && destination ? { origin, destination } : null;
}

/**
 * Replace the flight.
 *
 * @throws SwapError when the replacement does not fly the same route. A flight
 *   to a different city is not a swap, it is a different holiday, and letting
 *   it through would leave the candidate's `destination` disagreeing with the
 *   itinerary underneath it - a trip whose hotel is in the wrong country.
 */
export function swapFlight(candidate: TripCandidate, flight: FlightOffer): TripCandidate {
  const endpoints = endpointsOf(flight);

  if (!endpoints) {
    throw new SwapError('The replacement flight has no segments to fly');
  }

  if (endpoints.destination !== candidate.destination) {
    throw new SwapError(
      `The replacement flight arrives at ${endpoints.destination}, not ${candidate.destination}`,
    );
  }

  if (flight.price.currency !== candidate.flight.price.currency) {
    // The cost engine refuses to mix currencies, and it is better to say why
    // here than to fail later inside a total nobody can trace.
    throw new SwapError(
      `The replacement flight is priced in ${flight.price.currency}, not ${candidate.flight.price.currency}`,
    );
  }

  return {
    ...candidate,
    // The origin follows the flight: swapping to one that leaves from a second
    // home airport is a legitimate swap, and the candidate has to say so.
    origin: endpoints.origin,
    flight,
    id: candidateId(
      endpoints.origin,
      candidate.destination,
      candidate.dates,
      flight,
      candidate.hotel,
    ),
  };
}

/**
 * Replace the hotel.
 *
 * The dates do not move, so the stay length and the weather window are
 * unchanged; what changes is the price, the quality and the location, which is
 * exactly what the scoring engine will re-read.
 */
export function swapHotel(candidate: TripCandidate, hotel: HotelOffer): TripCandidate {
  if (hotel.totalPrice.currency !== candidate.hotel.totalPrice.currency) {
    throw new SwapError(
      `The replacement hotel is priced in ${hotel.totalPrice.currency}, not ${candidate.hotel.totalPrice.currency}`,
    );
  }

  return {
    ...candidate,
    hotel,
    id: candidateId(
      candidate.origin,
      candidate.destination,
      candidate.dates,
      candidate.flight,
      hotel,
    ),
  };
}

/**
 * Replace, or remove, the airport transfer.
 *
 * Passing null is a legitimate swap: "we will sort our own way there". The cost
 * engine turns that into an excluded line and a warning rather than a zero, so
 * the total stays honest about what it does not cover.
 *
 * The id deliberately does not change. A transfer is not part of what makes a
 * trip that trip, and moving the id would break the price history of a watch
 * whose owner merely changed how they get in from the airport.
 */
export function swapTransfer(
  candidate: TripCandidate,
  transfer: TransferOffer | null,
): TripCandidate {
  if (transfer && transfer.pricePerDirection.currency !== candidate.flight.price.currency) {
    throw new SwapError(
      `The replacement transfer is priced in ${transfer.pricePerDirection.currency}, not ${candidate.flight.price.currency}`,
    );
  }

  return { ...candidate, transfer };
}
