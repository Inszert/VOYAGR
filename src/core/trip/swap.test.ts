import { describe, expect, it } from 'vitest';
import { money } from '../money';
import { evaluateTrip } from '@/search/evaluate';
import {
  buildCandidate,
  buildFlightOffer,
  buildHotelOffer,
  buildLeg,
  buildProfile,
  buildTransferOffer,
} from './test-support';
import { swapFlight, swapHotel, swapTransfer, SwapError } from './swap';

/**
 * Component swapping.
 *
 * Phase 1.10's "done when" is that swapping a flight updates *every* derived
 * figure consistently - not the total alone. So these tests check the total,
 * the usable time, the score and the warnings together, and check them by
 * running the same engines the search runs.
 */

const profile = buildProfile();

/** A replacement flight that lands later and departs earlier: a worse day. */
function laterFlight(overrides: Parameters<typeof buildFlightOffer>[0] = {}) {
  return buildFlightOffer({
    id: 'flight-late',
    price: money(24000, 'EUR'),
    outbound: buildLeg({
      segments: [
        {
          origin: 'VIE',
          destination: 'AYT',
          departsAt: '2026-06-10T20:30:00',
          arrivesAt: '2026-06-10T23:40:00',
          carrier: 'FR',
          flightNumber: 'FR1',
        },
      ],
    }),
    inbound: buildLeg({
      segments: [
        {
          origin: 'AYT',
          destination: 'VIE',
          departsAt: '2026-06-15T05:50:00',
          arrivesAt: '2026-06-15T08:20:00',
          carrier: 'FR',
          flightNumber: 'FR2',
        },
      ],
    }),
    ...overrides,
  });
}

describe('swapFlight', () => {
  it('updates every derived figure, not just the total', () => {
    const original = buildCandidate();
    const before = evaluateTrip(original, profile);
    const after = evaluateTrip(swapFlight(original, laterFlight()), profile);

    // Cheaper flight, so a cheaper trip.
    expect(after.cost.total.amount).toBeLessThan(before.cost.total.amount);
    // But it lands at 23:40 and leaves at 05:50, so the holiday is shorter.
    expect(after.usableTime.totalMinutes).toBeLessThan(before.usableTime.totalMinutes);
    // And the score moves with them rather than staying on the old trip.
    expect(after.score.score).not.toBe(before.score.score);
    // The No-Surprise check re-runs too.
    expect(after.warnings.some((warning) => warning.code === 'LATE_ARRIVAL')).toBe(true);
    expect(before.warnings.some((warning) => warning.code === 'LATE_ARRIVAL')).toBe(false);
  });

  it('keeps the score equal to the sum of its reported contributions', () => {
    // The explainability guarantee has to survive a swap.
    const after = evaluateTrip(swapFlight(buildCandidate(), laterFlight()), profile);
    const summed = after.score.factors.reduce((total, factor) => total + factor.contribution, 0);

    expect(after.score.score).toBe(Math.round(Math.min(1, summed) * 100));
  });

  it('keeps the total equal to the lines it is made of', () => {
    const after = evaluateTrip(swapFlight(buildCandidate(), laterFlight()), profile);
    const counted = after.cost.lines
      .filter((line) => line.confidence !== 'excluded')
      .reduce((total, line) => total + line.amount.amount, 0);

    expect(after.cost.total.amount).toBe(counted);
  });

  it('gives the swapped trip its own id, so history does not confuse the two', () => {
    const original = buildCandidate();
    const swapped = swapFlight(original, laterFlight());

    expect(swapped.id).not.toBe(original.id);
    expect(original.flight.id).toBe('flight-1');
  });

  it('does not mutate the trip it was given', () => {
    // A swap is usually shown beside the original. Mutating would change the
    // thing being compared against.
    const original = buildCandidate();
    swapFlight(original, laterFlight());

    expect(original.flight.id).toBe('flight-1');
  });

  it('follows the flight to a different departure airport', () => {
    const fromBratislava = buildFlightOffer({
      id: 'flight-bts',
      outbound: buildLeg({
        segments: [
          {
            origin: 'BTS',
            destination: 'AYT',
            departsAt: '2026-06-10T09:30:00',
            arrivesAt: '2026-06-10T12:15:00',
            carrier: 'W6',
            flightNumber: 'W61',
          },
        ],
      }),
    });

    expect(swapFlight(buildCandidate(), fromBratislava).origin).toBe('BTS');
  });

  it('refuses a flight to a different city', () => {
    // Not a swap - a different holiday, with the hotel in the wrong country.
    const elsewhere = buildFlightOffer({
      id: 'flight-chq',
      outbound: buildLeg({
        segments: [
          {
            origin: 'VIE',
            destination: 'CHQ',
            departsAt: '2026-06-10T09:30:00',
            arrivesAt: '2026-06-10T12:15:00',
            carrier: 'OS',
            flightNumber: 'OS9',
          },
        ],
      }),
    });

    expect(() => swapFlight(buildCandidate(), elsewhere)).toThrow(SwapError);
  });

  it('refuses a flight priced in another currency', () => {
    const inPounds = buildFlightOffer({ id: 'flight-gbp', price: money(20000, 'GBP') });

    // Better to say why here than to fail inside a total nobody can trace.
    expect(() => swapFlight(buildCandidate(), inPounds)).toThrow(SwapError);
  });

  it('refuses a flight with no segments', () => {
    const empty = buildFlightOffer({ id: 'flight-empty', outbound: buildLeg({ segments: [] }) });
    expect(() => swapFlight(buildCandidate(), empty)).toThrow(SwapError);
  });
});

describe('swapHotel', () => {
  it('updates cost, quality and location together', () => {
    const original = buildCandidate();
    const before = evaluateTrip(original, profile);

    const dearerAndBetter = buildHotelOffer({
      id: 'hotel-2',
      name: 'Hotel Bellavista',
      totalPrice: money(42000, 'EUR'),
      reviewScore: 9.4,
      distanceToBeachMetres: 80,
    });

    const after = evaluateTrip(swapHotel(original, dearerAndBetter), profile);

    expect(after.cost.total.amount).toBeGreaterThan(before.cost.total.amount);
    expect(after.score.factors.find((f) => f.key === 'hotel_quality')!.value).toBeGreaterThan(
      before.score.factors.find((f) => f.key === 'hotel_quality')!.value,
    );
    expect(after.score.factors.find((f) => f.key === 'location')!.value).toBeGreaterThan(
      before.score.factors.find((f) => f.key === 'location')!.value,
    );
    // The stay did not move, so the holiday is exactly as long.
    expect(after.usableTime.totalMinutes).toBe(before.usableTime.totalMinutes);
  });

  it('re-runs eligibility, so a swap can take a trip over budget', () => {
    const tight = buildProfile({ maxBudget: money(70000, 'EUR') });
    const original = buildCandidate();

    expect(evaluateTrip(original, tight).eligibility.eligible).toBe(true);

    const expensive = buildHotelOffer({ id: 'hotel-lux', totalPrice: money(90000, 'EUR') });
    const after = evaluateTrip(swapHotel(original, expensive), tight);

    expect(after.eligibility.eligible).toBe(false);
    expect(after.eligibility.violations.some((v) => v.code === 'OVER_MAX_BUDGET')).toBe(true);
  });

  it('carries a non-refundable rate into the warnings', () => {
    const nonRefundable = buildHotelOffer({ id: 'hotel-nr', freeCancellation: false });
    const after = evaluateTrip(swapHotel(buildCandidate(), nonRefundable), profile);

    expect(after.warnings.some((warning) => warning.code === 'NON_REFUNDABLE')).toBe(true);
  });

  it('refuses a hotel priced in another currency', () => {
    const inPounds = buildHotelOffer({ id: 'hotel-gbp', totalPrice: money(30000, 'GBP') });
    expect(() => swapHotel(buildCandidate(), inPounds)).toThrow(SwapError);
  });
});

describe('swapTransfer', () => {
  it('re-prices the trip when a different ride is chosen', () => {
    const original = buildCandidate();
    const before = evaluateTrip(original, profile);

    const privateCar = buildTransferOffer({
      id: 'transfer-private',
      mode: 'private',
      pricePerDirection: money(4200, 'EUR'),
      durationMinutes: 30,
    });

    const after = evaluateTrip(swapTransfer(original, privateCar), profile);

    // Both directions, so the difference is doubled.
    expect(after.cost.total.amount - before.cost.total.amount).toBe(2 * (4200 - 1600));
    expect(after.usableTime.totalMinutes).toBeGreaterThan(before.usableTime.totalMinutes);
  });

  it('turns removing the transfer into an excluded cost, never a zero', () => {
    // "We will sort our own way there" is a legitimate choice, and the total
    // has to stay honest about what it no longer covers.
    const after = evaluateTrip(swapTransfer(buildCandidate(), null), profile);

    expect(after.candidate.transfer).toBeNull();
    expect(after.cost.excluded.some((line) => line.category === 'transfer')).toBe(true);
    expect(after.warnings.some((warning) => warning.code === 'NO_TRANSFER_PRICED')).toBe(true);
  });

  it('keeps the trip id, because the ride in from the airport is not the trip', () => {
    // Moving the id here would break the price history of a watch whose owner
    // merely changed how they get in from the airport.
    const original = buildCandidate();
    expect(swapTransfer(original, null).id).toBe(original.id);
  });

  it('refuses a transfer priced in another currency', () => {
    const inPounds = buildTransferOffer({ pricePerDirection: money(1600, 'GBP') });
    expect(() => swapTransfer(buildCandidate(), inPounds)).toThrow(SwapError);
  });
});
