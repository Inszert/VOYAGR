import { afterEach, describe, expect, it, vi } from 'vitest';
import { money } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import { createMemoryRepositories } from '@/db/memory';
import { createLimiter } from '@/lib/concurrency';
import { AppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import type { Job } from '@/queue/types';
import { createFlightsRefreshHandler, type FlightsSnapshotClient } from './flights-job';
import { FLIGHTS_STORED_SCHEMA_VERSION, readStoredFlights } from './flights-stored-schema';
import { FLIGHTS_JOB, flightTargetKey, flightTargets } from './flights-targets';
import { LAUNCH_DESTINATIONS } from './targets';

const logged: unknown[] = [];
vi.mock('@/lib/logger', () => ({
  getLogger: () => ({
    info: (...args: unknown[]) => logged.push(args),
    warn: (...args: unknown[]) => logged.push(args),
    error: (...args: unknown[]) => logged.push(args),
    debug: (...args: unknown[]) => logged.push(args),
  }),
}));

const KEY = 'sand_super_secret_key_123';
const NOW = Date.parse('2027-01-10T12:00:00.000Z');
const ENV = {
  LITEAPI_API_KEY: KEY,
  LITEAPI_SNAPSHOT_ENABLED: true,
  LITEAPI_SNAPSHOT_REFRESHES_PER_DAY: 3,
  LITEAPI_SNAPSHOT_ORIGINS: ['VIE'],
};
const ONE = [LAUNCH_DESTINATIONS[0]!];
const TARGET = flightTargets('2027-01-10', ['VIE'], ONE)[0]!;
const PAYLOAD = {
  origin: TARGET.origin,
  destination: TARGET.destination.code,
  departureDate: TARGET.departureDate,
  returnDate: TARGET.returnDate,
};

const leg = (from: string, to: string, day: string) => ({
  segments: [
    {
      origin: from,
      destination: to,
      departsAt: `${day}T09:00:00`,
      arrivesAt: `${day}T11:30:00`,
      carrier: 'TP',
      flightNumber: 'TP1234',
    },
  ],
  durationMinutes: 150,
  cabinBaggageIncluded: true,
  checkedBaggageIncluded: null,
  selfTransfer: null,
});

function anOffer(id: string, amount: number): FlightOffer {
  return {
    id: `liteapi:${id}`,
    providerId: 'liteapi',
    outbound: leg('VIE', 'LIS', TARGET.departureDate),
    inbound: leg('LIS', 'VIE', TARGET.returnDate),
    price: money(amount, 'EUR'),
    observedAt: '2027-01-10T12:00:00.000Z',
    expiresAt: '2027-01-10T12:30:00.000Z',
  };
}

function aJob(payload = PAYLOAD): Job<'liteapi.flights.refresh'> {
  return {
    id: 'j1',
    name: 'liteapi.flights.refresh',
    payload,
    attempt: 1,
    enqueuedAt: new Date(NOW).toISOString(),
  };
}

function setup(options: { env?: Partial<typeof ENV>; client?: FlightsSnapshotClient } = {}) {
  const repositories = createMemoryRepositories({ now: () => NOW });
  const client: FlightsSnapshotClient = options.client ?? {
    fetchOffers: vi.fn(async () => ok([anOffer('b', 30000), anOffer('a', 20000)])),
  };
  const createClient = vi.fn(() => client);
  const handler = createFlightsRefreshHandler({
    repositories,
    env: { ...ENV, ...options.env },
    now: () => NOW,
    createClient,
    limiter: createLimiter(1),
    runId: (() => {
      let n = 0;
      return () => `run-${++n}`;
    })(),
    destinations: ONE,
  });
  return { repo: repositories.liteapiSnapshot, client, createClient, handler };
}

afterEach(() => {
  vi.restoreAllMocks();
  logged.length = 0;
});

describe('the flights refresh job', () => {
  it('makes one call, stores the offers cheapest first, and records the run', async () => {
    const { repo, handler, client } = setup();

    await handler(aJob());

    expect(client.fetchOffers).toHaveBeenCalledTimes(1);
    const row = await repo.getFlights(flightTargetKey(TARGET));
    expect(row).toMatchObject({
      environment: 'sandbox',
      schemaVersion: FLIGHTS_STORED_SCHEMA_VERSION,
      observedAt: '2027-01-10T12:00:00.000Z',
      // 3 x the 8 hour interval after the observation.
      expiresAt: '2027-01-11T12:00:00.000Z',
    });
    const read = readStoredFlights(row!.schemaVersion, row!.offers);
    expect(read.ok && read.offers.map((offer) => offer.price.amount)).toEqual([20000, 30000]);
    expect(await repo.latestRun(FLIGHTS_JOB)).toMatchObject({
      status: 'ok',
      callsMade: 1,
      destinationCode: 'VIE-LIS',
    });
  });

  it('keeps the old row when the provider fails, and logs the code but never the key', async () => {
    const client: FlightsSnapshotClient = {
      fetchOffers: vi.fn(async () => ok([anOffer('a', 20000)])),
    };
    const { repo, handler } = setup({ client });
    await handler(aJob());
    const before = await repo.getFlights(flightTargetKey(TARGET));
    vi.mocked(client.fetchOffers).mockResolvedValueOnce(
      err(new AppError('PROVIDER_TIMEOUT', `LiteAPI said no to ${KEY}`)),
    );

    await expect(handler(aJob())).resolves.toBeUndefined();

    expect(await repo.getFlights(flightTargetKey(TARGET))).toEqual(before);
    expect(await repo.latestRun(FLIGHTS_JOB)).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_TIMEOUT',
    });
    expect(JSON.stringify(logged)).not.toContain(KEY);
  });

  it('does not overwrite a priced row with an empty answer', async () => {
    const client: FlightsSnapshotClient = {
      fetchOffers: vi.fn(async () => ok([anOffer('a', 20000)])),
    };
    const { repo, handler } = setup({ client });
    await handler(aJob());
    const before = await repo.getFlights(flightTargetKey(TARGET));
    vi.mocked(client.fetchOffers).mockResolvedValueOnce(ok([]));

    await handler(aJob());

    expect(await repo.getFlights(flightTargetKey(TARGET))).toEqual(before);
  });

  it('records disabled and builds no client when the flag is off or the key is missing', async () => {
    for (const env of [
      { LITEAPI_SNAPSHOT_ENABLED: false },
      { LITEAPI_API_KEY: undefined as unknown as string },
    ]) {
      const { repo, handler, createClient, client } = setup({ env });
      await handler(aJob());
      expect(createClient).not.toHaveBeenCalled();
      expect(client.fetchOffers).not.toHaveBeenCalled();
      expect(await repo.callsSince('2027-01-10T00:00:00.000Z', FLIGHTS_JOB)).toBe(0);
    }
  });

  it('refuses a route or window it did not choose, with no call', async () => {
    const { handler, client, repo } = setup();

    await handler(aJob({ ...PAYLOAD, origin: 'JFK' }));
    await handler(aJob({ ...PAYLOAD, returnDate: '2027-03-01' }));
    await handler(aJob({ ...PAYLOAD, destination: 'VIE' }));

    expect(client.fetchOffers).not.toHaveBeenCalled();
    expect(await repo.latestRun(FLIGHTS_JOB)).toMatchObject({
      status: 'failed',
      errorCode: 'VALIDATION_ERROR',
    });
  });

  it('refuses a run once the day ceiling for flights is spent', async () => {
    const { handler, client, repo } = setup();
    // One origin, one destination, three windows, three refreshes: nine calls a day.
    for (let i = 0; i < 9; i += 1) {
      await repo.startRun({
        runId: `used-${i}`,
        job: FLIGHTS_JOB,
        destinationCode: 'VIE-LIS',
        checkIn: TARGET.departureDate,
        checkOut: TARGET.returnDate,
        environment: 'sandbox',
      });
      await repo.finishRun(`used-${i}`, { status: 'ok', callsMade: 1 });
    }

    await handler(aJob());

    expect(client.fetchOffers).not.toHaveBeenCalled();
    expect(await repo.latestRun(FLIGHTS_JOB)).toMatchObject({ status: 'skipped_cap' });
  });

  it('never has more than the limiter allows in flight', async () => {
    let active = 0;
    let peak = 0;
    const client: FlightsSnapshotClient = {
      fetchOffers: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return ok([anOffer('a', 20000)]);
      }),
    };
    const { handler } = setup({ client });

    await Promise.all([handler(aJob()), handler(aJob()), handler(aJob())]);

    expect(peak).toBe(1);
  });
});
