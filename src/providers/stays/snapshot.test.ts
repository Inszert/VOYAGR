import { describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { STORED_SCHEMA_VERSION, toStoredRates } from '@/liteapi-snapshot/stored-schema';
import { ratesKey } from '@/liteapi-snapshot/targets';
import { aProperty, aRate } from '@/liteapi-snapshot/test-support';
import type { StayQuery } from '@/core/stay/types';
import { createSnapshotStayProvider, SnapshotStayProvider } from './snapshot';

const NOW = Date.parse('2027-01-10T13:00:00.000Z');
const query: StayQuery = {
  destination: { code: 'LIS', name: 'Lisbon', position: null, radiusKm: null },
  checkIn: '2027-02-09',
  checkOut: '2027-02-13',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'EUR',
};

async function seeded() {
  const repositories = createMemoryRepositories({ now: () => NOW });
  await repositories.liteapiSnapshot.putRates({
    ...ratesKey({
      destinationCode: 'LIS',
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      occupancy: query.occupancy,
      currency: 'EUR',
      guestNationality: 'US',
    }),
    environment: 'sandbox',
    schemaVersion: STORED_SCHEMA_VERSION,
    rates: toStoredRates([{ property: aProperty, rates: [aRate] }]),
    observedAt: '2027-01-10T08:00:00.000Z',
    expiresAt: '2027-01-11T08:00:00.000Z',
    runId: 'r',
  });
  return repositories;
}

describe('the snapshot stay provider', () => {
  it('is absent without a key, and labelled test for a sandbox key and live for a production key', () => {
    expect(createSnapshotStayProvider({ LITEAPI_API_KEY: undefined })).toBeNull();
    expect(createSnapshotStayProvider({ LITEAPI_API_KEY: 'sand_x' })?.metadata).toMatchObject({
      id: 'liteapi',
      kind: 'stays',
      mode: 'test',
      isMock: false,
    });
    expect(createSnapshotStayProvider({ LITEAPI_API_KEY: 'prod_x' })?.metadata.mode).toBe('live');
  });

  it('answers from the stored row with no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const repositories = await seeded();
    const provider = new SnapshotStayProvider('test', {
      now: () => NOW,
      dependencies: () => ({
        repository: repositories.liteapiSnapshot,
        refreshesPerDay: 3,
        guestNationality: 'US',
      }),
    });

    const result = await provider.searchStays(query);

    if (!result.ok) throw result.error;
    expect(result.value).toEqual([{ property: aProperty, rates: [aRate] }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('answers an empty list, not an error, for a window with no row or a search with no code', async () => {
    const repositories = await seeded();
    const provider = new SnapshotStayProvider('test', {
      now: () => NOW,
      dependencies: () => ({
        repository: repositories.liteapiSnapshot,
        refreshesPerDay: 3,
        guestNationality: 'US',
      }),
    });

    const other = await provider.searchStays({ ...query, checkOut: '2027-02-14' });
    const noCode = await provider.searchStays({
      ...query,
      destination: { ...query.destination, code: null },
    });

    expect(other).toEqual({ ok: true, value: [] });
    expect(noCode).toEqual({ ok: true, value: [] });
  });

  it('degrades to an error result, never a throw, when the database cannot be read', async () => {
    const provider = new SnapshotStayProvider('test', {
      dependencies: () => ({
        repository: {
          getRates: async () => {
            throw new Error('connection refused');
          },
        },
        refreshesPerDay: 3,
        guestNationality: 'US',
      }),
    });

    const result = await provider.searchStays(query);

    expect(result.ok).toBe(false);
  });
});
