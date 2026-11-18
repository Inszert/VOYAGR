import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheStore } from '@/cache/memory';
import { AppError } from '@/lib/errors';
import type { SearchOutcome } from '@/search/types';
import { parseSearchForm } from '@/search/schema';
import {
  LIVE_SEARCH_FAILED_MESSAGE,
  LIVE_SEARCH_FRESH_MS,
  liveSearch,
  withRouteDefaults,
} from './live-search';
import { SearchDiscoverySource, buildDiscoveryRequest } from './snapshot';

/**
 * A route or day that is not stored is asked of the vendor now, once, and kept for an hour.
 * The landing page's many-places snapshot is never asked inline.
 */

const TODAY = '2026-11-18';
const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const OUTCOME = { results: [] } as unknown as SearchOutcome;

const request = buildDiscoveryRequest({ today: TODAY, destinations: ['AYT'] })!;

describe('liveSearch', () => {
  it('a missing route makes one live call, stores it, and the same request again makes none', async () => {
    const store = new MemoryCacheStore({ now: () => NOW });
    const run = vi.fn(async () => OUTCOME);

    const first = await liveSearch(request, 'api', { store, run, now: () => NOW });
    const second = await liveSearch(request, 'api', { store, run, now: () => NOW + 60_000 });

    expect(run).toHaveBeenCalledTimes(1);
    expect(first.ok && first.outcome).toBe(OUTCOME);
    expect(second.ok && second.outcome).toEqual(OUTCOME);
  });

  it('asks again once the stored result is older than an hour', async () => {
    const store = new MemoryCacheStore({ now: () => NOW });
    const run = vi.fn(async () => OUTCOME);

    await liveSearch(request, 'api', { store, run, now: () => NOW });
    await liveSearch(request, 'api', {
      store,
      run,
      now: () => NOW + LIVE_SEARCH_FRESH_MS + 1_000,
    });

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('an adapter error is a plain message with the way to try again, never an empty list', async () => {
    const store = new MemoryCacheStore({ now: () => NOW });
    const run = vi.fn(async () => {
      throw new Error('vendor said 500 with a secret in it');
    });

    const result = await liveSearch(request, 'api', { store, run, now: () => NOW });

    expect(result).toEqual({ ok: false, message: LIVE_SEARCH_FAILED_MESSAGE });
    expect(LIVE_SEARCH_FAILED_MESSAGE).toMatch(/try again/i);
  });

  it('a rate-limited vendor shows its own public message', async () => {
    const store = new MemoryCacheStore({ now: () => NOW });
    const run = vi.fn(async () => {
      throw new AppError('RATE_LIMITED', 'limit', {
        publicMessage: 'Prices are busy right now. Try again shortly.',
      });
    });

    const result = await liveSearch(request, 'api', { store, run, now: () => NOW });

    expect(result).toEqual({ ok: false, message: 'Prices are busy right now. Try again shortly.' });
  });
});

describe('the landing page list', () => {
  it('makes no inline call: a missing snapshot is pending for the worker', async () => {
    const run = vi.fn(async () => OUTCOME);
    const source = new SearchDiscoverySource({
      store: new MemoryCacheStore({ now: () => NOW }),
      run,
      now: () => NOW,
    });

    const read = await source.read({ today: TODAY, source: 'api' });

    expect(read.snapshot).toBeNull();
    expect(read.pending).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('withRouteDefaults', () => {
  it('lets a route typed with no budget run, and what was typed wins', () => {
    const values = withRouteDefaults(
      { origins: 'LHR', destinations: 'AYT', passengers: '3' },
      TODAY,
      {},
    );

    expect(values.origins).toBe('LHR');
    expect(values.passengers).toBe('3');
    expect(parseSearchForm(values).ok).toBe(true);
  });

  it('leaves a form with no destination code exactly as it came', () => {
    const values = { origins: 'LHR', destinations: 'anywhere' };
    expect(withRouteDefaults(values, TODAY, {})).toBe(values);
  });
});
