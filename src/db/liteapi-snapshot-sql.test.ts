import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries: { text: string; params: readonly unknown[] }[] = [];
vi.mock('./client', () => ({
  query: vi.fn(async (text: string, params: readonly unknown[] = []) => {
    queries.push({ text, params });
    return [];
  }),
  withTransaction: vi.fn(),
}));

import { createPostgresRepositories } from './postgres';

/**
 * The Postgres snapshot repository without a database: what it sends. Every statement is
 * parameterised, so a hostile destination code, run id or error code is data and never SQL.
 */
describe('Postgres LiteAPI snapshot SQL', () => {
  const NOW = Date.parse('2027-01-10T12:00:00.000Z');
  const hostile = "LIS'; DROP TABLE liteapi_hotels; --";

  beforeEach(() => {
    queries.length = 0;
  });

  it('binds every value, and interpolates none', async () => {
    const repo = createPostgresRepositories({ now: () => NOW }).liteapiSnapshot;
    const key = {
      destinationCode: hostile,
      checkIn: '2027-02-09',
      checkOut: '2027-02-13',
      occupancySig: 'a2-c0-r1',
      currency: 'EUR',
      guestNationality: 'US',
    };

    await repo.getRates(key);
    await repo.getHotels(hostile);
    await repo.putRates({
      ...key,
      environment: 'sandbox',
      schemaVersion: 1,
      rates: [{ note: hostile }],
      observedAt: '2027-01-10T11:00:00.000Z',
      expiresAt: '2027-01-11T11:00:00.000Z',
      runId: hostile,
    });
    await repo.putHotels([
      {
        hotelId: hostile,
        destinationCode: hostile,
        content: { name: hostile },
        fetchedAt: '2027-01-10T11:00:00.000Z',
        expiresAt: '2027-01-17T11:00:00.000Z',
      },
    ]);
    await repo
      .startRun({
        runId: hostile,
        job: 'liteapi.snapshot.refresh',
        destinationCode: hostile,
        checkIn: '2027-02-09',
        checkOut: '2027-02-13',
        environment: 'sandbox',
      })
      // The stubbed driver returns no row to read back; what was sent is what is under test.
      .catch(() => undefined);
    await repo.callsSince('2027-01-10T00:00:00.000Z');
    await repo.latestRun();
    await repo
      .finishRun(hostile, { status: 'failed', callsMade: 1, errorCode: hostile })
      .catch(() => undefined);

    expect(queries.length).toBeGreaterThan(8);
    for (const { text } of queries) {
      expect(text).not.toContain('DROP TABLE');
      expect(text).not.toContain('LIS');
      expect(text).not.toMatch(/\$\{|undefined/);
    }
    // The hostile text did travel, as a parameter.
    expect(queries.some((q) => q.params.includes(hostile))).toBe(true);
  });

  it('reads and sweeps against the injected clock, not the wall clock', async () => {
    const repo = createPostgresRepositories({ now: () => NOW }).liteapiSnapshot;

    await repo.getHotels('LIS');
    await repo.putHotels([]);

    expect(queries[0]!.params).toContain(new Date(NOW).toISOString());
    expect(queries.slice(1).every((q) => q.params.includes(new Date(NOW).toISOString()))).toBe(
      true,
    );
  });
});
