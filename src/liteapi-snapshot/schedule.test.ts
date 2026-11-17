import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { MemoryQueueDriver } from '@/queue/memory';
import { slotOf, slotStart, startSnapshotScheduler, type SnapshotScheduler } from './schedule';
import { LAUNCH_DESTINATIONS } from './targets';

const at = (iso: string) => Date.parse(iso);
const JOBS_PER_ROUND = LAUNCH_DESTINATIONS.length * 3;

describe('slots', () => {
  it('puts three rounds a day at 00:00, 08:00 and 16:00 UTC', () => {
    const slots = [
      '2027-01-10T00:00:00Z',
      '2027-01-10T07:59:59Z',
      '2027-01-10T08:00:00Z',
      '2027-01-10T15:59:59Z',
      '2027-01-10T16:00:00Z',
      '2027-01-10T23:59:59Z',
      '2027-01-11T00:00:00Z',
    ].map((iso) => slotOf(at(iso), 3));

    expect(slots[1]).toBe(slots[0]);
    expect(slots[2]).toBe(slots[0]! + 1);
    expect(slots[3]).toBe(slots[2]);
    expect(slots[4]).toBe(slots[0]! + 2);
    expect(slots[5]).toBe(slots[4]);
    expect(slots[6]).toBe(slots[0]! + 3);
  });

  it('starts a slot where its index says it does', () => {
    const slot = slotOf(at('2027-01-10T09:30:00Z'), 3);
    expect(new Date(slotStart(slot, 3)).toISOString()).toBe('2027-01-10T08:00:00.000Z');
    expect(new Date(slotStart(slotOf(at('2027-01-10T01:00:00Z'), 24), 24)).toISOString()).toBe(
      '2027-01-10T01:00:00.000Z',
    );
  });
});

describe('the scheduler with flights', () => {
  it('enqueues flights jobs for each origin, and not again after a restart in the same slot', async () => {
    const clock = { now: at('2027-01-10T08:05:00Z') };
    const repositories = createMemoryRepositories({ now: () => clock.now });
    const queue = new MemoryQueueDriver();
    const enqueue = vi.spyOn(queue, 'enqueue');
    const options = {
      refreshesPerDay: 3,
      guestNationality: 'US',
      now: () => clock.now,
      checkMs: 3_600_000,
      origins: ['VIE', 'LON'],
    };

    const first = startSnapshotScheduler(
      { queue, repository: repositories.liteapiSnapshot },
      options,
    );
    expect(await first.initial).toBe(true);
    first.stop();

    const flights = enqueue.mock.calls.filter(([name]) => name === 'liteapi.flights.refresh');
    // VIE skips VIE (also a destination): 5 + LON: 6, each in 3 windows.
    expect(flights).toHaveLength((5 + 6) * 3);
    expect(flights[0]![1]).toMatchObject({ origin: 'VIE', returnDate: '2027-02-13' });

    for (const [name, payload] of enqueue.mock.calls) {
      await repositories.liteapiSnapshot.startRun({
        runId: `r-${Math.random()}`,
        job: name,
        destinationCode: 'x',
        checkIn: (payload as { checkIn?: string }).checkIn ?? '2027-02-09',
        checkOut: '2027-02-13',
        environment: 'sandbox',
      });
    }
    enqueue.mockClear();
    clock.now = at('2027-01-10T10:00:00Z');
    const restarted = startSnapshotScheduler(
      { queue, repository: repositories.liteapiSnapshot },
      options,
    );
    expect(await restarted.initial).toBe(false);
    restarted.stop();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues no flights job when no origins are given', async () => {
    const clock = { now: at('2027-01-10T08:05:00Z') };
    const repositories = createMemoryRepositories({ now: () => clock.now });
    const queue = new MemoryQueueDriver();
    const enqueue = vi.spyOn(queue, 'enqueue');
    const s = startSnapshotScheduler(
      { queue, repository: repositories.liteapiSnapshot },
      { refreshesPerDay: 3, guestNationality: 'US', now: () => clock.now, checkMs: 3_600_000 },
    );
    await s.initial;
    s.stop();

    expect(enqueue.mock.calls.some(([name]) => name === 'liteapi.flights.refresh')).toBe(false);
  });
});

describe('the scheduler', () => {
  let scheduler: SnapshotScheduler | undefined;
  afterEach(() => scheduler?.stop());

  function setup(clock: { now: number }, refreshesPerDay = 3) {
    const repositories = createMemoryRepositories({ now: () => clock.now });
    const queue = new MemoryQueueDriver();
    const enqueue = vi.spyOn(queue, 'enqueue');
    scheduler = startSnapshotScheduler(
      { queue, repository: repositories.liteapiSnapshot },
      {
        refreshesPerDay,
        guestNationality: 'US',
        now: () => clock.now,
        checkMs: 3_600_000,
      },
    );
    return { repositories, enqueue, scheduler };
  }

  /** What the worker's handler would have recorded for a round. */
  async function recordRound(repositories: ReturnType<typeof createMemoryRepositories>) {
    await repositories.liteapiSnapshot.startRun({
      runId: `r-${Math.random()}`,
      job: 'liteapi.snapshot.refresh',
      destinationCode: 'LIS',
      checkIn: '2027-02-09',
      checkOut: '2027-02-13',
      environment: 'sandbox',
    });
  }

  it('starts a round on the first look, one job per destination and window, one attempt each', async () => {
    const clock = { now: at('2027-01-10T08:05:00Z') };
    const { enqueue, scheduler: s } = setup(clock);

    expect(await s.initial).toBe(true);

    expect(enqueue).toHaveBeenCalledTimes(JOBS_PER_ROUND);
    expect(enqueue.mock.calls[0]).toEqual([
      'liteapi.snapshot.refresh',
      { destination: 'LIS', checkIn: '2027-02-09', checkOut: '2027-02-13' },
      expect.objectContaining({ attempts: 1 }),
    ]);
  });

  it('starts exactly three rounds across a day, and none between slots', async () => {
    const clock = { now: at('2027-01-10T00:00:30Z') };
    const { enqueue, scheduler: s } = setup(clock);
    await s.initial;

    const started: boolean[] = [];
    for (const time of [
      '2027-01-10T03:00:00Z',
      '2027-01-10T07:59:00Z',
      '2027-01-10T08:00:30Z',
      '2027-01-10T12:00:00Z',
      '2027-01-10T16:00:30Z',
      '2027-01-10T23:59:00Z',
    ]) {
      clock.now = at(time);
      started.push(await s.check());
    }

    expect(started).toEqual([false, false, true, false, true, false]);
    expect(enqueue).toHaveBeenCalledTimes(3 * JOBS_PER_ROUND);
  });

  it('starts the next round when the day rolls over', async () => {
    const clock = { now: at('2027-01-10T16:30:00Z') };
    const { scheduler: s } = setup(clock);
    await s.initial;

    clock.now = at('2027-01-11T00:00:05Z');

    expect(await s.check()).toBe(true);
  });

  it('makes zero calls after a restart inside a slot that already ran', async () => {
    const clock = { now: at('2027-01-10T09:00:00Z') };
    const repositories = createMemoryRepositories({ now: () => clock.now });
    await recordRound(repositories);
    clock.now = at('2027-01-10T10:30:00Z');
    const queue = new MemoryQueueDriver();
    const enqueue = vi.spyOn(queue, 'enqueue');

    const restarted = startSnapshotScheduler(
      { queue, repository: repositories.liteapiSnapshot },
      { refreshesPerDay: 3, guestNationality: 'US', now: () => clock.now, checkMs: 3_600_000 },
    );
    scheduler = restarted;

    expect(await restarted.initial).toBe(false);
    expect(await restarted.check()).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does start a round after a restart in a later slot than the last run', async () => {
    const clock = { now: at('2027-01-10T09:00:00Z') };
    const repositories = createMemoryRepositories({ now: () => clock.now });
    await recordRound(repositories);
    clock.now = at('2027-01-10T16:10:00Z');
    const queue = new MemoryQueueDriver();
    const enqueue = vi.spyOn(queue, 'enqueue');

    scheduler = startSnapshotScheduler(
      { queue, repository: repositories.liteapiSnapshot },
      { refreshesPerDay: 3, guestNationality: 'US', now: () => clock.now, checkMs: 3_600_000 },
    );

    expect(await scheduler.initial).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(JOBS_PER_ROUND);
  });

  it('tries again at the next look when the database could not be read', async () => {
    const clock = { now: at('2027-01-10T08:05:00Z') };
    const queue = new MemoryQueueDriver();
    const enqueue = vi.spyOn(queue, 'enqueue');
    const latestRun = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(null);

    scheduler = startSnapshotScheduler(
      { queue, repository: { latestRun } },
      { refreshesPerDay: 3, guestNationality: 'US', now: () => clock.now, checkMs: 3_600_000 },
    );

    expect(await scheduler.initial).toBe(false);
    expect(await scheduler.check()).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(JOBS_PER_ROUND);
  });
});
