import { describe, expect, it } from 'vitest';
import type { StayQuery } from '@/core/stay/types';
import { createMemoryRepositories } from '@/db/memory';
import type { LiteApiRatesRow } from '@/db/repository';
import { snapshotStatus, readSnapshot, type SnapshotReadDependencies } from './read';
import { stalenessLine } from './staleness';
import { STORED_SCHEMA_VERSION, toStoredRates } from './stored-schema';
import { ratesKey } from './targets';
import { aProperty, aRate } from './test-support';

const HOUR = 3_600_000;
const NOW = Date.parse('2027-01-10T20:00:00.000Z');
const query: StayQuery = {
  destination: { code: 'LIS', name: 'Lisbon', position: null, radiusKm: null },
  checkIn: '2027-02-09',
  checkOut: '2027-02-13',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'EUR',
};
const KEY = ratesKey({
  destinationCode: 'LIS',
  checkIn: query.checkIn,
  checkOut: query.checkOut,
  occupancy: query.occupancy,
  currency: 'EUR',
  guestNationality: 'US',
});

async function setup(row?: Partial<LiteApiRatesRow>, rateProvenance: 'test' | 'live' = 'test') {
  const repositories = createMemoryRepositories({ now: () => NOW });
  const observed = NOW - 5 * HOUR;
  if (row !== null) {
    await repositories.liteapiSnapshot.putRates({
      ...KEY,
      environment: 'production',
      schemaVersion: STORED_SCHEMA_VERSION,
      rates: toStoredRates([
        {
          property: aProperty,
          rates: [{ ...aRate, source: { ...aRate.source, provenance: rateProvenance } }],
        },
      ]),
      observedAt: new Date(observed).toISOString(),
      expiresAt: new Date(observed + 24 * HOUR).toISOString(),
      runId: 'r',
      ...row,
    });
  }
  const dependencies: SnapshotReadDependencies = {
    repository: repositories.liteapiSnapshot,
    refreshesPerDay: 3,
    guestNationality: 'US',
  };
  return dependencies;
}

describe('snapshotStatus', () => {
  it('is fresh at 5 hours, in the exact words, with the offers', async () => {
    const dependencies = await setup();

    const read = await readSnapshot(query, NOW, dependencies);

    expect(read.status).toMatchObject({ state: 'fresh', ageHours: 5 });
    expect(stalenessLine(read.status)).toBe('Updated 5 hours ago');
    expect(read.offers).toEqual([
      expect.objectContaining({ rates: [expect.objectContaining({ providerRateId: 'offer-1' })] }),
    ]);
  });

  it('is aging past 16 hours, in the exact words', async () => {
    const observed = NOW - 20 * HOUR;
    const dependencies = await setup({
      observedAt: new Date(observed).toISOString(),
      expiresAt: new Date(observed + 24 * HOUR).toISOString(),
    });

    const status = await snapshotStatus(query, NOW, dependencies);

    expect(status.state).toBe('aging');
    expect(stalenessLine(status)).toBe('Prices last checked 20 hours ago');
  });

  it('is missing, with the exact line and no offers, when there is no row', async () => {
    const dependencies = await setup(null as never);

    const read = await readSnapshot(query, NOW, dependencies);

    expect(read.offers).toEqual([]);
    expect(stalenessLine(read.status)).toBe('Hotel prices are not loaded for these dates yet.');
  });

  it('is missing for another window, another party, another currency, or no destination code', async () => {
    const dependencies = await setup();
    const missing = async (patch: Partial<StayQuery>) =>
      (await snapshotStatus({ ...query, ...patch }, NOW, dependencies)).state;

    expect(await missing({ checkOut: '2027-02-14' })).toBe('missing');
    expect(await missing({ occupancy: { adults: 2, children: 1, rooms: 1 } })).toBe('missing');
    expect(await missing({ occupancy: { adults: 3, children: 0, rooms: 1 } })).toBe('missing');
    expect(await missing({ currency: 'GBP' })).toBe('missing');
    expect(
      await missing({
        destination: { code: null, name: 'Lisbon', position: null, radiusKm: null },
      }),
    ).toBe('missing');
  });

  it('is missing once the row has expired', async () => {
    const dependencies = await setup();

    expect((await snapshotStatus(query, NOW + 20 * HOUR, dependencies)).state).toBe('missing');
  });

  it('is unknown, price kept and no age claim, when observed in the future', async () => {
    const dependencies = await setup({
      observedAt: new Date(NOW + 3 * HOUR).toISOString(),
      expiresAt: new Date(NOW + 27 * HOUR).toISOString(),
    });

    const read = await readSnapshot(query, NOW, dependencies);

    expect(read.status).toMatchObject({ state: 'unknown', ageHours: null });
    expect(stalenessLine(read.status)).toBeNull();
    expect(read.offers).toHaveLength(1);
  });

  it('reads a row of another schema version as missing, never half-parsed', async () => {
    const dependencies = await setup({ schemaVersion: STORED_SCHEMA_VERSION + 1 });

    const read = await readSnapshot(query, NOW, dependencies);

    expect(read.status.state).toBe('missing');
    expect(read.offers).toEqual([]);
  });

  it('flags test prices for a sandbox row, and for any rate marked test', async () => {
    expect(
      (await snapshotStatus(query, NOW, await setup({ environment: 'sandbox' }, 'live')))
        .testPrices,
    ).toBe(true);
    expect(
      (await snapshotStatus(query, NOW, await setup({ environment: 'production' }, 'test')))
        .testPrices,
    ).toBe(true);
    expect(
      (await snapshotStatus(query, NOW, await setup({ environment: 'production' }, 'live')))
        .testPrices,
    ).toBe(false);
  });
});
