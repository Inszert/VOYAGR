import { beforeEach, describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { createMemoryRepositories } from '@/db/memory';
import type { Repositories } from '@/db/repository';
import { prunePriceHistory, sweepExpiredSessions } from './maintenance';

/**
 * Worker housekeeping.
 *
 * Both sweeps delete data, so the tests are mostly about what they must *not*
 * take: a live session, and the cheapest price a watch ever saw.
 */

const NOW = Date.parse('2026-09-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

let repositories: Repositories;

beforeEach(async () => {
  repositories = createMemoryRepositories();
  await repositories.users.create({ id: 'user-1', email: 'a@example.invalid', plan: 'free' });
});

describe('sweepExpiredSessions', () => {
  async function aSession(id: string, expiresAt: string) {
    return repositories.sessions.create({
      id,
      userId: 'user-1',
      tokenHash: `hash-${id}`,
      expiresAt,
    });
  }

  it('removes what has expired and leaves what has not', async () => {
    await aSession('stale', new Date(NOW - DAY).toISOString());
    await aSession('live', new Date(NOW + DAY).toISOString());

    const removed = await sweepExpiredSessions({ repositories, now: () => NOW });

    expect(removed).toBe(1);
    expect(await repositories.sessions.findByTokenHash('hash-stale')).toBeNull();
    // Signing a user out mid-session would be housekeeping doing real damage.
    expect(await repositories.sessions.findByTokenHash('hash-live')).not.toBeNull();
  });

  it('does nothing when there is nothing to do', async () => {
    expect(await sweepExpiredSessions({ repositories, now: () => NOW })).toBe(0);
  });
});

describe('prunePriceHistory', () => {
  async function aWatchId() {
    const search = await repositories.tripSearches.create({
      id: 'search-1',
      userId: 'user-1',
      name: 'Watched',
      profile: buildProfile(),
      destinations: ['AYT'],
    });

    const watch = await repositories.travelWatches.create({
      id: 'watch-1',
      userId: 'user-1',
      tripSearchId: search.id,
      status: 'active',
      priority: 'normal',
      lastRunAt: null,
      nextRunAt: new Date(NOW).toISOString(),
      bestKnownTotal: null,
    });

    return watch.id;
  }

  async function observe(watchId: string, amount: number, daysAgo: number) {
    return repositories.priceHistory.record({
      watchId,
      componentType: 'trip_total',
      componentId: 'candidate-1',
      amount: money(amount, 'EUR'),
      providerId: 'voyagr.cost-engine',
      observedAt: new Date(NOW - daysAgo * DAY).toISOString(),
      conditions: null,
    });
  }

  it('drops observations past the retention window', async () => {
    const watchId = await aWatchId();
    await observe(watchId, 70000, 120);
    await observe(watchId, 69000, 100);
    await observe(watchId, 68000, 10);

    const removed = await prunePriceHistory({ repositories, now: () => NOW }, 90);

    expect(removed).toBe(2);
    expect(await repositories.priceHistory.listForWatch(watchId)).toHaveLength(1);
  });

  it('never drops the cheapest, however old it is', async () => {
    // bestKnownTotal is derived from this table. Pruning the cheapest row would
    // raise it and invent a price rise the user never experienced.
    const watchId = await aWatchId();
    await observe(watchId, 61000, 200);
    await observe(watchId, 72000, 180);
    await observe(watchId, 68000, 5);

    await prunePriceHistory({ repositories, now: () => NOW }, 90);

    const lowest = await repositories.priceHistory.findLowest(watchId, 'trip_total', 'EUR');
    expect(lowest?.amount).toEqual(money(61000, 'EUR'));
  });

  it('keeps the cheapest of each component and currency separately', async () => {
    const watchId = await aWatchId();

    await repositories.priceHistory.record({
      watchId,
      componentType: 'flight',
      componentId: 'f1',
      amount: money(20000, 'EUR'),
      providerId: 'mock-flights',
      observedAt: new Date(NOW - 200 * DAY).toISOString(),
      conditions: null,
    });
    await observe(watchId, 61000, 200);

    await prunePriceHistory({ repositories, now: () => NOW }, 90);

    expect(await repositories.priceHistory.findLowest(watchId, 'flight', 'EUR')).not.toBeNull();
    expect(await repositories.priceHistory.findLowest(watchId, 'trip_total', 'EUR')).not.toBeNull();
  });

  it('leaves a young history entirely alone', async () => {
    const watchId = await aWatchId();
    await observe(watchId, 70000, 3);
    await observe(watchId, 68000, 1);

    expect(await prunePriceHistory({ repositories, now: () => NOW }, 90)).toBe(0);
  });
});
