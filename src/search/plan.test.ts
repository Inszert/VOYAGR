import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { resolveEntitlements } from '@/core/entitlements';
import { buildProfile } from '@/core/trip/test-support';
import { AppError } from '@/lib/errors';
import { buildSearchPlan, enumerateDateWindows, sampleEvenly } from './plan';
import { DEFAULT_SEARCH_LIMITS } from './types';

const request = (overrides: Partial<Parameters<typeof buildSearchPlan>[0]> = {}) => ({
  profile: buildProfile(),
  destinations: ['AYT'],
  ...overrides,
});

describe('enumerateDateWindows', () => {
  it('produces every departure and length the profile allows', () => {
    const windows = enumerateDateWindows(
      buildProfile({
        earliestDeparture: '2026-06-01',
        latestReturn: '2026-06-10',
        minNights: 4,
        maxNights: 5,
      }),
    );

    // Departures 06-01..06-06 take four nights; 06-01..06-05 also take five.
    expect(windows).toHaveLength(11);
    expect(windows.every((window) => window.nights >= 4 && window.nights <= 5)).toBe(true);
    expect(windows.every((window) => window.returnDate <= '2026-06-10')).toBe(true);
    expect(windows.every((window) => window.departureDate >= '2026-06-01')).toBe(true);
  });

  it('keeps nights consistent with the dates it reports', () => {
    for (const window of enumerateDateWindows(buildProfile())) {
      expect(window.returnDate).toBe(
        new Date(Date.parse(`${window.departureDate}T00:00:00Z`) + window.nights * 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
    }
  });

  it('returns nothing when the window is shorter than the minimum stay', () => {
    const windows = enumerateDateWindows(
      buildProfile({ earliestDeparture: '2026-06-01', latestReturn: '2026-06-03', minNights: 7 }),
    );

    expect(windows).toEqual([]);
  });
});

describe('sampleEvenly', () => {
  it('returns the list unchanged when it is already within the limit', () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('keeps both ends of the range rather than truncating', () => {
    // Truncating would search only the start of a flexible window, which is a
    // narrower search dressed up as a cheaper one.
    const sampled = sampleEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4);

    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(9);
    expect(sampled).toHaveLength(4);
  });

  it('is deterministic', () => {
    const items = Array.from({ length: 50 }, (_, index) => index);
    expect(sampleEvenly(items, 7)).toEqual(sampleEvenly(items, 7));
  });

  it('never returns a duplicate', () => {
    const sampled = sampleEvenly([1, 2, 3, 4, 5], 4);
    expect(new Set(sampled).size).toBe(sampled.length);
  });
});

describe('buildSearchPlan', () => {
  it('bounds the date windows and reports how many were available', () => {
    const plan = buildSearchPlan(
      request({
        profile: buildProfile({
          earliestDeparture: '2026-06-01',
          latestReturn: '2026-07-31',
          minNights: 4,
          maxNights: 10,
        }),
      }),
    );

    expect(plan.dateWindows).toHaveLength(DEFAULT_SEARCH_LIMITS.maxDateWindows);
    expect(plan.dateWindowsAvailable).toBeGreaterThan(DEFAULT_SEARCH_LIMITS.maxDateWindows);
  });

  it('covers exactly the span it will price', () => {
    const plan = buildSearchPlan(request());

    const departures = plan.dateWindows.map((window) => window.departureDate);
    const returns = plan.dateWindows.map((window) => window.returnDate);

    expect(plan.earliestDate).toBe([...departures].sort()[0]);
    expect(plan.latestDate).toBe([...returns].sort().at(-1));
  });

  it('normalises, de-duplicates and caps airport codes', () => {
    const plan = buildSearchPlan(
      request({
        profile: buildProfile({ origins: ['vie', 'VIE', ' bts '] }),
        destinations: ['ayt', 'AYT', 'CHQ'],
      }),
    );

    expect(plan.origins).toEqual(['VIE', 'BTS']);
    expect(plan.destinations).toEqual(['AYT', 'CHQ']);
    expect(plan.destinationsRequested).toBe(3);
  });

  it('caps destinations at the limit, keeping the caller order', () => {
    const plan = buildSearchPlan(
      request({
        destinations: ['AYT', 'CHQ', 'LCA', 'PMI', 'TBS', 'BUS', 'SPU', 'FAO'],
        limits: { maxDestinations: 3 },
      }),
    );

    expect(plan.destinations).toEqual(['AYT', 'CHQ', 'LCA']);
  });

  it('takes the currency from the budget', () => {
    const plan = buildSearchPlan(
      request({
        profile: buildProfile({
          targetBudget: money(90000, 'GBP'),
          maxBudget: money(120000, 'GBP'),
        }),
      }),
    );

    expect(plan.currency).toBe('GBP');
  });

  it('is deterministic', () => {
    expect(buildSearchPlan(request())).toEqual(buildSearchPlan(request()));
  });
});

describe('buildSearchPlan rejects a request that cannot describe a trip', () => {
  const cases: ReadonlyArray<readonly [string, Parameters<typeof buildSearchPlan>[0]]> = [
    ['no destinations', request({ destinations: [] })],
    ['blank destination codes', request({ destinations: ['  ', ''] })],
    ['no origins', request({ profile: buildProfile({ origins: [] }) })],
    ['zero travellers', request({ profile: buildProfile({ passengers: 0 }) })],
    [
      'maxNights below minNights',
      request({ profile: buildProfile({ minNights: 7, maxNights: 3 }) }),
    ],
    ['zero minimum nights', request({ profile: buildProfile({ minNights: 0 }) })],
    [
      'a window shorter than the minimum stay',
      request({
        profile: buildProfile({
          earliestDeparture: '2026-06-01',
          latestReturn: '2026-06-03',
          minNights: 7,
        }),
      }),
    ],
    [
      'an impossible calendar date',
      request({ profile: buildProfile({ earliestDeparture: '2026-02-30' }) }),
    ],
    [
      'budgets in different currencies',
      request({
        profile: buildProfile({
          targetBudget: money(65000, 'EUR'),
          maxBudget: money(85000, 'USD'),
        }),
      }),
    ],
    ['a non-positive limit', request({ limits: { maxDestinations: 0 } })],
  ];

  for (const [label, invalid] of cases) {
    it(`rejects ${label}`, () => {
      // A profile that can never match is a mistake worth naming, not an empty
      // result set for the user to puzzle over.
      expect(() => buildSearchPlan(invalid)).toThrow(AppError);

      try {
        buildSearchPlan(invalid);
        expect.unreachable('expected buildSearchPlan to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('VALIDATION_ERROR');
        // Anything surfaced to a user must be a sentence, not a stack trace.
        expect((error as AppError).publicMessage.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('entitlements bound the plan', () => {
  it('caps destinations to what a plan allows', () => {
    // The account page shows this number to the user, so the search has to
    // apply the same one rather than a constant that merely happens to match.
    const free = resolveEntitlements('free');

    const plan = buildSearchPlan(
      request({
        destinations: ['AYT', 'CHQ', 'LCA', 'PMI', 'TBS', 'BUS', 'SPU', 'FAO'],
        limits: { maxDestinations: free.maxDestinationsPerSearch },
      }),
    );

    expect(plan.destinations).toHaveLength(free.maxDestinationsPerSearch);
    expect(plan.destinationsRequested).toBe(8);
  });

  it('lets a more generous plan search wider', () => {
    const plan = buildSearchPlan(
      request({
        destinations: ['AYT', 'CHQ', 'LCA', 'PMI', 'TBS', 'BUS', 'SPU', 'FAO'],
        limits: { maxDestinations: 8 },
      }),
    );

    expect(plan.destinations).toHaveLength(8);
  });
});
