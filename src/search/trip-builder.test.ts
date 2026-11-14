import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildFlightOffer, buildHotelOffer, buildProfile } from '@/core/trip/test-support';
import { buildRankedTrip } from '@/components/search/test-support';
import { buildTrip } from './trip-builder';
import type { SearchOutcome } from './types';

/**
 * Building a trip from the parts the search priced.
 *
 * What is defended: every total a built trip shows is one the engine
 * produced for that exact combination, choices only ever come from what the
 * search saw, and a choice nobody can honour is ignored rather than invented.
 */

const profile = buildProfile();

/** An outcome whose route offers hold every flight and hotel the trips carry. */
function outcomeOf(...trips: ReturnType<typeof buildRankedTrip>[]): SearchOutcome {
  const first = trips[0]!;
  const sameRoute = trips.filter(
    (trip) =>
      trip.candidate.destination === first.candidate.destination &&
      trip.candidate.dates.departureDate === first.candidate.dates.departureDate,
  );

  return {
    results: trips,
    nearMisses: [],
    routeOffers: [
      {
        destination: first.candidate.destination,
        departureDate: first.candidate.dates.departureDate,
        nights: first.candidate.dates.nights,
        flights: sameRoute.map((trip) => trip.candidate.flight),
        hotels: sameRoute.map((trip) => trip.candidate.hotel),
      },
    ],
    destinationSummaries: [],
    diagnostics: {},
  } as unknown as SearchOutcome;
}

const earlyCheapFlight = buildFlightOffer({
  id: 'flight-early',
  price: money(20000, 'EUR'),
  outbound: {
    ...buildFlightOffer().outbound,
    segments: [
      {
        ...buildFlightOffer().outbound.segments[0]!,
        departsAt: '2026-06-10T06:00:00',
        arrivesAt: '2026-06-10T08:45:00',
      },
    ],
  },
});

const otherHotel = buildHotelOffer({ id: 'hotel-other', totalPrice: money(30000, 'EUR') });

describe('buildTrip', () => {
  it('leaves a trip alone when nothing was chosen', () => {
    const original = buildRankedTrip();
    const built = buildTrip({ outcome: outcomeOf(original), profile, original });

    expect(built.trip).toBe(original);
    expect(built.customised).toBe(false);
    expect(built.deltaFromOriginal).toBeNull();
  });

  it('swaps in a chosen flight and reports what it changed on the whole trip', () => {
    const original = buildRankedTrip();
    const other = buildRankedTrip({ id: 'candidate-2', flight: earlyCheapFlight });

    const built = buildTrip({
      outcome: outcomeOf(original, other),
      profile,
      original,
      flightId: 'flight-early',
    });

    expect(built.customised).toBe(true);
    expect(built.trip.candidate.flight.id).toBe('flight-early');
    // The engine's total for the built trip, against the engine's original.
    expect(built.deltaFromOriginal).toEqual(
      money(built.trip.cost.total.amount - original.cost.total.amount, 'EUR'),
    );
    expect(built.deltaFromOriginal!.amount).toBeLessThan(0);
  });

  it('composes a flight and a hotel choice into one trip', () => {
    const original = buildRankedTrip();
    const withFlight = buildRankedTrip({ id: 'candidate-2', flight: earlyCheapFlight });
    const withHotel = buildRankedTrip({ id: 'candidate-3', hotel: otherHotel });

    const built = buildTrip({
      outcome: outcomeOf(original, withFlight, withHotel),
      profile,
      original,
      flightId: 'flight-early',
      hotelId: 'hotel-other',
    });

    expect(built.trip.candidate.flight.id).toBe('flight-early');
    expect(built.trip.candidate.hotel!.id).toBe('hotel-other');
  });

  it('ignores a choice the search never saw', () => {
    const original = buildRankedTrip();
    const built = buildTrip({
      outcome: outcomeOf(original),
      profile,
      original,
      flightId: 'made-up',
      hotelId: 'also-made-up',
    });

    expect(built.trip).toBe(original);
    expect(built.customised).toBe(false);
  });

  it('says how much earlier or later each other flight leaves', () => {
    const original = buildRankedTrip();
    const other = buildRankedTrip({ id: 'candidate-2', flight: earlyCheapFlight });

    const built = buildTrip({ outcome: outcomeOf(original, other), profile, original });
    const early = built.flights.find((flight) => flight.offerId === 'flight-early');
    const own = built.flights.find((flight) => flight.isCurrent);

    expect(own?.departureShiftMinutes).toBe(0);
    expect(early?.departureShiftMinutes).toBeLessThan(0);
  });

  it('offers other dates for the same place and length of stay, and nothing else', () => {
    const original = buildRankedTrip();
    const dayLater = buildRankedTrip({
      id: 'candidate-later',
      dates: { departureDate: '2026-06-11', returnDate: '2026-06-16', nights: 5 },
    });
    const longer = buildRankedTrip({
      id: 'candidate-longer',
      dates: { departureDate: '2026-06-12', returnDate: '2026-06-19', nights: 7 },
    });
    const elsewhere = buildRankedTrip({
      id: 'candidate-elsewhere',
      destination: 'CHQ',
      destinationName: 'Chania',
      dates: { departureDate: '2026-06-12', returnDate: '2026-06-17', nights: 5 },
    });

    const built = buildTrip({
      outcome: outcomeOf(original, dayLater, longer, elsewhere),
      profile,
      original,
    });

    expect(built.dates.map((choice) => choice.trip.candidate.id)).toEqual(['candidate-later']);
    expect(built.dates[0]?.shiftDays).toBe(1);
    expect(built.dates[0]?.totalDelta?.currency).toBe('EUR');
  });
});
