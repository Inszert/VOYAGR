import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { closePool, query } from './client';
import { createMemoryRepositories } from './memory';
import { createPostgresRepositories } from './postgres';
import type { KiwiOffersRow, Repositories } from './repository';

/**
 * Contract for the route graph, the route aggregates and the past-departure delete, run against
 * every backend. Memory always; Postgres only when `TEST_DATABASE_URL` answers and migrations
 * 0016 and 0017 are applied. Without a database the Postgres cases are skipped, not passed.
 */

const POSTGRES_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

interface Backend {
  readonly name: string;
  readonly create: () => Repositories;
  readonly reset: () => Promise<void>;
}

const backends: Backend[] = [
  { name: 'memory', create: () => createMemoryRepositories(), reset: async () => undefined },
];

let postgresActive = false;

if (POSTGRES_URL) {
  process.env.DATABASE_URL = POSTGRES_URL;
  resetEnvCache();
  try {
    await query('SELECT origin FROM route_graph LIMIT 1');
    await query('SELECT origin FROM route_aggregates LIMIT 1');
    postgresActive = true;
  } catch {
    postgresActive = false;
  }
  if (postgresActive) {
    backends.push({
      name: 'postgres',
      create: () => createPostgresRepositories(),
      reset: async () => {
        await query('TRUNCATE route_graph, route_aggregates, kiwi_offers');
      },
    });
  }
  afterAll(async () => {
    await closePool();
  });
}

function kiwiRow(departureDate: string, adults = 1): KiwiOffersRow {
  return {
    origin: 'VIE',
    destination: 'LIS',
    departureDate,
    returnDate: '2027-12-31',
    adults,
    currency: 'EUR',
    schemaVersion: 1,
    offers: [{ id: 'o', price: { amount: 100, currency: 'EUR' } }],
    observedAt: '2027-01-01T00:00:00.000Z',
  };
}

it.skipIf(postgresActive)('postgres backend skipped: no database or migrations 0016/0017', () => {
  expect(backends.map((b) => b.name)).toEqual(['memory']);
});

describe.each(backends)('route graph, aggregates and cleanup: $name', (backend) => {
  let repos: Repositories;

  beforeEach(async () => {
    await backend.reset();
    repos = backend.create();
  });

  it('upserts edges, keeps firstSeenAt, moves lastSeenAt forward only', async () => {
    const edge = {
      origin: 'VIE',
      destination: 'LIS',
      carrier: 'TP',
      firstSeenAt: '2027-01-01T00:00:00.000Z',
      lastSeenAt: '2027-01-05T00:00:00.000Z',
    };
    await repos.routeGraph.upsertEdges([edge]);
    await repos.routeGraph.upsertEdges([
      { ...edge, firstSeenAt: '2027-02-01T00:00:00.000Z', lastSeenAt: '2027-02-02T00:00:00.000Z' },
    ]);
    await repos.routeGraph.upsertEdges([{ ...edge, lastSeenAt: '2027-01-02T00:00:00.000Z' }]);
    expect(await repos.routeGraph.destinationsFor('VIE')).toEqual([
      { ...edge, lastSeenAt: '2027-02-02T00:00:00.000Z' },
    ]);
  });

  it('reads destinations for one origin only, ordered', async () => {
    const seen = '2027-01-01T00:00:00.000Z';
    const e = (origin: string, destination: string, carrier: string) => ({
      origin,
      destination,
      carrier,
      firstSeenAt: seen,
      lastSeenAt: seen,
    });
    await repos.routeGraph.upsertEdges([
      e('VIE', 'OPO', 'FR'),
      e('VIE', 'LIS', 'TP'),
      e('VIE', 'LIS', 'OS'),
      e('BTS', 'LIS', 'FR'),
    ]);
    const out = await repos.routeGraph.destinationsFor('VIE');
    expect(out.map((x) => `${x.destination}:${x.carrier}`)).toEqual(['LIS:OS', 'LIS:TP', 'OPO:FR']);
    expect(await repos.routeGraph.destinationsFor('XXX')).toEqual([]);
  });

  it('writes aggregates and merges a second write for the same bucket', async () => {
    const a = {
      origin: 'VIE',
      destination: 'LIS',
      month: '2027-02',
      currency: 'EUR',
      medianMinor: 100,
      minMinor: 80,
      sampleCount: 1,
      computedAt: '2027-03-01T03:00:00.000Z',
    };
    await repos.routeAggregates.write([a]);
    expect(await repos.routeAggregates.list('VIE', 'LIS')).toEqual([a]);
    await repos.routeAggregates.write([
      {
        ...a,
        medianMinor: 200,
        minMinor: 150,
        sampleCount: 3,
        computedAt: '2027-03-02T03:00:00.000Z',
      },
    ]);
    expect(await repos.routeAggregates.list('VIE', 'LIS')).toEqual([
      {
        ...a,
        medianMinor: 175,
        minMinor: 80,
        sampleCount: 4,
        computedAt: '2027-03-02T03:00:00.000Z',
      },
    ]);
  });

  it('deletes only offers departing before the day, and lists them first', async () => {
    await repos.kiwiOffers.put(kiwiRow('2027-03-09'));
    await repos.kiwiOffers.put(kiwiRow('2027-03-10'));
    await repos.kiwiOffers.put(kiwiRow('2027-03-01', 2));
    const past = await repos.kiwiOffers.listDepartingBefore('2027-03-10');
    expect(past.map((r) => r.departureDate).sort()).toEqual(['2027-03-01', '2027-03-09']);
    expect(await repos.kiwiOffers.deleteDepartingBefore('2027-03-10')).toBe(2);
    expect(await repos.kiwiOffers.deleteDepartingBefore('2027-03-10')).toBe(0);
    expect(await repos.kiwiOffers.listDepartingBefore('2100-01-01')).toHaveLength(1);
  });
});
