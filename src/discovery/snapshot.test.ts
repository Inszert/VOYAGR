import { describe, expect, it, vi } from 'vitest';
import { SearchCache } from '@/search/cache';
import { DESTINATION_FIXTURES } from '@/providers/fixtures/destinations';
import type { SearchOutcome } from '@/search/types';
import {
  buildDiscoveryQuery,
  buildDiscoveryRequest,
  describeAssumptions,
  DISCOVERY_LIMITS,
  DISCOVERY_WINDOW,
  SearchDiscoverySource,
} from './snapshot';

/**
 * The discovery snapshot.
 *
 * What is defended: the front page prices the whole catalogue under stated,
 * deterministic assumptions; it keeps the traveller's own settings and never
 * their destination list; it runs under system limits rather than a plan's;
 * and it is cached, so a homepage is not a search per visit.
 */

const TODAY = '2026-09-20';

describe('buildDiscoveryQuery', () => {
  it('prices the next two months, a week out, four to seven nights', () => {
    const query = buildDiscoveryQuery({ today: TODAY });

    expect(query.earliestDeparture).toBe('2026-09-27');
    expect(query.latestReturn).toBe('2026-11-26');
    expect(query.minNights).toBe(String(DISCOVERY_WINDOW.minNights));
    expect(query.maxNights).toBe(String(DISCOVERY_WINDOW.maxNights));
    expect(query.flexibility).toBe('custom');
  });

  it('asks about every destination the catalogue can place', () => {
    const query = buildDiscoveryQuery({ today: TODAY });

    for (const fixture of DESTINATION_FIXTURES) {
      expect(query.destinations).toContain(fixture.airport);
    }
  });

  it('keeps what is the traveller’s and overrides what is not', () => {
    const query = buildDiscoveryQuery({
      today: TODAY,
      defaults: { origins: 'BTS', passengers: '4', currency: 'GBP', destinations: 'AYT' },
    });

    expect(query.origins).toBe('BTS');
    expect(query.passengers).toBe('4');
    expect(query.currency).toBe('GBP');
    // Their saved destinations are for their searches, not for the globe.
    expect(query.destinations).not.toBe('AYT');
  });

  it('sets a ceiling that excludes nothing, scaled to the target', () => {
    const query = buildDiscoveryQuery({ today: TODAY, defaults: { targetBudget: '400' } });

    expect(query.maxBudget).toBe('4000');
  });

  it('is deterministic for a given day', () => {
    expect(buildDiscoveryQuery({ today: TODAY })).toEqual(buildDiscoveryQuery({ today: TODAY }));
  });
});

describe('buildDiscoveryRequest', () => {
  it('validates like a typed search and runs under system limits', () => {
    const request = buildDiscoveryRequest({ today: TODAY });

    expect(request).not.toBeNull();
    expect(request?.limits).toEqual(DISCOVERY_LIMITS);
    // The limit must cover the catalogue, or the globe would silently show
    // fewer places than the product can price.
    expect(DISCOVERY_LIMITS.maxDestinations).toBeGreaterThanOrEqual(DESTINATION_FIXTURES.length);
    expect(request?.destinationNames?.AYT).toBe('Antalya');
  });

  it('states its assumptions from the request it actually built', () => {
    const request = buildDiscoveryRequest({ today: TODAY, defaults: { passengers: '3' } })!;
    const assumptions = describeAssumptions(request);

    expect(assumptions).toEqual({
      origins: ['VIE'],
      passengers: 3,
      currency: 'EUR',
      earliestDeparture: '2026-09-27',
      latestReturn: '2026-11-26',
      minNights: 4,
      maxNights: 7,
    });
  });
});

describe('SearchDiscoverySource', () => {
  const outcome = { results: [], destinationSummaries: [] } as unknown as SearchOutcome;

  it('runs the search once for repeated loads of the same day', async () => {
    const run = vi.fn(async () => outcome);
    const source = new SearchDiscoverySource({ run, cache: new SearchCache() });

    const first = await source.load({ today: TODAY });
    const second = await source.load({ today: TODAY });

    expect(run).toHaveBeenCalledTimes(1);
    expect(first?.outcome).toBe(outcome);
    expect(second?.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('returns null rather than throwing when the search fails, and does not cache the failure', async () => {
    const run = vi
      .fn<() => Promise<SearchOutcome>>()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(outcome);
    const source = new SearchDiscoverySource({ run, cache: new SearchCache() });

    expect(await source.load({ today: TODAY })).toBeNull();
    expect((await source.load({ today: TODAY }))?.outcome).toBe(outcome);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
