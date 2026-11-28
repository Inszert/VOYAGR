import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheStore } from '@/cache/memory';
import { cacheKey } from '@/cache';
import { createMemoryRepositories } from '@/db/memory';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type { FlightOffer } from '@/core/trip/types';
import type { FlightProvider } from '../types';
import {
  createRedisLookupLock,
  KIWI_OFFERS_SCHEMA_VERSION,
  KiwiReadPath,
  type LookupLock,
} from './kiwi-read-path';

const HOUR = 3_600_000;
let clock = Date.parse('2027-01-10T12:00:00.000Z');
const now = () => clock;

const LOOKUP = {
  origin: 'VIE',
  destination: 'LIS',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  adults: 2,
  currency: 'EUR',
} as const;

const offer = (id: string) => ({ id }) as unknown as FlightOffer;

function providerReturning(items: FlightOffer[]) {
  const searchFlights = vi.fn(async () => ok({ items, nextCursor: null }));
  return { provider: { searchFlights } as unknown as FlightProvider, searchFlights };
}

function failingProvider() {
  const searchFlights = vi.fn(async () => err(new AppError('PROVIDER_TIMEOUT', 'timed out')));
  return { provider: { searchFlights } as unknown as FlightProvider, searchFlights };
}

function setup(provider: FlightProvider) {
  const cache = new MemoryCacheStore({ now });
  const repository = createMemoryRepositories({ now }).kiwiOffers;
  const path = new KiwiReadPath({ provider, cache, repository, now });
  return { path, cache, repository };
}

const stored = (id: string, ageMs: number) => ({
  offers: [offer(id)],
  observedAt: new Date(clock - ageMs).toISOString(),
  v: KIWI_OFFERS_SCHEMA_VERSION,
});

const idOf = () => cacheKey('kiwi-flights', { ...LOOKUP });

describe('KiwiReadPath', () => {
  it('makes zero MCP calls when the cache is fresh', async () => {
    const { provider, searchFlights } = providerReturning([]);
    const { path, cache } = setup(provider);
    await cache.set(idOf(), stored('cached', 2 * HOUR), { ttlMs: 12 * HOUR });

    const result = await path.lookup(LOOKUP);

    expect(searchFlights).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'fresh', source: 'cache', label: 'checked 2 h ago' });
  });

  it('makes zero MCP calls when only Postgres is fresh, and warms the cache', async () => {
    const { provider, searchFlights } = providerReturning([]);
    const { path, cache, repository } = setup(provider);
    const row = stored('row', 5 * HOUR);
    await repository.put({
      ...LOOKUP,
      schemaVersion: 1,
      offers: row.offers,
      observedAt: row.observedAt,
    });

    const result = await path.lookup(LOOKUP);

    expect(searchFlights).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'fresh', source: 'postgres', label: 'checked 5 h ago' });
    // The warmed entry keeps the real observation time: it does not look young.
    const warmed = await cache.get<{ observedAt: string }>(idOf());
    expect(warmed?.value.observedAt).toBe(row.observedAt);
  });

  it('serves the stale value with its age when the MCP fails', async () => {
    const { provider, searchFlights } = failingProvider();
    const { path, repository } = setup(provider);
    const row = stored('old', 14 * HOUR);
    await repository.put({
      ...LOOKUP,
      schemaVersion: 1,
      offers: row.offers,
      observedAt: row.observedAt,
    });

    const result = await path.lookup(LOOKUP);

    expect(searchFlights).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'stale',
      source: 'stale-postgres',
      label: 'checked 14 h ago',
    });
    expect(result.error?.code).toBe('PROVIDER_TIMEOUT');
    expect(result.offers).toHaveLength(1);
  });

  it('serves a stale cache entry when the MCP fails and Postgres is empty', async () => {
    const { provider } = failingProvider();
    const { path, cache } = setup(provider);
    await cache.set(idOf(), stored('stale-cache', 13 * HOUR), { ttlMs: 48 * HOUR });

    const result = await path.lookup(LOOKUP);

    expect(result).toMatchObject({
      status: 'stale',
      source: 'stale-cache',
      label: 'checked 13 h ago',
    });
  });

  it('answers an honest no_data when nothing is stored and the MCP fails', async () => {
    const { provider } = failingProvider();
    const { path } = setup(provider);

    const result = await path.lookup(LOOKUP);

    expect(result).toMatchObject({
      status: 'no_data',
      label: 'no data yet',
      offers: [],
      observedAt: null,
    });
  });

  it('writes both stores after a successful call and returns fresh', async () => {
    const { provider, searchFlights } = providerReturning([offer('new')]);
    const { path, cache, repository } = setup(provider);

    const result = await path.lookup(LOOKUP);

    expect(searchFlights).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'fresh', source: 'mcp', ageMs: 0 });
    expect((await cache.get(idOf()))?.value).toMatchObject({ offers: [offer('new')] });
    expect(await repository.get({ ...LOOKUP })).toMatchObject({ offers: [offer('new')] });

    // The next lookup is served from the cache without another call.
    await path.lookup(LOOKUP);
    expect(searchFlights).toHaveBeenCalledTimes(1);
  });

  it('calls again once the stored value is older than 12 hours', async () => {
    const { provider, searchFlights } = providerReturning([offer('new')]);
    const { path } = setup(provider);
    await path.lookup(LOOKUP);
    clock += 12 * HOUR + 1000;

    const result = await path.lookup(LOOKUP);

    expect(searchFlights).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('fresh');
  });

  it('shares one MCP call between ten identical concurrent lookups', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const searchFlights = vi.fn(async () => {
      await gate;
      return ok({ items: [offer('one')], nextCursor: null });
    });
    const { path } = setup({ searchFlights } as unknown as FlightProvider);

    const all = Array.from({ length: 10 }, () => path.lookup(LOOKUP));
    release();
    const results = await Promise.all(all);

    expect(searchFlights).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === 'fresh')).toBe(true);
  });

  it('does not call the MCP from a process that lost the cross-process lock', async () => {
    const { provider, searchFlights } = providerReturning([offer('mine')]);
    const lock: LookupLock = { acquire: async () => false, release: async () => undefined };
    const cache = new MemoryCacheStore({ now });
    const repository = createMemoryRepositories({ now }).kiwiOffers;
    const path = new KiwiReadPath({
      provider,
      cache,
      repository,
      lock,
      now,
      lockWaitMs: 1000,
      lockPollMs: 100,
      // The winner's write lands while this process waits.
      sleep: async () => {
        clock += 100;
        await cache.set(idOf(), stored('winner', 0), { ttlMs: 12 * HOUR });
      },
    });

    const result = await path.lookup(LOOKUP);

    expect(searchFlights).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'fresh', source: 'cache' });
  });

  it('takes the Redis lock with SET NX PX and releases it', async () => {
    const calls: unknown[][] = [];
    const lock = createRedisLookupLock({
      set: async (...args) => (calls.push(args), 'OK'),
      del: async (...args) => (calls.push(['del', ...args]), 1),
    });

    expect(await lock.acquire('k', 30_000)).toBe(true);
    await lock.release('k');

    expect(calls[0]).toEqual(['voyagr:lock:k', '1', 'PX', 30_000, 'NX']);
    expect(calls[1]).toEqual(['del', 'voyagr:lock:k']);
  });
});
