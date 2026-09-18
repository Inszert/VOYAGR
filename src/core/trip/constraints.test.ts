import { describe, expect, it } from 'vitest';
import { money } from '../money';
import { costTripCandidate } from './cost';
import { detectTravelWarnings, evaluateEligibility } from './constraints';
import {
  buildCandidate,
  buildFlightOffer,
  buildHotelOffer,
  buildLeg,
  buildProfile,
  buildWeather,
} from './test-support';

function codesOf(candidate = buildCandidate(), profile = buildProfile()) {
  const cost = costTripCandidate(candidate);
  return evaluateEligibility(candidate, cost, profile).violations.map(
    (violation) => violation.code,
  );
}

describe('budget enforcement', () => {
  it('accepts a trip inside the maximum budget', () => {
    const candidate = buildCandidate();
    const cost = costTripCandidate(candidate);
    const result = evaluateEligibility(candidate, cost, buildProfile());

    expect(result.eligible).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('rejects a trip one minor unit over the maximum', () => {
    // The boundary is the whole point: a hard ceiling that bends is not a
    // ceiling, and the model must never be able to argue past it.
    const candidate = buildCandidate();
    const cost = costTripCandidate(candidate);
    const profile = buildProfile({ maxBudget: money(cost.total.amount - 1, 'EUR') });

    const result = evaluateEligibility(candidate, cost, profile);

    expect(result.eligible).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain('OVER_MAX_BUDGET');
  });

  it('accepts a trip exactly at the maximum budget', () => {
    const candidate = buildCandidate();
    const cost = costTripCandidate(candidate);
    const profile = buildProfile({ maxBudget: money(cost.total.amount, 'EUR') });

    expect(evaluateEligibility(candidate, cost, profile).eligible).toBe(true);
  });

  it('reports headroom against both budgets', () => {
    const candidate = buildCandidate();
    const cost = costTripCandidate(candidate);
    const profile = buildProfile();
    const result = evaluateEligibility(candidate, cost, profile);

    expect(result.budgetHeadroom.amount).toBe(profile.maxBudget.amount - cost.total.amount);
    expect(result.targetHeadroom.amount).toBe(profile.targetBudget.amount - cost.total.amount);
  });

  it('subtracts a reserve from the discretionary budget', () => {
    // Money the user set aside for food is not money available for a hotel
    // upgrade (specification section 31.6).
    const candidate = buildCandidate();
    const cost = costTripCandidate(candidate);
    const profile = buildProfile({ reserveBudget: money(6000, 'EUR') });
    const result = evaluateEligibility(candidate, cost, profile);

    expect(result.discretionaryBudget.amount).toBe(result.targetHeadroom.amount - 6000);
  });
});

describe('duration and date window', () => {
  it('rejects a stay shorter than the minimum', () => {
    const candidate = buildCandidate({
      dates: { departureDate: '2026-06-10', returnDate: '2026-06-12', nights: 2 },
    });

    expect(codesOf(candidate)).toContain('NIGHTS_BELOW_MINIMUM');
  });

  it('rejects a stay longer than the maximum', () => {
    const candidate = buildCandidate({
      dates: { departureDate: '2026-06-10', returnDate: '2026-06-24', nights: 14 },
    });

    expect(codesOf(candidate)).toContain('NIGHTS_ABOVE_MAXIMUM');
  });

  it('rejects departure before the window opens', () => {
    const candidate = buildCandidate({
      dates: { departureDate: '2026-05-20', returnDate: '2026-05-25', nights: 5 },
    });

    expect(codesOf(candidate)).toContain('DEPARTURE_BEFORE_WINDOW');
  });

  it('rejects return after the window closes', () => {
    const candidate = buildCandidate({
      dates: { departureDate: '2026-06-28', returnDate: '2026-07-03', nights: 5 },
    });

    expect(codesOf(candidate)).toContain('RETURN_AFTER_WINDOW');
  });
});

describe('explicit user requirements', () => {
  it('rejects a connecting itinerary when direct flights were required', () => {
    const connecting = buildLeg({
      segments: [
        {
          origin: 'VIE',
          destination: 'IST',
          departsAt: '2026-06-10T09:30:00Z',
          arrivesAt: '2026-06-10T11:00:00Z',
          carrier: 'TK',
          flightNumber: 'TK1',
        },
        {
          origin: 'IST',
          destination: 'AYT',
          departsAt: '2026-06-10T12:30:00Z',
          arrivesAt: '2026-06-10T13:45:00Z',
          carrier: 'TK',
          flightNumber: 'TK2',
        },
      ],
    });

    const candidate = buildCandidate({ flight: buildFlightOffer({ outbound: connecting }) });

    expect(codesOf(candidate, buildProfile({ requireDirectFlights: true }))).toContain(
      'DIRECT_FLIGHT_REQUIRED',
    );
  });

  it('rejects cabin-baggage-only fares when checked baggage was required', () => {
    const candidate = buildCandidate({
      flight: buildFlightOffer({ outbound: buildLeg({ checkedBaggageIncluded: false }) }),
    });

    expect(codesOf(candidate, buildProfile({ requireCheckedBaggage: true }))).toContain(
      'CHECKED_BAGGAGE_REQUIRED',
    );
  });

  it('rejects a non-refundable rate when free cancellation was required', () => {
    const candidate = buildCandidate({ hotel: buildHotelOffer({ freeCancellation: false }) });

    expect(codesOf(candidate, buildProfile({ requireFreeCancellation: true }))).toContain(
      'FREE_CANCELLATION_REQUIRED',
    );
  });

  it('rejects a hotel below the required review score', () => {
    const candidate = buildCandidate({ hotel: buildHotelOffer({ reviewScore: 6.1 }) });

    expect(codesOf(candidate, buildProfile({ minHotelReviewScore: 8 }))).toContain(
      'HOTEL_REVIEW_SCORE_TOO_LOW',
    );
  });

  it('does not reject an unrated hotel on review score', () => {
    // Unknown is not the same as bad; filtering it out would hide new properties.
    const candidate = buildCandidate({ hotel: buildHotelOffer({ reviewScore: null }) });

    expect(codesOf(candidate, buildProfile({ minHotelReviewScore: 8 }))).not.toContain(
      'HOTEL_REVIEW_SCORE_TOO_LOW',
    );
  });

  it('rejects a hotel beyond the beach distance limit', () => {
    const candidate = buildCandidate({ hotel: buildHotelOffer({ distanceToBeachMetres: 4200 }) });

    expect(codesOf(candidate, buildProfile({ maxBeachDistanceMetres: 800 }))).toContain(
      'BEACH_TOO_FAR',
    );
  });

  it('rejects a mismatched departure airport', () => {
    const candidate = buildCandidate({ origin: 'BTS' });
    expect(codesOf(candidate)).toContain('ORIGIN_NOT_ALLOWED');
  });

  it('rejects a trip priced for a different party size', () => {
    const candidate = buildCandidate({ passengers: 3 });
    expect(codesOf(candidate)).toContain('PASSENGER_COUNT_MISMATCH');
  });
});

describe('violation collection', () => {
  it('reports every violation rather than stopping at the first', () => {
    // The UI needs to explain everything wrong with a near-miss at once.
    const candidate = buildCandidate({
      origin: 'BTS',
      passengers: 4,
      dates: { departureDate: '2026-06-10', returnDate: '2026-06-12', nights: 2 },
    });

    const codes = codesOf(candidate);

    expect(codes).toContain('ORIGIN_NOT_ALLOWED');
    expect(codes).toContain('PASSENGER_COUNT_MISMATCH');
    expect(codes).toContain('NIGHTS_BELOW_MINIMUM');
  });
});

describe('travel warnings', () => {
  function warn(candidate = buildCandidate()) {
    return detectTravelWarnings(candidate, costTripCandidate(candidate)).map((w) => w.code);
  }

  it('flags self-transfer connections', () => {
    const candidate = buildCandidate({
      flight: buildFlightOffer({ outbound: buildLeg({ selfTransfer: true }) }),
    });

    expect(warn(candidate)).toContain('SELF_TRANSFER_RISK');
  });

  it('flags cabin-baggage-only fares', () => {
    const candidate = buildCandidate({
      flight: buildFlightOffer({ outbound: buildLeg({ checkedBaggageIncluded: false }) }),
    });

    expect(warn(candidate)).toContain('CABIN_BAGGAGE_ONLY');
  });

  it('flags a very late arrival', () => {
    const candidate = buildCandidate({
      flight: buildFlightOffer({
        outbound: buildLeg({
          segments: [
            {
              origin: 'VIE',
              destination: 'AYT',
              departsAt: '2026-06-10T20:30:00Z',
              arrivesAt: '2026-06-10T23:40:00Z',
              carrier: 'OS',
              flightNumber: 'OS431',
            },
          ],
        }),
      }),
    });

    expect(warn(candidate)).toContain('LATE_ARRIVAL');
  });

  it('flags a missing transfer as needing verification', () => {
    const candidate = buildCandidate({ transfer: null });
    const warnings = detectTravelWarnings(candidate, costTripCandidate(candidate));
    const missing = warnings.find((w) => w.code === 'NO_TRANSFER_PRICED');

    expect(missing?.severity).toBe('needs_verification');
  });

  it('flags a low-confidence weather outlook', () => {
    const weather = buildWeather(3).map((day) => ({ ...day, confidence: 0.3 }));
    expect(warn(buildCandidate({ weather }))).toContain('LOW_WEATHER_CONFIDENCE');
  });

  it('stays quiet about a clean itinerary', () => {
    // A warning on every trip is a warning on no trip.
    expect(warn(buildCandidate())).toHaveLength(0);
  });
});
