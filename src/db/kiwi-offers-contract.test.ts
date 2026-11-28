import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { closePool, query } from './client';
import { createMemoryRepositories } from './memory';
import { createPostgresRepositories } from './postgres';
import type { KiwiOffersKey, KiwiOffersRepository, KiwiOffersRow } from './repository';

/**
 * The Kiwi offers repository contract, run against every backend. Memory always; Postgres only
 * when `TEST_DATABASE_URL` answers and migration 0016 is applied (skipped otherwise, and shown
 * as skipped).
 */

const POSTGRES_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

interface Backend {
  readonly name: string;
  readonly create: () => KiwiOffersRepository;
  readonly reset: () => Promise<void>;
}

const backends: Backend[] = [
  {
    name: 'memory',
    create: () => createMemoryRepositories().kiwiOffers,
    reset: async () => undefined,
  },
];

let postgresActive = false;

if (POSTGRES_URL) {
  process.env.DATABASE_URL = POSTGRES_URL;
  resetEnvCache();
  try {
    await query('SELECT kiwi_offers.origin FROM kiwi_offers LIMIT 1');
    postgresActive = true;
  } catch {
    postgresActive = false;
  }

  if (postgresActive) {
    backends.push({
      name: 'postgres',
      create: () => createPostgresRepositories().kiwiOffers,
      reset: async () => {
        await query('TRUNCATE kiwi_offers');
      },
    });
  }

  afterAll(async () => {
    await closePool();
  });
}

const KEY: KiwiOffersKey = {
  origin: 'VIE',
  destination: 'LIS',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  adults: 2,
  currency: 'EUR',
};

function row(overrides: Partial<KiwiOffersRow> = {}): KiwiOffersRow {
  return {
    ...KEY,
    schemaVersion: 1,
    offers: [{ id: 'kiwi-mcp:o1', price: { amount: 25000, currency: 'EUR' } }],
    observedAt: '2027-01-10T12:00:00.000Z',
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

describe.each(backends)('kiwi offers repository: $name', (backend) => {
  let repo: KiwiOffersRepository;

  beforeEach(async () => {
    await backend.reset();
    repo = backend.create();
  });

  it('returns null when nothing was stored', async () => {
    expect(await repo.get(KEY)).toBeNull();
  });

  it('round-trips a row exactly', async () => {
    await repo.put(row());
    expect(await repo.get(KEY)).toEqual(row());
  });

  it('keeps a row however old it is, because age is the reader to decide', async () => {
    await repo.put(row({ observedAt: '2020-01-01T00:00:00.000Z' }));
    expect((await repo.get(KEY))?.observedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('replaces the row for the same key', async () => {
    await repo.put(row());
    await repo.put(row({ offers: [], observedAt: '2027-01-11T08:00:00.000Z' }));
    const stored = await repo.get(KEY);
    expect(stored?.offers).toEqual([]);
    expect(stored?.observedAt).toBe('2027-01-11T08:00:00.000Z');
  });

  it('keeps different keys apart', async () => {
    await repo.put(row());
    expect(await repo.get({ ...KEY, adults: 1 })).toBeNull();
    expect(await repo.get({ ...KEY, currency: 'USD' })).toBeNull();
    expect(await repo.get({ ...KEY, returnDate: '2027-02-14' })).toBeNull();
  });
});
