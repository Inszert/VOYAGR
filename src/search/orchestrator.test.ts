import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import type { FlightOffer } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import { createMockFlightProvider } from '@/providers/flights/mock';
import { createMockHotelProvider } from '@/providers/hotels/mock';
import { createMockTransferProvider } from '@/providers/transfers/mock';
import { createMockWeatherProvider } from '@/providers/weather/mock';
import type {
  FlightProvider,
  HotelProvider,
  ProviderHealth,
  TransferProvider,
  WeatherProvider,
} from '@/providers/types';
import { runSearch, type SearchDependencies } from './orchestrator';
import type { SearchRequest } from './types';

/**
 * Search orchestration tests.
 *
 * The behaviour being pinned down is the contract in the implementation plan:
 * a search returns ranked, costed, constrained candidates, and one adapter
 * failing degrades the result set rather than aborting the search.
 *
 * Providers are injected rather than configured, so no test depends on the
 * process-wide registry or on environment variables.
 */

const mockDeps = (): SearchDependencies => ({
  flights: createMockFlightProvider(),
  hotels: createMockHotelProvider(),
  weather: createMockWeatherProvider(),
  transfers: createMockTransferProvider(),
  // A frozen clock keeps `durationMs` out of the way of deep equality checks.
  now: () => 0,
});

const healthy: ProviderHealth = {
  status: 'unavailable',
  checkedAt: '2026-01-15T09:00:00Z',
  latencyMs: null,
};

const downError = () => err(new AppError('PROVIDER_UNAVAILABLE', 'simulated outage'));

const brokenFlights: FlightProvider = {
  metadata: createMockFlightProvider().metadata,
  checkHealth: async () => healthy,
  searchFlights: async () => downError(),
};

const brokenHotels: HotelProvider = {
  metadata: createMockHotelProvider().metadata,
  checkHealth: async () => healthy,
  searchHotels: async () => downError(),
};

const brokenWeather: WeatherProvider = {
  metadata: createMockWeatherProvider().metadata,
  checkHealth: async () => healthy,
  getOutlook: async () => downError(),
};

const brokenTransfers: TransferProvider = {
  metadata: createMockTransferProvider().metadata,
  checkHealth: async () => healthy,
  searchTransfers: async () => downError(),
};

/** An adapter that breaks its own contract by throwing instead of returning. */
const throwingWeather: WeatherProvider = {
  metadata: createMockWeatherProvider().metadata,
  checkHealth: async () => healthy,
  getOutlook: async () => {
    throw new TypeError('provider SDK blew up');
  },
};

const baseRequest: SearchRequest = {
  profile: buildProfile(),
  destinations: ['AYT', 'CHQ', 'SPU'],
  destinationNames: { AYT: 'Antalya', CHQ: 'Chania, Crete', SPU: 'Split' },
  requestId: 'test-request',
};

const search = (overrides: Partial<SearchRequest> = {}, deps: Partial<SearchDependencies> = {}) =>
  runSearch({ ...baseRequest, ...overrides }, { ...mockDeps(), ...deps });

describe('runSearch against mock providers', () => {
  it('returns ranked, costed, constrained candidates', async () => {
    const outcome = await search();

    expect(outcome.results.length).toBeGreaterThan(0);

    for (const trip of outcome.results) {
      expect(trip.cost.lines.length).toBeGreaterThan(0);
      expect(trip.cost.total.currency).toBe('EUR');
      expect(trip.eligibility.eligible).toBe(true);
      expect(trip.score.score).toBeGreaterThanOrEqual(0);
      expect(trip.score.score).toBeLessThanOrEqual(100);
      expect(trip.usableTime.totalMinutes).toBeGreaterThan(0);
    }
  });

  it('ranks by score, best first', async () => {
    const scores = (await search()).results.map((trip) => trip.score.score);

    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
  });

  it('breaks a tie the same way every time, so a refresh is not false news', async () => {
    const outcome = await search();

    for (let index = 1; index < outcome.results.length; index += 1) {
      const previous = outcome.results[index - 1]!;
      const current = outcome.results[index]!;

      if (previous.score.score !== current.score.score) continue;
      // Equal scores must order by price, then by id - never by arrival order.
      expect(previous.cost.total.amount).toBeLessThanOrEqual(current.cost.total.amount);
    }
  });

  it('keeps every total traceable to the lines that produced it', async () => {
    const trip = (await search()).results[0]!;

    const counted = trip.cost.lines
      .filter((line) => line.confidence !== 'excluded')
      .reduce((total, line) => total + line.amount.amount, 0);

    expect(trip.cost.total.amount).toBe(counted);
    expect(trip.cost.total.amount).toBe(
      trip.cost.knownTotal.amount + trip.cost.estimatedTotal.amount,
    );
  });

  it('respects every hard constraint it was given', async () => {
    const profile = buildProfile({
      minNights: 5,
      maxNights: 5,
      requireFreeCancellation: true,
      minHotelReviewScore: 8,
    });

    const outcome = await search({ profile });

    expect(outcome.results.length).toBeGreaterThan(0);
    for (const trip of outcome.results) {
      expect(trip.candidate.dates.nights).toBe(5);
      expect(trip.candidate.hotel.freeCancellation).toBe(true);
      expect(trip.candidate.hotel.reviewScore).toBeGreaterThanOrEqual(8);
      expect(trip.cost.total.amount).toBeLessThanOrEqual(profile.maxBudget.amount);
    }
  });

  it('only returns trips to the destinations that were asked about', async () => {
    const outcome = await search({ destinations: ['AYT', 'CHQ'] });

    const destinations = new Set(outcome.results.map((trip) => trip.candidate.destination));
    expect([...destinations].every((code) => code === 'AYT' || code === 'CHQ')).toBe(true);
  });

  it('is deterministic', async () => {
    expect(await search()).toEqual(await search());
  });

  it('honours the result limit', async () => {
    const outcome = await search({ limits: { maxResults: 3 } });

    expect(outcome.results.length).toBeLessThanOrEqual(3);
    // The limit trims what is shown, not what was considered.
    expect(outcome.diagnostics.eligibleCount).toBeGreaterThanOrEqual(outcome.results.length);
  });

  it('reports a clean search as not degraded', async () => {
    const outcome = await search();

    expect(outcome.diagnostics.degraded).toBe(false);
    expect(outcome.diagnostics.issues).toEqual([]);
    expect(outcome.diagnostics.providerCalls).toBeGreaterThan(0);
  });
});

describe('runSearch degrades rather than failing when a provider is down', () => {
  it('still returns results when the weather provider is unavailable', async () => {
    const outcome = await search({}, { weather: brokenWeather });

    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.diagnostics.degraded).toBe(true);
    expect(outcome.diagnostics.issues.some((issue) => issue.kind === 'weather')).toBe(true);
    // Absent weather is absent, not invented.
    expect(outcome.results.every((trip) => trip.candidate.weather.length === 0)).toBe(true);
  });

  it('still returns results when the transfer provider is unavailable', async () => {
    const outcome = await search({}, { transfers: brokenTransfers });

    expect(outcome.results.length).toBeGreaterThan(0);

    for (const trip of outcome.results) {
      expect(trip.candidate.transfer).toBeNull();
      // An unpriced transfer becomes an excluded line and a warning, never a
      // silent zero folded into the total.
      expect(trip.cost.excluded.some((line) => line.category === 'transfer')).toBe(true);
      expect(trip.warnings.some((warning) => warning.code === 'NO_TRANSFER_PRICED')).toBe(true);
    }
  });

  it('survives an adapter that throws instead of returning a result', async () => {
    // Adapters are contracted to return `Result`. A buggy one must still not
    // take the search down with it.
    const outcome = await search({}, { weather: throwingWeather });

    expect(outcome.results.length).toBeGreaterThan(0);
    expect(outcome.diagnostics.issues.some((issue) => issue.kind === 'weather')).toBe(true);
  });

  it('returns nothing but explains itself when flights are unavailable', async () => {
    const outcome = await search({}, { flights: brokenFlights });

    expect(outcome.results).toEqual([]);
    expect(outcome.nearMisses).toEqual([]);
    expect(outcome.diagnostics.degraded).toBe(true);
    expect(outcome.diagnostics.issues.every((issue) => issue.kind === 'flights')).toBe(true);
  });

  it('does not call the hotel provider when a window has no flights', async () => {
    const withFlights = await search();
    const withoutFlights = await search({}, { flights: brokenFlights });

    // Hotels are the largest part of the fan-out; skipping them when no trip
    // could exist is the single biggest saving available.
    expect(withoutFlights.diagnostics.providerCalls).toBeLessThan(
      withFlights.diagnostics.providerCalls,
    );
  });

  it('returns nothing but explains itself when hotels are unavailable', async () => {
    const outcome = await search({}, { hotels: brokenHotels });

    expect(outcome.results).toEqual([]);
    expect(outcome.diagnostics.issues.some((issue) => issue.kind === 'hotels')).toBe(true);
  });

  it('keeps the destinations a failing hotel search did not affect', async () => {
    // Only Chania fails; Antalya and Split must still return trips.
    const partiallyBroken: HotelProvider = {
      metadata: createMockHotelProvider().metadata,
      checkHealth: async () => healthy,
      searchHotels: async (query, options) =>
        query.destination === 'CHQ'
          ? downError()
          : createMockHotelProvider().searchHotels(query, options),
    };

    const outcome = await search({}, { hotels: partiallyBroken });

    const destinations = new Set(outcome.results.map((trip) => trip.candidate.destination));

    expect(destinations.has('CHQ')).toBe(false);
    expect(destinations.size).toBeGreaterThan(0);
    expect(outcome.diagnostics.degraded).toBe(true);
  });

  it('reports a failure with a message that is safe to show a user', async () => {
    const outcome = await search({}, { weather: brokenWeather });
    const issue = outcome.diagnostics.issues[0]!;

    expect(issue.code).toBe('PROVIDER_UNAVAILABLE');
    // The public message, not the internal one - diagnostics reach the client.
    expect(issue.message).not.toContain('simulated outage');
    expect(issue.scope).toContain('weather:');
  });
});

describe('runSearch with a provider that leaves facts unstated', () => {
  /** A provider that prices a flight but never says what is included. */
  const terseFlights: FlightProvider = {
    metadata: createMockFlightProvider().metadata,
    checkHealth: async () => healthy,
    searchFlights: async (query, options) => {
      const result = await createMockFlightProvider().searchFlights(query, options);
      if (!result.ok) return result;

      const strip = (leg: FlightOffer['outbound']) => ({
        ...leg,
        cabinBaggageIncluded: null,
        checkedBaggageIncluded: null,
        selfTransfer: null,
      });

      return ok({
        ...result.value,
        items: result.value.items.map((offer) => ({
          ...offer,
          outbound: strip(offer.outbound),
          inbound: strip(offer.inbound),
        })),
      });
    },
  };

  it('still returns the trips, flagged rather than assumed', async () => {
    const outcome = await search({}, { flights: terseFlights });

    expect(outcome.results.length).toBeGreaterThan(0);

    for (const trip of outcome.results) {
      expect(trip.warnings.some((w) => w.code === 'BAGGAGE_ALLOWANCE_UNKNOWN')).toBe(true);
      expect(trip.warnings.some((w) => w.code === 'SELF_TRANSFER_UNKNOWN')).toBe(true);
      // The statements the old non-nullable booleans produced were false.
      expect(trip.warnings.some((w) => w.code === 'CABIN_BAGGAGE_ONLY')).toBe(false);
      expect(trip.warnings.some((w) => w.code === 'SELF_TRANSFER_RISK')).toBe(false);
    }
  });

  it('scores an unstated itinerary below the same trip fully described', async () => {
    const described = await search();
    const terse = await search({}, { flights: terseFlights });

    expect(terse.results[0]!.score.evidenceStrength).toBeLessThan(
      described.results[0]!.score.evidenceStrength,
    );
  });

  it('will not call an unstated allowance a match for a hard requirement', async () => {
    const outcome = await search(
      { profile: buildProfile({ requireCheckedBaggage: true }) },
      { flights: terseFlights },
    );

    expect(outcome.results).toEqual([]);
    expect(
      outcome.nearMisses.every((trip) =>
        trip.eligibility.violations.some((v) => v.code === 'CHECKED_BAGGAGE_REQUIRED'),
      ),
    ).toBe(true);
  });
});

describe('runSearch near misses', () => {
  it('explains what came close when nothing qualifies', async () => {
    const profile = buildProfile({
      targetBudget: money(8000, 'EUR'),
      maxBudget: money(10000, 'EUR'),
    });

    const outcome = await search({ profile });

    expect(outcome.results).toEqual([]);
    expect(outcome.nearMisses.length).toBeGreaterThan(0);

    for (const trip of outcome.nearMisses) {
      expect(trip.eligibility.eligible).toBe(false);
      expect(trip.eligibility.violations.some((v) => v.code === 'OVER_MAX_BUDGET')).toBe(true);
      // Headroom is negative by exactly the overshoot, so the UI can say how
      // much a trip missed by without recomputing anything.
      expect(trip.eligibility.budgetHeadroom.amount).toBe(
        profile.maxBudget.amount - trip.cost.total.amount,
      );
    }
  });

  it('bounds the near misses it returns', async () => {
    const outcome = await search({
      profile: buildProfile({
        targetBudget: money(8000, 'EUR'),
        maxBudget: money(10000, 'EUR'),
      }),
      limits: { maxNearMisses: 2 },
    });

    expect(outcome.nearMisses).toHaveLength(2);
    expect(outcome.diagnostics.ineligibleCount).toBeGreaterThan(2);
  });
});

describe('runSearch diagnostics and bounds', () => {
  it('bounds the fan-out and says what it bounded', async () => {
    const outcome = await search({
      profile: buildProfile({
        earliestDeparture: '2026-06-01',
        latestReturn: '2026-08-31',
        minNights: 4,
        maxNights: 10,
      }),
      limits: { maxDateWindows: 3, maxDestinations: 2 },
    });

    const { plan } = outcome.diagnostics;

    expect(plan.dateWindows).toHaveLength(3);
    expect(plan.dateWindowsAvailable).toBeGreaterThan(50);
    expect(plan.destinations).toHaveLength(2);
    expect(outcome.diagnostics.candidatesAssembled).toBeGreaterThan(0);
  });

  it('caps the candidates it costs and scores', async () => {
    const outcome = await search({ limits: { maxCandidates: 5 } });

    expect(outcome.diagnostics.candidatesEvaluated).toBeLessThanOrEqual(5);
    expect(outcome.diagnostics.candidatesAssembled).toBeGreaterThan(5);
  });

  it('spreads the candidate cap across destinations rather than starving one', async () => {
    const outcome = await search({ limits: { maxCandidates: 12 } });

    const destinations = new Set(
      [...outcome.results, ...outcome.nearMisses].map((trip) => trip.candidate.destination),
    );

    expect(destinations.size).toBeGreaterThan(1);
  });

  it('drops an offer quoted in the wrong currency instead of converting it', async () => {
    // A provider that ignores the requested currency is a contract violation.
    // Inventing a rate here would put a wrong number in front of a user.
    const wrongCurrency: HotelProvider = {
      metadata: createMockHotelProvider().metadata,
      checkHealth: async () => healthy,
      searchHotels: async (query, options) => {
        const result = await createMockHotelProvider().searchHotels(
          { ...query, currency: 'USD' },
          options,
        );
        return result;
      },
    };

    const outcome = await search({}, { hotels: wrongCurrency });

    expect(outcome.results).toEqual([]);
    expect(
      outcome.diagnostics.issues.some(
        (issue) => issue.kind === 'hotels' && issue.code === 'PROVIDER_ERROR',
      ),
    ).toBe(true);
  });

  it('never exceeds the concurrency bound across the whole fan-out', async () => {
    // The bound has to hold across nested fan-outs, not within one of them.
    // A provider that actually takes time is what makes the peak observable:
    // instant mocks would let calls retire before the next one is submitted.
    const slowHotels: HotelProvider = {
      metadata: createMockHotelProvider().metadata,
      checkHealth: async () => healthy,
      searchHotels: async (query, options) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return createMockHotelProvider().searchHotels(query, options);
      },
    };

    const outcome = await search({ limits: { providerConcurrency: 3 } }, { hotels: slowHotels });

    expect(outcome.diagnostics.peakProviderConcurrency).toBeLessThanOrEqual(3);
    // And the bound is actually reached, so the assertion above is not passing
    // simply because nothing ever ran in parallel.
    expect(outcome.diagnostics.peakProviderConcurrency).toBe(3);
    expect(outcome.results.length).toBeGreaterThan(0);
  });

  it('paces a wide search without dropping any of its calls', async () => {
    const wide = await search({
      destinations: ['AYT', 'CHQ', 'SPU'],
      limits: { providerConcurrency: 2, maxDateWindows: 4 },
    });

    expect(wide.diagnostics.peakProviderConcurrency).toBeLessThanOrEqual(2);
    // A tighter bound changes the pace, never the answer.
    const unpaced = await search({
      destinations: ['AYT', 'CHQ', 'SPU'],
      limits: { providerConcurrency: 12, maxDateWindows: 4 },
    });

    expect(wide.results.map((trip) => trip.candidate.id)).toEqual(
      unpaced.results.map((trip) => trip.candidate.id),
    );
    expect(wide.diagnostics.providerCalls).toBe(unpaced.diagnostics.providerCalls);
  });

  it('rejects a request that cannot describe a trip before calling a provider', async () => {
    await expect(search({ destinations: [] })).rejects.toThrow(AppError);
  });
});
