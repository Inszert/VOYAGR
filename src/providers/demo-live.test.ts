import { describe, expect, it, vi } from 'vitest';
import { money } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import { createMemoryRepositories } from '@/db/memory';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import { createDemoLive, DEMO_CACHE_MS, type DemoLive } from './demo-live';
import { SnapshotFlightProvider } from './flights/liteapi-snapshot';

const NOW = Date.parse('2027-01-10T12:00:00.000Z');

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

const live: FlightOffer = {
  id: 'liteapi:live',
  providerId: 'liteapi',
  outbound: leg('VIE', 'LIS', QUERY.departureDate),
  inbound: leg('LIS', 'VIE', QUERY.returnDate),
  price: money(31000, 'EUR'),
  observedAt: new Date(NOW).toISOString(),
  expiresAt: null,
};

const FLIGHT_QUERY = {
  origin: 'VIE',
  destination: 'LIS',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  adults: 2,
  currency: 'EUR',
  cabin: 'ECONOMY',
};

function setup(limit?: number) {
  const fetchOffers = vi.fn(async () => ok([live] as readonly FlightOffer[]));
  const searchStays = vi.fn(async () => ok([]));
  let clock = NOW;
  const demo = createDemoLive({
    flights: { fetchOffers },
    stays: { searchStays },
    now: () => clock,
    ...(limit === undefined ? {} : { limit }),
  });
  const repository = createMemoryRepositories({ now: () => NOW }).liteapiSnapshot;
  const provider = (demoLive: DemoLive | null) =>
    new SnapshotFlightProvider('test', {
      now: () => NOW,
      fallback: async () => [],
      demoLive,
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    });
  return { fetchOffers, demo, provider, advance: (ms: number) => (clock += ms) };
}

describe('the flight reader in demo mode', () => {
  it('makes one live call for a row-less search and serves the second from the cache', async () => {
    const { fetchOffers, demo, provider } = setup();
    const reader = provider(demo);

    const first = await reader.searchFlights(QUERY);
    const second = await reader.searchFlights(QUERY);

    expect(first.ok && first.value.items.map((offer) => offer.id)).toEqual(['liteapi:live']);
    expect(first.ok && first.value.items[0]?.source).toEqual({
      displayName: 'LiteAPI',
      mode: 'test',
    });
    expect(second.ok && second.value.items).toHaveLength(1);
    expect(fetchOffers).toHaveBeenCalledTimes(1);
    expect(demo.callCount()).toBe(1);
  });

  it('asks again once the hour is up', async () => {
    const { fetchOffers, provider, demo, advance } = setup();
    await provider(demo).searchFlights(QUERY);
    advance(DEMO_CACHE_MS + 1);
    await provider(demo).searchFlights(QUERY);
    expect(fetchOffers).toHaveBeenCalledTimes(2);
  });

  it('refuses after the call cap with a plain PROVIDER_UNAVAILABLE', async () => {
    const { fetchOffers, demo } = setup(2);
    const day = (n: number) => ({ ...FLIGHT_QUERY, departureDate: `2027-03-0${n}` });

    await demo.flights(day(1));
    await demo.flights(day(2));
    const third = await demo.flights(day(3));

    expect(fetchOffers).toHaveBeenCalledTimes(2);
    expect(third.ok).toBe(false);
    expect(!third.ok && third.error).toBeInstanceOf(AppError);
    expect(!third.ok && third.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(!third.ok && third.error.message).toMatch(/demo call limit was reached/);
  });

  it('does not cache a failure', async () => {
    const fetchOffers = vi
      .fn()
      .mockResolvedValueOnce(err(new AppError('PROVIDER_ERROR', 'down')))
      .mockResolvedValueOnce(ok([live]));
    const demo = createDemoLive({
      flights: { fetchOffers },
      stays: { searchStays: async () => ok([]) },
      now: () => NOW,
    });
    expect((await demo.flights(FLIGHT_QUERY)).ok).toBe(false);
    expect((await demo.flights(FLIGHT_QUERY)).ok).toBe(true);
    expect(fetchOffers).toHaveBeenCalledTimes(2);
  });

  it('with demo off (production) makes zero live calls', async () => {
    const { fetchOffers, provider } = setup();
    const result = await provider(null).searchFlights(QUERY);
    expect(result.ok && result.value.items).toEqual([]);
    expect(fetchOffers).not.toHaveBeenCalled();
  });

  it('by default (DEMO_MODE unset) resolves no live path and calls nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const repository = createMemoryRepositories({ now: () => NOW }).liteapiSnapshot;
    const reader = new SnapshotFlightProvider('test', {
      now: () => NOW,
      fallback: async () => [],
      dependencies: () => ({ repository, refreshesPerDay: 3 }),
    });
    const result = await reader.searchFlights(QUERY);
    expect(result.ok && result.value.items).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
