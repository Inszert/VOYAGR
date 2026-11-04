import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProfile } from '@/core/trip/test-support';
import { getSearchCache, resetSearchCache, SearchCache, searchCacheKey } from './cache';
import type { SearchOutcome, SearchRequest } from './types';

/**
 * The cache exists to absorb reloads and duplicate tabs without pretending a
 * stale price is a fresh one, so these tests are about what it may and may not
 * reuse, and about what it admits when it does.
 */

const request: SearchRequest = { profile: buildProfile(), destinations: ['AYT'] };

const outcome = (id: string) =>
  ({
    results: [],
    nearMisses: [],
    diagnostics: { providerCalls: 1, label: id },
  }) as unknown as SearchOutcome;

describe('searchCacheKey', () => {
  it('is stable whatever order the request was built in', () => {
    // Key order in an object literal varies by call site; the key must not.
    const a = { profile: buildProfile(), destinations: ['AYT', 'CHQ'] } as SearchRequest;
    const b = { destinations: ['AYT', 'CHQ'], profile: buildProfile() } as SearchRequest;

    expect(searchCacheKey(a)).toBe(searchCacheKey(b));
  });

  it('separates the same search run against different data sources', () => {
    // The runtime switch changes who answers without changing the request.
    // A cache that cannot tell them apart hands back API prices under a
    // MOCK label the moment somebody flips it.
    expect(searchCacheKey(request, 'mock')).not.toBe(searchCacheKey(request, 'api'));
    expect(searchCacheKey(request, 'api')).not.toBe(searchCacheKey(request));
    expect(searchCacheKey(request, 'mock')).toBe(searchCacheKey(request, 'mock'));
  });

  it('changes when anything that changes the result changes', () => {
    const base = searchCacheKey(request);

    expect(searchCacheKey({ ...request, destinations: ['CHQ'] })).not.toBe(base);
    expect(searchCacheKey({ ...request, profile: buildProfile({ passengers: 3 }) })).not.toBe(base);
    expect(searchCacheKey({ ...request, limits: { maxResults: 3 } })).not.toBe(base);
  });

  it('distinguishes budgets by their minor units, not their formatting', () => {
    const cheaper = buildProfile({ targetBudget: { amount: 64999, currency: 'EUR' } });
    expect(searchCacheKey({ ...request, profile: cheaper })).not.toBe(searchCacheKey(request));
  });
});

describe('SearchCache', () => {
  it('runs once and reuses the result inside the TTL', async () => {
    const cache = new SearchCache({ ttlMs: 1000, now: () => 0 });
    const run = vi.fn(async () => outcome('first'));

    const first = await cache.run(request, run);
    const second = await cache.run(request, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.outcome).toBe(first.outcome);
  });

  it('reports how old a reused result is, rather than passing it off as fresh', async () => {
    let clock = 0;
    const cache = new SearchCache({ ttlMs: 60_000, now: () => clock });

    await cache.run(request, async () => outcome('first'));
    clock = 30_000;
    const reused = await cache.run(request, async () => outcome('second'));

    expect(reused.hit).toBe(true);
    expect(reused.ageMs).toBe(30_000);
  });

  it('runs again once the entry has expired', async () => {
    let clock = 0;
    const cache = new SearchCache({ ttlMs: 1000, now: () => clock });
    const run = vi.fn(async () => outcome('x'));

    await cache.run(request, run);
    clock = 1001;
    await cache.run(request, run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not serve one search from another search key', async () => {
    const cache = new SearchCache({ now: () => 0 });
    const run = vi.fn(async () => outcome('x'));

    await cache.run(request, run);
    await cache.run({ ...request, destinations: ['CHQ'] }, run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('collapses identical concurrent searches into one run', async () => {
    // Two tabs opened at once is one provider call, not two.
    const cache = new SearchCache({ now: () => 0 });
    let started = 0;

    const run = async () => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return outcome('shared');
    };

    const [a, b] = await Promise.all([cache.run(request, run), cache.run(request, run)]);

    expect(started).toBe(1);
    expect(a.outcome).toBe(b.outcome);
  });

  it('never caches a failure', async () => {
    const cache = new SearchCache({ now: () => 0 });
    let attempts = 0;

    const failing = async (): Promise<SearchOutcome> => {
      attempts += 1;
      throw new Error('provider exploded');
    };

    await expect(cache.run(request, failing)).rejects.toThrow('provider exploded');
    await expect(cache.run(request, failing)).rejects.toThrow('provider exploded');

    // Replaying a failure for the rest of the TTL would turn a blip into an outage.
    expect(attempts).toBe(2);
    expect(cache.size).toBe(0);
  });

  it('stays bounded, discarding the least recently used entry', async () => {
    const cache = new SearchCache({ maxEntries: 2, now: () => 0 });

    for (const destination of ['AYT', 'CHQ', 'SPU']) {
      await cache.run({ ...request, destinations: [destination] }, async () =>
        outcome(destination),
      );
    }

    expect(cache.size).toBe(2);
  });
});

describe('SearchCache scoping', () => {
  it('never serves one data source a result produced by the other', async () => {
    const cache = new SearchCache();

    const fromApi = await cache.run(request, async () => outcome('api'), 'api');
    const fromMock = await cache.run(request, async () => outcome('mock'), 'mock');

    const label = (value: { outcome: SearchOutcome }) =>
      (value.outcome.diagnostics as unknown as { label: string }).label;

    expect(label(fromApi)).toBe('api');
    expect(fromMock.hit).toBe(false);
    expect(label(fromMock)).toBe('mock');

    // And switching back still finds the first one rather than re-running it.
    const again = await cache.run(request, async () => outcome('unused'), 'api');
    expect(again.hit).toBe(true);
    expect(label(again)).toBe('api');
  });
});

describe('the process-wide cache singleton', () => {
  afterEach(() => {
    resetSearchCache();
  });

  it('is one instance per process, not one per call', () => {
    // The property the globalThis fix exists for: two pages (or two
    // requests to the same page) must share one cache, never two separate
    // ones that each run a duplicate query against a live provider.
    expect(getSearchCache()).toBe(getSearchCache());
  });

  it('reset actually drops it, rather than handing back the same stale instance', async () => {
    const first = getSearchCache();
    await first.run(request, async () => outcome('before-reset'));
    expect(first.size).toBe(1);

    resetSearchCache();

    const second = getSearchCache();
    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
  });
});
