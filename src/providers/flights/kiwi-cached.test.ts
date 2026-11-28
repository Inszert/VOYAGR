import { describe, expect, it, vi } from 'vitest';
import { cacheKey } from '@/cache';
import { MemoryCacheStore } from '@/cache/memory';
import { createMemoryRepositories } from '@/db/memory';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type { FlightOffer } from '@/core/trip/types';
import { KiwiCachedFlightProvider } from './kiwi-cached';
import type { KiwiMcpFlightProvider } from './kiwi-mcp';
import { KIWI_OFFERS_SCHEMA_VERSION } from './kiwi-read-path';

const HOUR = 3_600_000;
const clock = Date.parse('2027-01-10T12:00:00.000Z');
const QUERY = {
  origins: ['VIE'],
  destinations: ['LIS'],
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  passengers: 2,
  currency: 'EUR',
} as const;

const offer = (id: string, amount: number) =>
  ({
    id,
    providerId: 'kiwi-mcp',
    price: { amount, currency: 'EUR' },
    outbound: { segments: [{}, {}], durationMinutes: 1 },
    inbound: { segments: [{}], durationMinutes: 1 },
  }) as unknown as FlightOffer;

function build(searchFlights: ReturnType<typeof vi.fn>) {
  const adapter = {
    metadata: { id: 'kiwi-mcp', kind: 'flights', displayName: 'Kiwi.com', mode: 'live' },
    searchFlights,
    checkHealth: vi.fn(),
    close: vi.fn(),
  } as unknown as KiwiMcpFlightProvider;
  const cache = new MemoryCacheStore({ now: () => clock });
  const repository = createMemoryRepositories({ now: () => clock }).kiwiOffers;
  const provider = new KiwiCachedFlightProvider(adapter, { cache, repository, now: () => clock });
  return { provider, cache, repository };
}

const key = {
  origin: 'VIE',
  destination: 'LIS',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  adults: 2,
  currency: 'EUR',
};

describe('KiwiCachedFlightProvider', () => {
  it('makes zero MCP calls when the stored answer is fresh', async () => {
    const searchFlights = vi.fn();
    const { provider, cache } = build(searchFlights);
    await cache.set(
      cacheKey('kiwi-flights', { ...key }),
      {
        offers: [offer('a', 20000), offer('b', 10000)],
        observedAt: new Date(clock - 2 * HOUR).toISOString(),
        v: KIWI_OFFERS_SCHEMA_VERSION,
      },
      { ttlMs: 10 * HOUR },
    );

    const result = await provider.searchFlights(QUERY);
    if (!result.ok) throw result.error;
    expect(searchFlights).not.toHaveBeenCalled();
    // Cheapest first, with no stale label on a fresh answer.
    expect(result.value.items.map((o) => o.id)).toEqual(['b', 'a']);
    expect(result.value.items[0]!.source).toBeUndefined();
  });

  it('serves stale stored offers, labelled, when the MCP fails', async () => {
    const searchFlights = vi.fn(async () => err(new AppError('PROVIDER_TIMEOUT', 'timed out')));
    const { provider, repository } = build(searchFlights);
    await repository.put({
      ...key,
      schemaVersion: KIWI_OFFERS_SCHEMA_VERSION,
      offers: [offer('old', 15000)],
      observedAt: new Date(clock - 14 * HOUR).toISOString(),
    });

    const result = await provider.searchFlights(QUERY);
    if (!result.ok) throw result.error;
    expect(searchFlights).toHaveBeenCalledTimes(1);
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]!.source?.displayName).toBe('Kiwi.com, checked 14 h ago');
  });

  it('fails, rather than returning an empty page, when the MCP fails and nothing is stored', async () => {
    const searchFlights = vi.fn(async () => err(new AppError('PROVIDER_TIMEOUT', 'timed out')));
    const { provider } = build(searchFlights);
    const result = await provider.searchFlights(QUERY);
    expect(result.ok).toBe(false);
  });

  it('shares the cache across calls: a second search does not call the MCP again', async () => {
    const searchFlights = vi.fn(async () => ok({ items: [offer('a', 100)], nextCursor: null }));
    const { provider } = build(searchFlights);
    await provider.searchFlights(QUERY);
    await provider.searchFlights(QUERY);
    expect(searchFlights).toHaveBeenCalledTimes(1);
  });

  it('keeps only non-stop offers when directOnly is asked', async () => {
    const direct = {
      ...offer('direct', 500),
      outbound: { segments: [{}], durationMinutes: 1 },
    } as unknown as FlightOffer;
    const searchFlights = vi.fn(async () =>
      ok({ items: [offer('stops', 100), direct], nextCursor: null }),
    );
    const { provider } = build(searchFlights);
    const result = await provider.searchFlights({ ...QUERY, directOnly: true });
    if (!result.ok) throw result.error;
    expect(result.value.items.map((o) => o.id)).toEqual(['direct']);
  });
});
