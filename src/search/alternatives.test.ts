import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { buildRankedTrip } from '@/components/search/test-support';
import { flightAlternatives, hotelAlternatives } from './alternatives';
import type { SearchOutcome } from './types';

/**
 * Alternatives for a trip on screen.
 *
 * The property being defended: an alternative is offered as a *whole trip*,
 * priced and scored, not as a component price. A cheaper flight that lands at
 * midnight often makes the holiday worse, and a list of fares would invite
 * exactly that mistake.
 */

const profile = buildProfile();

/**
 * An outcome whose route offers hold every component the trips carry.
 *
 * Mirrors what the orchestrator does: swap options come from everything the
 * search evaluated, not from the trips that survived ranking.
 */
function outcomeOf(...trips: ReturnType<typeof buildRankedTrip>[]): SearchOutcome {
  const first = trips[0]!;

  const routeOffers = [
    {
      destination: first.candidate.destination,
      departureDate: first.candidate.dates.departureDate,
      nights: first.candidate.dates.nights,
      flights: trips
        .filter((trip) => trip.candidate.destination === first.candidate.destination)
        .map((trip) => trip.candidate.flight),
      hotels: trips
        .filter((trip) => trip.candidate.destination === first.candidate.destination)
        .map((trip) => trip.candidate.hotel),
    },
  ];

  return {
    results: trips,
    nearMisses: [],
    routeOffers,
    diagnostics: {},
  } as unknown as SearchOutcome;
}

describe('flightAlternatives', () => {
  it('marks the flight already chosen and puts it first', () => {
    const current = buildRankedTrip();
    const alternatives = flightAlternatives({ outcome: outcomeOf(current), current, profile });

    expect(alternatives[0]?.isCurrent).toBe(true);
    expect(alternatives[0]?.totalDeltaMinorUnits).toBe(0);
    expect(alternatives[0]?.scoreDelta).toBe(0);
  });

  it('prices each option as the whole trip it would make', () => {
    const current = buildRankedTrip();
    const cheaperFlight = buildRankedTrip({
      flight: { ...current.candidate.flight, id: 'flight-cheap', price: money(20000, 'EUR') },
    });

    const alternatives = flightAlternatives({
      outcome: outcomeOf(current, cheaperFlight),
      current,
      profile,
    });

    const option = alternatives.find((entry) => entry.offerId === 'flight-cheap');

    // The trip total, not the fare: hotel and transfer are still in there.
    expect(option?.trip.cost.total.amount).toBeGreaterThan(20000);
    expect(option?.totalDeltaMinorUnits).toBe(20000 - current.candidate.flight.price.amount);
  });

  it('reports the score change alongside the price change', () => {
    const current = buildRankedTrip();
    const other = buildRankedTrip({
      flight: { ...current.candidate.flight, id: 'flight-2', price: money(20000, 'EUR') },
    });

    const option = flightAlternatives({
      outcome: outcomeOf(current, other),
      current,
      profile,
    }).find((entry) => entry.offerId === 'flight-2');

    // Neither number answers "is this better?" on its own.
    expect(option?.scoreDelta).toBeTypeOf('number');
    expect(option?.trip.score.score).toBeGreaterThan(0);
  });

  it('offers each distinct flight once', () => {
    const current = buildRankedTrip();
    const alternatives = flightAlternatives({
      outcome: outcomeOf(current, buildRankedTrip(), buildRankedTrip()),
      current,
      profile,
    });

    expect(alternatives).toHaveLength(1);
  });

  it('ignores trips to somewhere else entirely', () => {
    // A flight to another city is a different holiday, not a swap.
    const current = buildRankedTrip();
    const elsewhere = buildRankedTrip({ destination: 'CHQ', destinationName: 'Chania' });

    const alternatives = flightAlternatives({
      outcome: outcomeOf(current, elsewhere),
      current,
      profile,
    });

    expect(alternatives).toHaveLength(1);
    expect(alternatives[0]?.isCurrent).toBe(true);
  });

  it('drops an option it cannot swap in rather than breaking the page', () => {
    const current = buildRankedTrip();

    // Built by hand rather than through `buildRankedTrip`, which costs the trip
    // as it builds it and would throw on the mixed currency before the code
    // under test ever ran. Only `candidate.flight` is read from this.
    const base = buildRankedTrip();
    const wrongCurrency = {
      ...base,
      candidate: {
        ...base.candidate,
        flight: { ...base.candidate.flight, id: 'flight-gbp', price: money(20000, 'GBP') },
      },
    };

    const alternatives = flightAlternatives({
      outcome: outcomeOf(current, wrongCurrency),
      current,
      profile,
    });

    expect(alternatives.map((entry) => entry.offerId)).not.toContain('flight-gbp');
  });
});

describe('hotelAlternatives', () => {
  it('evaluates a different hotel as a complete trip', () => {
    const current = buildRankedTrip();
    const dearer = buildRankedTrip({
      hotel: { ...current.candidate.hotel, id: 'hotel-2', totalPrice: money(52000, 'EUR') },
    });

    const option = hotelAlternatives({
      outcome: outcomeOf(current, dearer),
      current,
      profile,
    }).find((entry) => entry.offerId === 'hotel-2');

    expect(option?.totalDeltaMinorUnits).toBe(52000 - current.candidate.hotel.totalPrice.amount);
    expect(option?.trip.candidate.flight.id).toBe(current.candidate.flight.id);
  });

  it('still offers an option that would breach the budget, marked as such', () => {
    // Hiding it would be deciding for the user; the card says it is outside
    // their limits and lets them choose.
    const tight = buildProfile({ maxBudget: money(70000, 'EUR') });
    const current = buildRankedTrip();
    const expensive = buildRankedTrip({
      hotel: { ...current.candidate.hotel, id: 'hotel-lux', totalPrice: money(90000, 'EUR') },
    });

    const option = hotelAlternatives({
      outcome: outcomeOf(current, expensive),
      current,
      profile: tight,
    }).find((entry) => entry.offerId === 'hotel-lux');

    expect(option).toBeDefined();
    expect(option?.trip.eligibility.eligible).toBe(false);
  });
});
