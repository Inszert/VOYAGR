import { beforeEach, describe, expect, it } from 'vitest';
import { buildProfile } from '@/core/trip/test-support';
import { createMemoryRepositories } from '@/db/memory';
import { createMemoryQueueDriver } from '@/queue/memory';
import type { QueueDriver } from '@/queue/types';
import type { Repositories } from '@/db/repository';
import { refreshDedupeKey, sweepDueWatches } from './scheduler';

/**
 * The scheduler decides what is due, never what to do about it. These tests are
 * about the two things that go wrong with that: missing a watch that was due,
 * and enqueueing the same one twice.
 */

let repositories: Repositories;
let queue: QueueDriver;
let clock: number;

beforeEach(async () => {
  repositories = createMemoryRepositories();
  queue = createMemoryQueueDriver();
  clock = Date.parse('2026-09-19T12:00:00.000Z');

  await repositories.users.create({ id: 'user-1', email: 'a@example.invalid', plan: 'free' });
});

async function aWatch(nextRunAt: string, status: 'active' | 'paused' = 'active') {
  const search = await repositories.tripSearches.create({
    id: `search-${Math.random()}`,
    userId: 'user-1',
    name: 'Watched',
    profile: buildProfile(),
    destinations: ['AYT'],
  });

  return repositories.travelWatches.create({
    id: `watch-${Math.random()}`,
    userId: 'user-1',
    tripSearchId: search.id,
    status,
    priority: 'normal',
    lastRunAt: null,
    nextRunAt,
    bestKnownTotal: null,
  });
}

const past = () => new Date(clock - 60_000).toISOString();
const future = () => new Date(clock + 3_600_000).toISOString();

describe('sweepDueWatches', () => {
  it('enqueues a refresh for each watch past its deadline', async () => {
    await aWatch(past());
    await aWatch(past());

    const result = await sweepDueWatches({ repositories, queue, now: () => clock });

    expect(result).toEqual({ due: 2, enqueued: 2 });
    expect((await queue.stats()).pending).toBe(2);
  });

  it('leaves a watch alone until its deadline passes', async () => {
    await aWatch(future());

    expect(await sweepDueWatches({ repositories, queue, now: () => clock })).toEqual({
      due: 0,
      enqueued: 0,
    });
  });

  it('ignores a paused watch however long ago it was due', async () => {
    await aWatch(past(), 'paused');

    expect(await sweepDueWatches({ repositories, queue, now: () => clock })).toEqual({
      due: 0,
      enqueued: 0,
    });
  });

  it('does not queue the same watch twice for the same deadline', async () => {
    // Two sweeps overlapping - a slow one and the next tick - must not mean two
    // refreshes and twice the provider calls.
    await aWatch(past());

    await sweepDueWatches({ repositories, queue, now: () => clock });
    await sweepDueWatches({ repositories, queue, now: () => clock });

    expect((await queue.stats()).pending).toBe(1);
  });

  it('honours the batch limit', async () => {
    await aWatch(past());
    await aWatch(past());
    await aWatch(past());

    expect(await sweepDueWatches({ repositories, queue, now: () => clock }, 2)).toEqual({
      due: 2,
      enqueued: 2,
    });
  });
});

describe('refreshDedupeKey', () => {
  it('is stable for one watch and one deadline', () => {
    expect(refreshDedupeKey('w1', '2026-09-19T12:00:00.000Z')).toBe(
      refreshDedupeKey('w1', '2026-09-19T12:00:00.000Z'),
    );
  });

  it('changes once the watch is rescheduled', () => {
    // Keying on the id alone would stop a watch being enqueued again after it
    // had run, until the old job was cleaned up.
    expect(refreshDedupeKey('w1', '2026-09-19T12:00:00.000Z')).not.toBe(
      refreshDedupeKey('w1', '2026-09-19T18:00:00.000Z'),
    );
  });
});
