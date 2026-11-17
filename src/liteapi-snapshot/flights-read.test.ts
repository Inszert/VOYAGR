import { describe, expect, it, vi } from 'vitest';
import { money } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import { createMemoryRepositories } from '@/db/memory';
import {
  FLIGHT_FARE_LINE,
  FLIGHTS_MISSING_LINE,
  flightStalenessLine,
  readFlightSnapshot,
} from './flights-read';
import { FLIGHTS_STORED_SCHEMA_VERSION, toStoredFlights } from './flights-stored-schema';
import { flightsKey } from './flights-targets';

const NOW = Date.parse('2027-01-10T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ROUTE = {
  origin: 'VIE',
  destination: 'LIS',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  adults: 2,
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

const offer = (id: string, expiresAt: string | null): FlightOffer => ({
  id,
  providerId: 'liteapi',
  outbound: leg('VIE', 'LIS', ROUTE.departureDate),
  inbound: leg('LIS', 'VIE', ROUTE.returnDate),
  price: money(25000, 'EUR'),
  observedAt: iso(NOW),
  expiresAt,
});

async function seed(options: {
  observedHoursAgo?: number;
  offers?: FlightOffer[];
  environment?: 'sandbox' | 'production';
  schemaVersion?: number;
}) {
  const repositories = createMemoryRepositories({ now: () => NOW });
  const observed = NOW - (options.observedHoursAgo ?? 1) * HOUR;
  await repositories.liteapiSnapshot.putFlights({
    ...flightsKey(ROUTE),
    environment: options.environment ?? 'production',
    schemaVersion: options.schemaVersion ?? FLIGHTS_STORED_SCHEMA_VERSION,
    offers: toStoredFlights(options.offers ?? [offer('a', iso(NOW + HOUR))]),
    observedAt: iso(observed),
    expiresAt: iso(observed + 24 * HOUR),
    runId: 'r1',
  });
  return { repository: repositories.liteapiSnapshot, refreshesPerDay: 3 };
}

describe('the flights read path', () => {
  it('reads fresh with the hotel wording, and carries the fixed fare line', async () => {
    const read = await readFlightSnapshot(ROUTE, NOW, await seed({ observedHoursAgo: 3 }));

    expect(read.status).toMatchObject({ state: 'fresh', ageHours: 3, testPrices: false });
    expect(flightStalenessLine(read.status)).toBe('Updated 3 hours ago');
    expect(read.offers[0]!.price).toEqual({ amount: 25000, currency: 'EUR' });
    expect(FLIGHT_FARE_LINE).toBe('Fares change often. Check the airline before you book.');
  });

  it('reads aging past two intervals', async () => {
    const read = await readFlightSnapshot(
      ROUTE,
      NOW,
      await seed({ observedHoursAgo: 20, offers: [offer('a', null)] }),
    );

    expect(flightStalenessLine(read.status)).toBe('Prices last checked 20 hours ago');
  });

  it('reads missing for no row, and never invents a price', async () => {
    const repositories = createMemoryRepositories({ now: () => NOW });
    const read = await readFlightSnapshot(ROUTE, NOW, {
      repository: repositories.liteapiSnapshot,
      refreshesPerDay: 3,
    });

    expect(read.status.state).toBe('missing');
    expect(read.offers).toEqual([]);
    expect(flightStalenessLine(read.status)).toBe(FLIGHTS_MISSING_LINE);
  });

  it('reads missing past the row expiry and for another schema version', async () => {
    expect((await readFlightSnapshot(ROUTE, NOW + 30 * HOUR, await seed({}))).status.state).toBe(
      'missing',
    );
    expect(
      (await readFlightSnapshot(ROUTE, NOW, await seed({ schemaVersion: 99 }))).status.state,
    ).toBe('missing');
  });

  it('reads unknown, with the price but no age claim, when observed in the future', async () => {
    const read = await readFlightSnapshot(
      ROUTE,
      NOW,
      await seed({ observedHoursAgo: -5, offers: [offer('a', null)] }),
    );

    expect(read.status.state).toBe('unknown');
    expect(flightStalenessLine(read.status)).toBeNull();
    expect(read.offers).toHaveLength(1);
  });

  it('never returns an offer past its own expiry, and reads missing when none is left', async () => {
    const deps = await seed({
      offers: [offer('gone', iso(NOW - 1)), offer('kept', iso(NOW + HOUR))],
    });
    const read = await readFlightSnapshot(ROUTE, NOW, deps);
    expect(read.offers.map((entry) => entry.id)).toEqual(['kept']);

    const none = await readFlightSnapshot(ROUTE, NOW + 2 * HOUR, deps);
    expect(none.status.state).toBe('missing');
    expect(none.offers).toEqual([]);
  });

  it('marks sandbox rows as test prices', async () => {
    const read = await readFlightSnapshot(ROUTE, NOW, await seed({ environment: 'sandbox' }));
    expect(read.status.testPrices).toBe(true);
  });

  it('touches no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await readFlightSnapshot(ROUTE, NOW, await seed({}));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
