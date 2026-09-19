import type { AirportCode, FlightOffer, HotelOffer, TripDates } from './types';

/**
 * A content-derived candidate id.
 *
 * Deliberately not a counter or a UUID: the same combination must carry the
 * same id on every run, so price history, alerts and "what changed since
 * yesterday" line up across refreshes.
 *
 * In `core` rather than beside the search assembler because swapping a
 * component also has to produce a correct id, and two places deriving ids their
 * own way is two ids for one trip.
 */
export function candidateId(
  origin: AirportCode,
  destination: AirportCode,
  dates: Pick<TripDates, 'departureDate' | 'nights'>,
  flight: Pick<FlightOffer, 'id'>,
  hotel: Pick<HotelOffer, 'id'>,
): string {
  return [origin, destination, dates.departureDate, `${dates.nights}n`, flight.id, hotel.id].join(
    '|',
  );
}
