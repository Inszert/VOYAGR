import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheStore } from '@/cache/memory';
import { money } from '@/core/money';
import type { FlightOffer, OneWayFare } from '@/core/trip/types';
import { createMemoryRepositories } from '@/db/memory';
import {
  toStoredFlights,
  FLIGHTS_STORED_SCHEMA_VERSION,
} from '@/liteapi-snapshot/flights-stored-schema';
import { flightsKey } from '@/liteapi-snapshot/flights-targets';
import { loadOneWayMonth } from '@/search/one-way';
import {
  SnapshotFlightProvider,
  aviasalesOneWayKey,
  createAviasalesCacheReader,
} from './liteapi-snapshot';

const NOW = Date.parse('2027-01-10T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const QUERY = {
  origins: ['VIE'],
  destinations: ['LIS'],
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  passengers: 2,
  currency: 'EUR',
};

const leg = (from: string, to: string, day: string) => ({
  segments: [
    {
      origin: from,
      destination: to,
      departsAt: `${day}T09:00:00`,
      arrivesAt: null,
      carrier: 'TP',
      flightNumber: 'TP1',
    },
  ],
  durationMinutes: 150,
  cabinBaggageIncluded: null,
  checkedBaggageIncluded: null,
  selfTransfer: null,
});

const stored: FlightOffer = {
  id: 'liteapi:a',
  providerId: 'liteapi',
  outbound: leg('VIE', 'LIS', QUERY.departureDate),
  inbound: leg('LIS', 'VIE', QUERY.returnDate),
  price: money(25000, 'EUR'),
  observedAt: iso(NOW - HOUR),
  expiresAt: iso(NOW + HOUR),
};

async function repositoryWithRow() {
  const repositories = createMemoryRepositories({ now: () => NOW });
  await repositories.liteapiSnapshot.putFlights({
    ...flightsKey({
      origin: 'VIE',
      destination: 'LIS',
      departureDate: QUERY.departureDate,
      returnDate: QUERY.returnDate,
      adults: 2,
      currency: 'EUR',
    }),
    environment: 'sandbox',
    schemaVersion: FLIGHTS_STORED_SCHEMA_VERSION,
    offers: toStoredFlights([stored]),
    observedAt: iso(NOW - HOUR),
    expiresAt: iso(NOW + 23 * HOUR),
    runId: 'r1',
  });
  return repositories.liteapiSnapshot;
}

function oneWay(id: string, from: string, to: string, day: string, amount: number): OneWayFare {
  return {
    id,
    providerId: 'aviasales',
    leg: leg(from, to, day),
    price: money(amount, 'EUR'),
    observedAt: iso(NOW - 2 * HOUR),
  };
}

describe('the snapshot flight provider', () => {
  it('serves the stored row and never calls the fallback or the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const fallback = vi.fn(async () => []);
    const repository = await repositoryWithRow();
    const provider = new SnapshotFlightProvider('test', {
      now: () => NOW,
      fallback,
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    });

    const result = await provider.searchFlights(QUERY);

    expect(provider.metadata).toMatchObject({ id: 'liteapi', kind: 'flights', mode: 'test' });
    expect(result.ok && result.value.items[0]?.source).toEqual({
      displayName: 'LiteAPI',
      mode: 'test',
    });
    expect(result.ok && result.value.items.map((offer) => offer.id)).toEqual(['liteapi:a']);
    expect(fallback).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('with no row and an empty Aviasales cache, the route is unpriced, with zero fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = new MemoryCacheStore();
    const getSpy = vi.spyOn(store, 'get');
    const setSpy = vi.spyOn(store, 'set');
    const repository = createMemoryRepositories({ now: () => NOW }).liteapiSnapshot;
    const provider = new SnapshotFlightProvider('test', {
      now: () => NOW,
      fallback: createAviasalesCacheReader(() => store),
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    });

    const result = await provider.searchFlights(QUERY);

    expect(result.ok && result.value.items).toEqual([]);
    expect(getSpy).toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('with no row, prices the route from cached Aviasales one-way months, read only', async () => {
    const store = new MemoryCacheStore();
    await store.set(
      aviasalesOneWayKey('VIE', 'LIS', '2027-02', 'EUR', 2),
      [oneWay('o', 'VIE', 'LIS', '2027-02-09', 9000)],
      { ttlMs: HOUR },
    );
    await store.set(
      aviasalesOneWayKey('LIS', 'VIE', '2027-02', 'EUR', 2),
      [oneWay('b', 'LIS', 'VIE', '2027-02-13', 8000), 'garbage' as never],
      { ttlMs: HOUR },
    );
    const setSpy = vi.spyOn(store, 'set');
    const repository = createMemoryRepositories({ now: () => NOW }).liteapiSnapshot;
    const provider = new SnapshotFlightProvider('test', {
      now: () => NOW,
      fallback: createAviasalesCacheReader(() => store),
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    });

    const result = await provider.searchFlights(QUERY);

    expect(result.ok && result.value.items).toHaveLength(1);
    expect(result.ok && result.value.items[0]).toMatchObject({
      price: { amount: 17000, currency: 'EUR' },
      ticketing: 'two_one_way',
    });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('labels cached Aviasales fares as Aviasales and indicative, never with the LiteAPI mode', async () => {
    const store = new MemoryCacheStore();
    await store.set(
      aviasalesOneWayKey('VIE', 'LIS', '2027-02', 'EUR', 2),
      [oneWay('o', 'VIE', 'LIS', '2027-02-09', 9000)],
      { ttlMs: HOUR },
    );
    await store.set(
      aviasalesOneWayKey('LIS', 'VIE', '2027-02', 'EUR', 2),
      [{ ...oneWay('b', 'LIS', 'VIE', '2027-02-13', 8000), providerId: 'liteapi' }],
      { ttlMs: HOUR },
    );
    const repository = createMemoryRepositories({ now: () => NOW }).liteapiSnapshot;
    const provider = new SnapshotFlightProvider('live', {
      now: () => NOW,
      fallback: createAviasalesCacheReader(() => store),
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    });

    const result = await provider.searchFlights(QUERY);

    expect(result.ok && result.value.items.map((offer) => offer.providerId)).toEqual(['aviasales']);
    expect(result.ok && result.value.items[0]?.source).toEqual({
      displayName: 'Aviasales',
      mode: 'indicative',
    });
  });

  it('keeps the LiteAPI mode when it served the answer, and the weaker mode in a mixed one', async () => {
    const store = new MemoryCacheStore();
    await store.set(
      aviasalesOneWayKey('PRG', 'LIS', '2027-02', 'EUR', 2),
      [oneWay('o', 'PRG', 'LIS', '2027-02-09', 9000)],
      { ttlMs: HOUR },
    );
    await store.set(
      aviasalesOneWayKey('LIS', 'PRG', '2027-02', 'EUR', 2),
      [oneWay('b', 'LIS', 'PRG', '2027-02-13', 8000)],
      { ttlMs: HOUR },
    );
    const repository = await repositoryWithRow();
    const options = {
      now: () => NOW,
      fallback: createAviasalesCacheReader(() => store),
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    };

    const sourcesOf = async (mode: 'test' | 'live', origins: string[]) => {
      const result = await new SnapshotFlightProvider(mode, options).searchFlights({
        ...QUERY,
        origins,
      });
      return result.ok ? result.value.items.map((offer) => offer.source) : [];
    };

    expect(await sourcesOf('test', ['VIE'])).toEqual([{ displayName: 'LiteAPI', mode: 'test' }]);
    expect(await sourcesOf('live', ['VIE'])).toEqual([{ displayName: 'LiteAPI', mode: 'live' }]);

    // PRG has no stored row, so the cache answers it while VIE is stored: a mixed answer, and
    // each offer keeps its own label rather than the whole search taking the weaker one.
    for (const mode of ['live', 'test'] as const) {
      expect(await sourcesOf(mode, ['VIE', 'PRG'])).toEqual(
        expect.arrayContaining([
          { displayName: 'LiteAPI', mode },
          { displayName: 'Aviasales', mode: 'indicative' },
        ]),
      );
    }
  });

  it('keeps each offer its own label when two searches interleave on one provider', async () => {
    const store = new MemoryCacheStore();
    await store.set(
      aviasalesOneWayKey('PRG', 'LIS', '2027-02', 'EUR', 2),
      [oneWay('o', 'PRG', 'LIS', '2027-02-09', 9000)],
      { ttlMs: HOUR },
    );
    await store.set(
      aviasalesOneWayKey('LIS', 'PRG', '2027-02', 'EUR', 2),
      [oneWay('b', 'LIS', 'PRG', '2027-02-13', 8000)],
      { ttlMs: HOUR },
    );
    const repository = await repositoryWithRow();
    const provider = new SnapshotFlightProvider('test', {
      now: () => NOW,
      fallback: createAviasalesCacheReader(() => store),
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    });
    const before = JSON.stringify(provider.metadata);

    // VIE has a stored row (LiteAPI); PRG has none, so the Aviasales cache answers it.
    const [storedResult, fallbackResult] = await Promise.all([
      provider.searchFlights(QUERY),
      provider.searchFlights({ ...QUERY, origins: ['PRG'] }),
    ]);
    const [storedOffer] = storedResult.ok ? storedResult.value.items : [];
    const [fallbackOffer] = fallbackResult.ok ? fallbackResult.value.items : [];

    expect(storedOffer).toMatchObject({
      providerId: 'liteapi',
      source: { displayName: 'LiteAPI', mode: 'test' },
    });
    expect(fallbackOffer).toMatchObject({
      providerId: 'aviasales',
      source: { displayName: 'Aviasales', mode: 'indicative' },
    });
    // No search moves the provider's own metadata, so nothing can read a label off it.
    expect(JSON.stringify(provider.metadata)).toBe(before);
  });

  it('builds the same cache key the one-way writer does', async () => {
    const store = new MemoryCacheStore();
    const setSpy = vi.spyOn(store, 'set');

    await loadOneWayMonth(
      { origin: 'VIE', destination: 'LIS', month: '2027-02', currency: 'EUR', passengers: 2 },
      {
        flights: {
          metadata: { id: 'aviasales' },
          searchOneWay: async () => ({ ok: true, value: [] }),
        } as never,
        store,
        call: async (run) => {
          const result = await run();
          return result.ok ? result.value : null;
        },
      },
    );

    expect(setSpy.mock.calls[0]![0]).toBe(aviasalesOneWayKey('VIE', 'LIS', '2027-02', 'EUR', 2));
  });
});
