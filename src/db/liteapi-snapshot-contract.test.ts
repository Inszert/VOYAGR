import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { closePool, query } from './client';
import { createMemoryRepositories } from './memory';
import { createPostgresRepositories } from './postgres';
import type {
  LiteApiFlightsKey,
  LiteApiFlightsRow,
  LiteApiHotelRow,
  LiteApiRatesKey,
  LiteApiRatesRow,
  LiteApiSnapshotRepository,
} from './repository';

/**
 * The LiteAPI snapshot repository contract, run against every backend.
 *
 * Memory always; Postgres only when `TEST_DATABASE_URL` answers and the migrations are applied,
 * exactly as `repository-contract.test.ts` does. A skipped backend shows as skipped.
 */

const POSTGRES_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

let clockMs = Date.parse('2027-01-10T12:00:00.000Z');
const clock = () => clockMs;

interface Backend {
  readonly name: string;
  readonly create: () => LiteApiSnapshotRepository;
  readonly reset: () => Promise<void>;
}

const backends: Backend[] = [
  {
    name: 'memory',
    create: () => createMemoryRepositories({ now: clock }).liteapiSnapshot,
    reset: async () => undefined,
  },
];

let postgresActive = false;

if (POSTGRES_URL) {
  process.env.DATABASE_URL = POSTGRES_URL;
  resetEnvCache();
  try {
    await query('SELECT liteapi_refresh_runs.run_id FROM liteapi_refresh_runs LIMIT 1');
    await query('SELECT liteapi_flights_snapshot.run_id FROM liteapi_flights_snapshot LIMIT 1');
    postgresActive = true;
  } catch {
    postgresActive = false;
  }

  if (postgresActive) {
    backends.push({
      name: 'postgres',
      create: () => createPostgresRepositories({ now: clock }).liteapiSnapshot,
      reset: async () => {
        await query(
          'TRUNCATE liteapi_hotels, liteapi_rates_snapshot, liteapi_flights_snapshot, liteapi_refresh_runs',
        );
      },
    });
  }

  afterAll(async () => {
    await closePool();
  });
}

const KEY: LiteApiRatesKey = {
  destinationCode: 'LIS',
  checkIn: '2027-02-09',
  checkOut: '2027-02-13',
  occupancySig: 'a2-c0-r1',
  currency: 'EUR',
  guestNationality: 'US',
};

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function ratesRow(overrides: Partial<LiteApiRatesRow> = {}): LiteApiRatesRow {
  return {
    ...KEY,
    environment: 'sandbox',
    schemaVersion: 1,
    rates: [
      { property: { id: 'liteapi:1' }, rates: [{ total: { amount: 33333, currency: 'EUR' } }] },
    ],
    observedAt: iso(clockMs),
    expiresAt: iso(clockMs + 24 * HOUR),
    runId: 'run-1',
    ...overrides,
  };
}

const FLIGHTS_KEY: LiteApiFlightsKey = {
  origin: 'VIE',
  destination: 'LIS',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  adults: 2,
  currency: 'EUR',
  cabin: 'ECONOMY',
};

function flightsRow(overrides: Partial<LiteApiFlightsRow> = {}): LiteApiFlightsRow {
  return {
    ...FLIGHTS_KEY,
    environment: 'sandbox',
    schemaVersion: 1,
    offers: [{ id: 'liteapi:o1', price: { amount: 25000, currency: 'EUR' } }],
    observedAt: iso(clockMs),
    expiresAt: iso(clockMs + 24 * HOUR),
    runId: 'run-1',
    ...overrides,
  };
}

function hotelRow(id: string, overrides: Partial<LiteApiHotelRow> = {}): LiteApiHotelRow {
  return {
    hotelId: id,
    destinationCode: 'LIS',
    content: { id: `liteapi:${id}`, name: `Hotel ${id}` },
    fetchedAt: iso(clockMs),
    expiresAt: iso(clockMs + 7 * 24 * HOUR),
    ...overrides,
  };
}

describe('backend coverage', () => {
  it('always covers the in-memory backend', () => {
    expect(backends.map((backend) => backend.name)).toContain('memory');
  });

  it.skipIf(!postgresActive)('covers the postgres backend when one is configured', () => {
    expect(backends.map((backend) => backend.name)).toContain('postgres');
  });
});

describe.each(backends)('$name LiteAPI snapshot repository', (backend) => {
  let repo: LiteApiSnapshotRepository;

  beforeEach(async () => {
    clockMs = Date.parse('2027-01-10T12:00:00.000Z');
    repo = backend.create();
    await backend.reset();
  });

  it('round-trips a rates row, with Money as stored JSON and dates as plain strings', async () => {
    await repo.putRates(ratesRow());

    const read = await repo.getRates(KEY);

    expect(read).toEqual(ratesRow());
    expect(read?.checkIn).toBe('2027-02-09');
  });

  it('replaces the row for the same key on a second put', async () => {
    await repo.putRates(ratesRow({ runId: 'run-1', rates: [{ v: 1 }] }));
    await repo.putRates(ratesRow({ runId: 'run-2', rates: [{ v: 2 }] }));

    const read = await repo.getRates(KEY);

    expect(read?.runId).toBe('run-2');
    expect(read?.rates).toEqual([{ v: 2 }]);
  });

  it('keeps rows for different keys apart (occupancy, currency, nationality, dates)', async () => {
    await repo.putRates(ratesRow({ rates: ['base'] }));
    await repo.putRates(ratesRow({ occupancySig: 'a3-c0-r1', rates: ['three'] }));
    await repo.putRates(ratesRow({ currency: 'GBP', rates: ['gbp'] }));
    await repo.putRates(ratesRow({ guestNationality: 'GB', rates: ['gb'] }));
    await repo.putRates(ratesRow({ checkOut: '2027-02-14', rates: ['later'] }));

    expect((await repo.getRates(KEY))?.rates).toEqual(['base']);
    expect((await repo.getRates({ ...KEY, occupancySig: 'a3-c0-r1' }))?.rates).toEqual(['three']);
    expect((await repo.getRates({ ...KEY, currency: 'GBP' }))?.rates).toEqual(['gbp']);
    expect((await repo.getRates({ ...KEY, guestNationality: 'GB' }))?.rates).toEqual(['gb']);
    expect((await repo.getRates({ ...KEY, checkOut: '2027-02-14' }))?.rates).toEqual(['later']);
    expect(await repo.getRates({ ...KEY, destinationCode: 'BCN' })).toBeNull();
  });

  it('reads an expired rates row as null', async () => {
    await repo.putRates(ratesRow({ expiresAt: iso(clockMs + HOUR) }));
    expect(await repo.getRates(KEY)).not.toBeNull();

    clockMs += 2 * HOUR;

    expect(await repo.getRates(KEY)).toBeNull();
  });

  it('recentRates returns only unexpired rows of the environment, newest first, capped', async () => {
    const put = (code: string, observedMin: number, extra: Partial<LiteApiRatesRow> = {}) =>
      repo.putRates(
        ratesRow({
          destinationCode: code,
          observedAt: iso(clockMs - observedMin * 60_000),
          ...extra,
        }),
      );
    await put('AAA', 30);
    await put('BBB', 10);
    await put('CCC', 20);
    await put('DDD', 5, { environment: 'production' });
    await put('EEE', 1, { expiresAt: iso(clockMs + HOUR) });
    clockMs += 2 * HOUR;
    await put('FFF', 40, { observedAt: iso(clockMs - 40 * 60_000) });

    const all = await repo.recentRates({ environment: 'sandbox', limit: 12 });
    expect(all.map((row) => row.destinationCode)).toEqual(['FFF', 'BBB', 'CCC', 'AAA']);
    expect(all.every((row) => row.environment === 'sandbox')).toBe(true);

    const two = await repo.recentRates({ environment: 'sandbox', limit: 2 });
    expect(two).toHaveLength(2);
    expect(two.map((row) => row.destinationCode)).toEqual(
      all.slice(0, 2).map((row) => row.destinationCode),
    );
    expect(await repo.recentRates({ environment: 'production', limit: 5 })).toHaveLength(1);
  });

  it('recentRates never returns more than 12 rows', async () => {
    for (let i = 0; i < 15; i += 1) {
      await repo.putRates(
        ratesRow({ destinationCode: `D${i}`, observedAt: iso(clockMs - i * 60_000) }),
      );
    }
    const rows = await repo.recentRates({ environment: 'sandbox', limit: 50 });
    expect(rows).toHaveLength(12);
    expect(rows[0]?.destinationCode).toBe('D0');
  });

  it('deletes expired rows when another row is written', async () => {
    await repo.putRates(ratesRow({ expiresAt: iso(clockMs + HOUR) }));
    clockMs += 2 * HOUR;
    await repo.putRates(
      ratesRow({
        occupancySig: 'a1-c0-r1',
        observedAt: iso(clockMs),
        expiresAt: iso(clockMs + HOUR),
      }),
    );

    // Move the clock back: if the old row had only been hidden by its expiry it would return.
    clockMs -= 2 * HOUR;

    expect(await repo.getRates(KEY)).toBeNull();
  });

  it('returns unexpired hotels for one destination only, and upserts by hotel id', async () => {
    await repo.putHotels([
      hotelRow('a'),
      hotelRow('b'),
      hotelRow('x', { destinationCode: 'BCN' }),
      hotelRow('old', { expiresAt: iso(clockMs - HOUR) }),
    ]);
    await repo.putHotels([hotelRow('a', { content: { name: 'Renamed' } })]);

    const lisbon = await repo.getHotels('LIS');

    expect(lisbon.map((row) => row.hotelId).sort()).toEqual(['a', 'b']);
    expect(lisbon.find((row) => row.hotelId === 'a')?.content).toEqual({ name: 'Renamed' });
    expect((await repo.getHotels('BCN')).map((row) => row.hotelId)).toEqual(['x']);
  });

  it('records a run, finishes it with a code, and counts calls since a moment', async () => {
    const started = await repo.startRun({
      runId: 'r1',
      job: 'liteapi.snapshot.refresh',
      destinationCode: 'LIS',
      checkIn: '2027-02-09',
      checkOut: '2027-02-13',
      environment: 'sandbox',
    });
    expect(started.status).toBe('running');
    expect(started.startedAt).toBe(iso(clockMs));

    await repo.finishRun('r1', { status: 'failed', callsMade: 2, errorCode: 'PROVIDER_TIMEOUT' });

    const latest = await repo.latestRun();
    expect(latest).toMatchObject({
      runId: 'r1',
      status: 'failed',
      callsMade: 2,
      errorCode: 'PROVIDER_TIMEOUT',
      checkIn: '2027-02-09',
    });
    expect(latest?.finishedAt).toBe(iso(clockMs));
  });

  it('orders latestRun by start time and ignores a disabled record', async () => {
    const base = {
      job: 'liteapi.snapshot.refresh',
      destinationCode: 'LIS',
      checkIn: '2027-02-09',
      checkOut: '2027-02-13',
      environment: 'sandbox' as const,
    };
    expect(await repo.latestRun()).toBeNull();

    await repo.startRun({ ...base, runId: 'first' });
    clockMs += HOUR;
    await repo.startRun({ ...base, runId: 'second' });
    clockMs += HOUR;
    await repo.startRun({ ...base, runId: 'off' });
    await repo.finishRun('off', { status: 'disabled', callsMade: 0 });

    expect((await repo.latestRun())?.runId).toBe('second');
  });

  it('sums calls made by runs started at or after the cut-off', async () => {
    const base = {
      job: 'liteapi.snapshot.refresh',
      destinationCode: 'LIS',
      checkIn: '2027-02-09',
      checkOut: '2027-02-13',
      environment: 'sandbox' as const,
    };
    await repo.startRun({ ...base, runId: 'yesterday' });
    await repo.finishRun('yesterday', { status: 'ok', callsMade: 2 });
    const cutoff = iso(clockMs + HOUR);
    clockMs += 2 * HOUR;
    await repo.startRun({ ...base, runId: 'today-1' });
    await repo.finishRun('today-1', { status: 'ok', callsMade: 2 });
    await repo.startRun({ ...base, runId: 'today-2' });
    await repo.finishRun('today-2', { status: 'ok', callsMade: 1 });

    expect(await repo.callsSince(cutoff)).toBe(3);
    expect(await repo.callsSince(iso(clockMs + HOUR))).toBe(0);
  });

  it('round-trips a flights row, with dates as plain strings', async () => {
    await repo.putFlights(flightsRow());

    const read = await repo.getFlights(FLIGHTS_KEY);

    expect(read).toEqual(flightsRow());
    expect(read?.departureDate).toBe('2027-02-09');
  });

  it('replaces a flights row on a second put, and keeps other keys apart', async () => {
    await repo.putFlights(flightsRow({ runId: 'run-1', offers: ['one'] }));
    await repo.putFlights(flightsRow({ runId: 'run-2', offers: ['two'] }));
    await repo.putFlights(flightsRow({ origin: 'BUD', offers: ['bud'] }));
    await repo.putFlights(flightsRow({ adults: 3, offers: ['three'] }));
    await repo.putFlights(flightsRow({ cabin: 'BUSINESS', offers: ['biz'] }));

    expect((await repo.getFlights(FLIGHTS_KEY))?.offers).toEqual(['two']);
    expect((await repo.getFlights({ ...FLIGHTS_KEY, origin: 'BUD' }))?.offers).toEqual(['bud']);
    expect((await repo.getFlights({ ...FLIGHTS_KEY, adults: 3 }))?.offers).toEqual(['three']);
    expect((await repo.getFlights({ ...FLIGHTS_KEY, cabin: 'BUSINESS' }))?.offers).toEqual(['biz']);
    expect(await repo.getFlights({ ...FLIGHTS_KEY, currency: 'GBP' })).toBeNull();
  });

  it('reads an expired flights row as null, and deletes it on the next write', async () => {
    await repo.putFlights(flightsRow({ expiresAt: iso(clockMs + HOUR) }));
    expect(await repo.getFlights(FLIGHTS_KEY)).not.toBeNull();

    clockMs += 2 * HOUR;
    expect(await repo.getFlights(FLIGHTS_KEY)).toBeNull();

    await repo.putFlights(
      flightsRow({ origin: 'BUD', observedAt: iso(clockMs), expiresAt: iso(clockMs + HOUR) }),
    );
    clockMs -= 2 * HOUR;
    expect(await repo.getFlights(FLIGHTS_KEY)).toBeNull();
  });

  it('counts calls and finds the latest run per job', async () => {
    const base = {
      destinationCode: 'VIE-LIS',
      checkIn: '2027-02-09',
      checkOut: '2027-02-13',
      environment: 'sandbox' as const,
    };
    await repo.startRun({ ...base, runId: 'h1', job: 'liteapi.snapshot.refresh' });
    await repo.finishRun('h1', { status: 'ok', callsMade: 2 });
    clockMs += HOUR;
    await repo.startRun({ ...base, runId: 'f1', job: 'liteapi.flights.refresh' });
    await repo.finishRun('f1', { status: 'ok', callsMade: 1 });
    const since = iso(clockMs - 2 * HOUR);

    expect(await repo.callsSince(since)).toBe(3);
    expect(await repo.callsSince(since, 'liteapi.flights.refresh')).toBe(1);
    expect((await repo.latestRun())?.runId).toBe('f1');
    expect((await repo.latestRun('liteapi.snapshot.refresh'))?.runId).toBe('h1');
    expect(await repo.latestRun('nope')).toBeNull();
  });

  it('refuses to finish a run that was never started', async () => {
    await expect(repo.finishRun('nope', { status: 'ok', callsMade: 0 })).rejects.toThrow();
  });
});
