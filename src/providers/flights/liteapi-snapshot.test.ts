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
