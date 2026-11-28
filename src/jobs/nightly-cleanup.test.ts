import { describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import type { KiwiOffersRow } from '@/db/repository';
import type { Job } from '@/queue/types';
import {
  createNightlyCleanupHandler,
  NIGHTLY_CLEANUP_JOB,
  startNightlyCleanupScheduler,
} from './nightly-cleanup';

function kiwiRow(departureDate: string, amount: number): KiwiOffersRow {
  return {
    origin: 'VIE',
    destination: 'LIS',
    departureDate,
    returnDate: '2027-12-31',
    adults: 1,
    currency: 'EUR',
    schemaVersion: 1,
    offers: [{ id: 'o', price: { amount, currency: 'EUR' } }],
    observedAt: '2027-01-01T00:00:00.000Z',
  };
}

const job = (day: string): Job<typeof NIGHTLY_CLEANUP_JOB> => ({
  id: 'j1',
  name: NIGHTLY_CLEANUP_JOB,
  payload: { day },
  attempt: 1,
  enqueuedAt: '2027-03-10T03:00:00.000Z',
});

describe('cleanup.nightly', () => {
  it('deletes only past rows, keeps the baseline, and makes zero provider calls', async () => {
    const repositories = createMemoryRepositories();
    await repositories.kiwiOffers.put(kiwiRow('2027-03-01', 20000));
    await repositories.kiwiOffers.put(kiwiRow('2027-03-09', 10000));
    await repositories.kiwiOffers.put(kiwiRow('2027-03-10', 99900));
    await repositories.kiwiOffers.put(kiwiRow('2027-06-01', 55500));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const handler = createNightlyCleanupHandler({
      repositories,
      now: () => Date.parse('2027-03-10T03:00:00.000Z'),
    });
    await handler(job('2027-03-10'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await repositories.kiwiOffers.listDepartingBefore('2100-01-01')).toHaveLength(2);
    expect(await repositories.kiwiOffers.listDepartingBefore('2027-03-10')).toEqual([]);
    expect(await repositories.routeAggregates.list('VIE', 'LIS')).toEqual([
      {
        origin: 'VIE',
        destination: 'LIS',
        month: '2027-03',
        currency: 'EUR',
        medianMinor: 15000,
        minMinor: 10000,
        sampleCount: 2,
        computedAt: '2027-03-10T03:00:00.000Z',
      },
    ]);
    fetchSpy.mockRestore();
  });

  it('does nothing when nothing is past', async () => {
    const repositories = createMemoryRepositories();
    await repositories.kiwiOffers.put(kiwiRow('2027-06-01', 1));
    await createNightlyCleanupHandler({ repositories })(job('2027-03-10'));
    expect(await repositories.routeAggregates.list('VIE', 'LIS')).toEqual([]);
  });
});

describe('nightly cleanup scheduler', () => {
  it('enqueues once a day from the configured UTC hour, not before', async () => {
    let at = Date.parse('2027-03-10T02:59:00.000Z');
    const enqueue = vi.fn().mockResolvedValue('id');
    const scheduler = startNightlyCleanupScheduler({ enqueue }, { hourUtc: 3, now: () => at });
    expect(await scheduler.check()).toBe(false);
    at = Date.parse('2027-03-10T03:00:00.000Z');
    expect(await scheduler.check()).toBe(true);
    at = Date.parse('2027-03-10T15:00:00.000Z');
    expect(await scheduler.check()).toBe(false);
    at = Date.parse('2027-03-11T03:01:00.000Z');
    expect(await scheduler.check()).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[0]?.[0]).toBe('cleanup.nightly');
    expect(enqueue.mock.calls[0]?.[1]).toEqual({ day: '2027-03-10' });
    scheduler.stop();
  });
});
