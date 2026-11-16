import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheStore } from '@/cache/memory';
import { DESTINATION_FIXTURES } from '@/providers/fixtures/destinations';
import type { SearchOutcome } from '@/search/types';
import {
  buildDiscoveryQuery,
  buildDiscoveryRequest,
  describeAssumptions,
  discoveryCacheKey,
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
  it('prices the next ten weeks, a week out, four to fourteen nights', () => {
    const query = buildDiscoveryQuery({ today: TODAY });

    expect(query.earliestDeparture).toBe('2026-09-27');
    expect(query.latestReturn).toBe('2026-12-11');
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
      latestReturn: '2026-12-11',
      minNights: 4,
      maxNights: 14,
    });
  });
});

describe('SearchDiscoverySource', () => {
  const outcome = { results: [], destinationSummaries: [] } as unknown as SearchOutcome;

  it('runs the search once for repeated loads of the same day', async () => {
    const run = vi.fn(async () => outcome);
    const source = new SearchDiscoverySource({ run, store: new MemoryCacheStore() });

    const first = await source.load({ today: TODAY });
    const second = await source.load({ today: TODAY });

    expect(run).toHaveBeenCalledTimes(1);
    expect(first?.outcome).toBe(outcome);
    expect(second?.ageMs).toBeGreaterThanOrEqual(0);
  });

  describe('read, the page path', () => {
    const DAY = '2026-11-14';
    const NEXT_DAY = '2026-11-15';
    const HOUR = 60 * 60 * 1000;

    /** A store whose clock the test moves, with an entry written for a given day. */
    function setup() {
      const clock = { at: Date.parse(`${DAY}T22:30:00.000Z`) };
      const store = new MemoryCacheStore({ now: () => clock.at });
      const run = vi.fn(async () => outcome);
      const source = new SearchDiscoverySource({ run, store, now: () => clock.at });

      const write = async (day: string, input: Partial<Parameters<typeof source.read>[0]> = {}) => {
        const request = buildDiscoveryRequest({ today: day, ...input })!;
        await store.set(discoveryCacheKey(request, 'api'), outcome, { ttlMs: 25 * HOUR });
      };

      return { clock, store, run, source, write };
    }

    it('serves a fresh entry for today and asks for nothing', async () => {
      const { source, write, run } = setup();
      await write(DAY);

      const read = await source.read({ today: DAY });

      expect(read.snapshot?.outcome).toBe(outcome);
      expect(read.snapshot?.freshness).toBe('fresh');
      expect(read.pending).toBe(false);
      expect(read.refreshWanted).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it('at midnight serves yesterday as stale, dated by its own observation, and never searches', async () => {
      const { source, write, clock, run } = setup();
      await write(DAY);

      // Ninety minutes later it is 00:00 UTC and today's key has no entry.
      clock.at = Date.parse(`${NEXT_DAY}T00:00:00.000Z`);
      const read = await source.read({ today: NEXT_DAY });

      expect(run).not.toHaveBeenCalled();
      expect(read.snapshot?.outcome).toBe(outcome);
      expect(read.snapshot?.observedAt).toBe(`${DAY}T22:30:00.000Z`);
      expect(read.snapshot?.ageMs).toBe(90 * 60 * 1000);
      expect(read.snapshot?.freshness).toBe('stale');
      expect(read.snapshot?.request.profile.earliestDeparture).toBe('2026-11-21');
      expect(read.pending).toBe(false);
      expect(read.refreshWanted).toBe(true);
    });

    it('asks for today’s entry even when yesterday’s was written within the last fresh hour', async () => {
      const { source, write, clock } = setup();
      clock.at = Date.parse(`${DAY}T23:30:00.000Z`);
      await write(DAY);

      clock.at = Date.parse(`${NEXT_DAY}T00:00:00.000Z`);
      const read = await source.read({ today: NEXT_DAY });

      // Fresh by age, but for the wrong day: the dates it priced are a day behind.
      expect(read.snapshot?.freshness).toBe('fresh');
      expect(read.refreshWanted).toBe(true);
    });

    it('prefers today’s entry once the worker has written it', async () => {
      const { source, write, clock } = setup();
      await write(DAY);
      clock.at = Date.parse(`${NEXT_DAY}T00:10:00.000Z`);
      await write(NEXT_DAY);

      const read = await source.read({ today: NEXT_DAY });

      expect(read.snapshot?.observedAt).toBe(`${NEXT_DAY}T00:10:00.000Z`);
      expect(read.snapshot?.freshness).toBe('fresh');
      expect(read.refreshWanted).toBe(false);
    });

    it('with nothing cached at all, says prices are pending and does not search', async () => {
      const { source, run } = setup();

      const read = await source.read({ today: NEXT_DAY });

      expect(run).not.toHaveBeenCalled();
      expect(read).toEqual({ snapshot: null, pending: true, refreshWanted: true });
    });

    it('does not reach back two days', async () => {
      const { source, write, clock, run } = setup();
      await write('2026-11-13');
      clock.at = Date.parse(`${NEXT_DAY}T00:00:00.000Z`);

      const read = await source.read({ today: NEXT_DAY });

      expect(read.snapshot).toBeNull();
      expect(read.pending).toBe(true);
      expect(run).not.toHaveBeenCalled();
    });

    it('shows a visitor with their own settings the default profile when theirs is not cached', async () => {
      const { source, write } = setup();
      await write(DAY);

      const read = await source.read({ today: DAY, defaults: { origins: 'BTS', passengers: '4' } });

      expect(read.snapshot?.assumptions.origins).toEqual(['VIE']);
      expect(read.snapshot?.assumptions.passengers).toBe(2);
      expect(read.refreshWanted).toBe(false);
    });

    it('prefers a visitor’s own cached profile over the default one', async () => {
      const { source, write } = setup();
      await write(DAY);
      await write(DAY, { defaults: { origins: 'BTS' } });

      const read = await source.read({ today: DAY, defaults: { origins: 'BTS' } });

      expect(read.snapshot?.assumptions.origins).toEqual(['BTS']);
    });

    it('treats a cache that cannot be read as a miss rather than failing the page', async () => {
      const store = {
        name: 'memory' as const,
        get: async () => {
          throw new Error('redis down');
        },
        set: async () => {
          throw new Error('redis down');
        },
      };
      const run = vi.fn(async () => outcome);
      const source = new SearchDiscoverySource({ run, store });

      expect(await source.read({ today: NEXT_DAY })).toEqual({
        snapshot: null,
        pending: true,
        refreshWanted: true,
      });
      expect(run).not.toHaveBeenCalled();
    });

    it('may still build fixtures, which call no provider', async () => {
      const { source, run } = setup();

      const read = await source.read({ today: NEXT_DAY, source: 'mock' });

      expect(run).toHaveBeenCalledTimes(1);
      expect(read.snapshot?.outcome).toBe(outcome);
      expect(read.pending).toBe(false);
    });
  });

  it('returns null rather than throwing when the search fails, and does not cache the failure', async () => {
    const run = vi
      .fn<() => Promise<SearchOutcome>>()
      .mockRejectedValueOnce(new Error('provider down'))
      .mockResolvedValueOnce(outcome);
    const source = new SearchDiscoverySource({ run, store: new MemoryCacheStore() });

    expect(await source.load({ today: TODAY })).toBeNull();
    expect((await source.load({ today: TODAY }))?.outcome).toBe(outcome);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
