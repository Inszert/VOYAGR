import type {
  AirportCode,
  FlightOffer,
  HotelOffer,
  TransferOffer,
  TripCandidate,
  WeatherOutlook,
} from '@/core/trip/types';
import { localDate } from '@/core/dates';
import { candidateId } from '@/core/trip/identity';
import type { DateWindow, SearchLimits } from './types';

/**
 * Candidate assembly.
 *
 * Pure: provider offers in, `TripCandidate` objects out. No I/O, no clock, no
 * randomness, so the same offers always produce the same candidates with the
 * same ids - which is what lets a Travel Watch refresh diff today's result
 * against yesterday's instead of guessing.
 *
 * Nothing here costs, ranks or filters on price. It decides which combinations
 * exist; `src/core/` decides what they are worth.
 */

/** The origin airport a flight actually departs from. */
export function flightOrigin(offer: FlightOffer): AirportCode | null {
  return offer.outbound.segments[0]?.origin ?? null;
}

/** The destination airport a flight actually arrives at. */
export function flightDestination(offer: FlightOffer): AirportCode | null {
  return offer.outbound.segments.at(-1)?.destination ?? null;
}

/** Group flight offers by the airport they arrive at, discarding malformed ones. */
export function groupFlightsByDestination(
  offers: readonly FlightOffer[],
): Map<AirportCode, FlightOffer[]> {
  const grouped = new Map<AirportCode, FlightOffer[]>();

  for (const offer of offers) {
    const destination = flightDestination(offer);
    // A leg with no segments cannot be flown, priced or explained. Dropping it
    // is safer than assembling a trip around an itinerary we cannot describe.
    if (destination === null || flightOrigin(offer) === null) continue;

    const existing = grouped.get(destination);
    if (existing) existing.push(offer);
    else grouped.set(destination, [offer]);
  }

  return grouped;
}

/**
 * Whether a flight actually flies on the days a window names.
 *
 * A trip carries the window's dates and a hotel booked for them, so a flight
 * on other days would make the trip claim dates it does not have. A vendor
 * that answers with a whole month (Aviasales) returns flights on many days;
 * only the ones that fly this window's outbound and return days belong in it.
 * Compared as calendar dates through `localDate`, never through `Date`.
 */
export function flightMatchesWindow(offer: FlightOffer, window: DateWindow): boolean {
  const out = offer.outbound.segments[0]?.departsAt;
  const back = offer.inbound.segments[0]?.departsAt;
  if (!out || !back) return false;

  return localDate(out) === window.departureDate && localDate(back) === window.returnDate;
}

/** The forecast days that fall inside the trip, inclusive of both travel days. */
export function weatherForWindow(
  outlook: readonly WeatherOutlook[],
  window: DateWindow,
): WeatherOutlook[] {
  return outlook
    .filter((day) => day.date >= window.departureDate && day.date <= window.returnDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The transfer a trip is assembled with.
 *
 * Cheapest wins. It is the only choice that needs no preference model, and
 * every alternative stays available to the component-swapping work in 1.10,
 * where the user - not a default - picks a pricier, faster ride.
 */
export function selectTransfer(offers: readonly TransferOffer[]): TransferOffer | null {
  let cheapest: TransferOffer | null = null;

  for (const offer of offers) {
    if (cheapest === null || offer.pricePerDirection.amount < cheapest.pricePerDirection.amount) {
      cheapest = offer;
    }
  }

  return cheapest;
}

export interface RouteAssemblyInput {
  readonly destination: AirportCode;
  readonly destinationName: string;
  readonly window: DateWindow;
  readonly passengers: number;
  /** Flight offers arriving at this destination for this window. */
  readonly flights: readonly FlightOffer[];
  readonly hotels: readonly HotelOffer[];
  readonly transfers: readonly TransferOffer[];
  /** Outlook covering the whole search span; sliced to the window here. */
  readonly outlook: readonly WeatherOutlook[];
  readonly limits: SearchLimits;
}

/**
 * Assemble every combination for one destination and one date window.
 *
 * Flights and hotels are taken cheapest-first up to their per-route limits, and
 * the resulting cross product is capped. When the cap bites, the cheapest
 * combinations survive - a deliberate bias, because the alternative is dropping
 * combinations arbitrarily and the user asked for a budget.
 */
export function assembleRouteCandidates(input: RouteAssemblyInput): TripCandidate[] {
  const { window, limits } = input;

  const flights = input.flights
    .filter((offer) => flightMatchesWindow(offer, window))
    .sort((a, b) => a.price.amount - b.price.amount || a.id.localeCompare(b.id))
    .slice(0, limits.maxFlightOffersPerRoute);

  const hotels = [...input.hotels]
    .sort((a, b) => a.totalPrice.amount - b.totalPrice.amount || a.id.localeCompare(b.id))
    .slice(0, limits.maxHotelOffersPerDestination);

  if (flights.length === 0) return [];

  // No priced stay is not a reason to drop the trip. The flights are real, and
  // the cost engine reports the missing stay as an excluded line.
  const stays: readonly (HotelOffer | null)[] = hotels.length === 0 ? [null] : hotels;

  const transfer = selectTransfer(input.transfers);
  const weather = weatherForWindow(input.outlook, window);

  const candidates: TripCandidate[] = [];

  for (const flight of flights) {
    const origin = flightOrigin(flight);
    if (origin === null) continue;

    for (const hotel of stays) {
      candidates.push({
        id: candidateId(origin, input.destination, window, flight, hotel),
        origin,
        destination: input.destination,
        destinationName: input.destinationName,
        dates: {
          departureDate: window.departureDate,
          returnDate: window.returnDate,
          nights: window.nights,
        },
        passengers: input.passengers,
        flight,
        hotel,
        transfer,
        weather,
        // Food, activities and local transport are not modelled yet. They stay
        // absent rather than guessed; the cost engine already reports an
        // unpriced transfer as an excluded line rather than a zero.
        extraCosts: [],
      });
    }
  }

  if (candidates.length <= limits.maxCandidatesPerRoute) return candidates;

  return candidates
    .sort(
      (a, b) =>
        a.flight.price.amount +
          (a.hotel?.totalPrice.amount ?? 0) -
          (b.flight.price.amount + (b.hotel?.totalPrice.amount ?? 0)) || a.id.localeCompare(b.id),
    )
    .slice(0, limits.maxCandidatesPerRoute);
}

/**
 * Round-robin several groups into one list.
 *
 * Used to apply the global candidate cap without starving a destination: taking
 * the first N of a concatenated list would spend the whole budget on whichever
 * route happened to be assembled first, and the user would never see the other
 * five destinations they asked about.
 */
export function interleave<T>(groups: readonly (readonly T[])[]): T[] {
  const longest = groups.reduce((length, group) => Math.max(length, group.length), 0);
  const merged: T[] = [];

  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (item !== undefined) merged.push(item);
    }
  }

  return merged;
}
