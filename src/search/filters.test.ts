import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildFlightOffer, buildHotelOffer, buildLeg } from '@/core/trip/test-support';
import { buildRankedTrip } from '@/components/search/test-support';
import {
  applyFilters,
  hasActiveFilters,
  matchesFilters,
  NO_FILTERS,
  parseFilters,
} from './filters';

/**
 * Narrowing a result set.
 *
 * The rule running through all of it: an unknown fact never silently passes or
 * fails a filter. A hotel with no review score is not "below 8", and a flight
 * that did not say whether it is self-transfer is not "not self-transfer".
 */

describe('parseFilters', () => {
  it('reads what was asked for', () => {
    const filters = parseFilters(
      { fMaxTotal: '700', fDirect: 'on', fMinReview: '8.5', fMaxStops: '1' },
      'EUR',
    );

    expect(filters.maxTotal).toEqual(money(70000, 'EUR'));
    expect(filters.directOnly).toBe(true);
    expect(filters.minReviewScore).toBe(8.5);
    expect(filters.maxStops).toBe(1);
  });

  it('ignores anything unreadable rather than narrowing or failing', () => {
    // A malformed filter must not hide trips nobody asked to hide, and must
    // not show an error where the user expected results.
    const filters = parseFilters({ fMaxTotal: 'abc', fMinReview: '', fMaxStops: 'lots' }, 'EUR');

    expect(filters.maxTotal).toBeNull();
    expect(filters.minReviewScore).toBeNull();
    expect(filters.maxStops).toBeNull();
    expect(hasActiveFilters(filters)).toBe(false);
  });

  it('treats an empty parameter set as no filters at all', () => {
    expect(parseFilters({}, 'EUR')).toEqual(NO_FILTERS);
  });
});

describe('price', () => {
  it('hides a trip over the cap and keeps one exactly on it', () => {
    const trip = buildRankedTrip();
    const total = trip.cost.total.amount;

    expect(matchesFilters(trip, { ...NO_FILTERS, maxTotal: money(total, 'EUR') })).toBe(true);
    expect(matchesFilters(trip, { ...NO_FILTERS, maxTotal: money(total - 1, 'EUR') })).toBe(false);
  });
});

describe('flights', () => {
  const connecting = () =>
    buildRankedTrip({
      flight: buildFlightOffer({
        outbound: buildLeg({
          segments: [
            {
              origin: 'VIE',
              destination: 'IST',
              departsAt: '2026-06-10T09:00:00',
              arrivesAt: '2026-06-10T11:00:00',
              carrier: 'TK',
              flightNumber: 'TK1',
            },
            {
              origin: 'IST',
              destination: 'AYT',
              departsAt: '2026-06-10T13:00:00',
              arrivesAt: '2026-06-10T14:30:00',
              carrier: 'TK',
              flightNumber: 'TK2',
            },
          ],
        }),
      }),
    });

  it('keeps direct trips and drops connecting ones', () => {
    expect(matchesFilters(buildRankedTrip(), { ...NO_FILTERS, directOnly: true })).toBe(true);
    expect(matchesFilters(connecting(), { ...NO_FILTERS, directOnly: true })).toBe(false);
  });

  it('counts stops on the busier leg', () => {
    // "One stop" has to mean the journey, not the better half of it.
    expect(matchesFilters(connecting(), { ...NO_FILTERS, maxStops: 1 })).toBe(true);
    expect(matchesFilters(connecting(), { ...NO_FILTERS, maxStops: 0 })).toBe(false);
  });

  it('filters on the local clock at each airport', () => {
    const trip = buildRankedTrip();

    // The fixture departs 09:30 local and lands 12:15 local.
    expect(matchesFilters(trip, { ...NO_FILTERS, departAfterHour: 9 })).toBe(true);
    expect(matchesFilters(trip, { ...NO_FILTERS, departAfterHour: 10 })).toBe(false);
    expect(matchesFilters(trip, { ...NO_FILTERS, arriveBeforeHour: 13 })).toBe(true);
    expect(matchesFilters(trip, { ...NO_FILTERS, arriveBeforeHour: 11 })).toBe(false);
  });

  it('does not treat an unstated self-transfer as a confirmed no', () => {
    // The whole point of the null: silence is not safety.
    const unstated = buildRankedTrip({
      flight: buildFlightOffer({
        outbound: buildLeg({ selfTransfer: null }),
        inbound: buildLeg({ selfTransfer: null }),
      }),
    });

    expect(matchesFilters(unstated, { ...NO_FILTERS, excludeSelfTransfer: true })).toBe(false);
    expect(matchesFilters(buildRankedTrip(), { ...NO_FILTERS, excludeSelfTransfer: true })).toBe(
      true,
    );
  });
});

describe('hotels', () => {
  it('drops an unrated hotel when a minimum score was asked for', () => {
    // Unrated is not "below the bar"; it is unknown, and the user asked for a
    // score they could rely on.
    const unrated = buildRankedTrip({ hotel: buildHotelOffer({ reviewScore: null }) });

    expect(matchesFilters(unrated, { ...NO_FILTERS, minReviewScore: 8 })).toBe(false);
    expect(matchesFilters(unrated, NO_FILTERS)).toBe(true);
  });

  it('honours free cancellation', () => {
    const nonRefundable = buildRankedTrip({
      hotel: buildHotelOffer({ freeCancellation: false }),
    });

    expect(matchesFilters(nonRefundable, { ...NO_FILTERS, freeCancellationOnly: true })).toBe(
      false,
    );
  });
});

describe('transfers', () => {
  it('can require one that was actually priced', () => {
    const unpriced = buildRankedTrip({ transfer: null });

    expect(matchesFilters(unpriced, { ...NO_FILTERS, requirePricedTransfer: true })).toBe(false);
    expect(matchesFilters(buildRankedTrip(), { ...NO_FILTERS, requirePricedTransfer: true })).toBe(
      true,
    );
  });
});

describe('applyFilters', () => {
  it('reports how many it removed, so the page can say so', () => {
    const trips = [buildRankedTrip(), buildRankedTrip({ transfer: null })];

    const { trips: kept, hidden } = applyFilters(trips, {
      ...NO_FILTERS,
      requirePricedTransfer: true,
    });

    expect(kept).toHaveLength(1);
    expect(hidden).toBe(1);
  });

  it('changes nothing when no filter is active', () => {
    const trips = [buildRankedTrip(), buildRankedTrip()];
    expect(applyFilters(trips, NO_FILTERS)).toEqual({ trips, hidden: 0 });
  });
});

describe('the date filter', () => {
  it('keeps only trips on the chosen dates', () => {
    const june10 = buildRankedTrip({
      id: 'a',
      dates: { departureDate: '2026-06-10', returnDate: '2026-06-15', nights: 5 },
    });
    const june17 = buildRankedTrip({
      id: 'b',
      dates: { departureDate: '2026-06-17', returnDate: '2026-06-22', nights: 5 },
    });

    const { trips, hidden } = applyFilters([june10, june17], {
      ...NO_FILTERS,
      dates: '2026-06-10..2026-06-15',
    });

    expect(trips.map((trip) => trip.candidate.id)).toEqual(['a']);
    expect(hidden).toBe(1);
  });

  it('ignores a date filter that is not a pair of dates', () => {
    // A malformed filter must not narrow a result set nobody asked to narrow,
    // and must not fail the page where the user expected trips.
    expect(parseFilters({ fDates: 'june-ish' }, 'EUR').dates).toBeNull();
    expect(parseFilters({ fDates: '2026-06-10' }, 'EUR').dates).toBeNull();
  });

  it('reads a well-formed window', () => {
    expect(parseFilters({ fDates: '2026-06-10..2026-06-15' }, 'EUR').dates).toBe(
      '2026-06-10..2026-06-15',
    );
  });

  it('counts as an active filter', () => {
    expect(hasActiveFilters({ ...NO_FILTERS, dates: '2026-06-10..2026-06-15' })).toBe(true);
  });
});

describe('the destination filter', () => {
  it('keeps only trips to the chosen place', () => {
    const antalya = buildRankedTrip({ id: 'a', destination: 'AYT' });
    const split = buildRankedTrip({ id: 'b', destination: 'SPU' });

    const { trips, hidden } = applyFilters([antalya, split], {
      ...NO_FILTERS,
      destination: 'AYT',
    });

    expect(trips.map((trip) => trip.candidate.id)).toEqual(['a']);
    expect(hidden).toBe(1);
  });

  it('reads an airport code however it was cased', () => {
    expect(parseFilters({ fDest: 'ayt' }, 'EUR').destination).toBe('AYT');
  });

  it('ignores anything that is not an airport code', () => {
    expect(parseFilters({ fDest: 'Antalya' }, 'EUR').destination).toBeNull();
    expect(parseFilters({ fDest: '' }, 'EUR').destination).toBeNull();
  });

  it('counts as an active filter', () => {
    expect(hasActiveFilters({ ...NO_FILTERS, destination: 'AYT' })).toBe(true);
  });
});
