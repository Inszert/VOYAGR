import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BullMqQueueDriver, toJobId } from './bullmq';
import type { Job, QueueDriver } from './types';

/**
 * BullMQ driver, against a real Redis.
 *
 * Skipped when `TEST_REDIS_URL` is absent, and reported as skipped rather than
 * silently passing. The in-memory driver satisfies the same contract, so what
 * is proven here is specifically what only Redis can prove: that jobs outlive
 * the process that enqueued them.
 *
 * Every test uses its own queue name, so a worker running against the same
 * instance cannot eat the test's jobs or the reverse.
 */

const REDIS_URL = process.env.TEST_REDIS_URL;
const describeRedis = REDIS_URL ? describe : describe.skip;

describe('toJobId', () => {
  it('produces an id BullMQ will accept', () => {
    // A colon is rejected outright by BullMQ, and our keys are full of them:
    // ISO timestamps alone contribute three.
    const id = toJobId('travel-watch.refresh', 'travel-watch.refresh:w1:2026-09-19T12:00:00.000Z');

    expect(id).not.toContain(':');
    expect(id.startsWith('travel-watch.refresh-')).toBe(true);
  });

  it('is stable, and different for different keys', () => {
    expect(toJobId('travel-watch.refresh', 'a')).toBe(toJobId('travel-watch.refresh', 'a'));
    expect(toJobId('travel-watch.refresh', 'a')).not.toBe(toJobId('travel-watch.refresh', 'b'));
  });

  it('keeps the job name readable for anyone inspecting Redis', () => {
    expect(toJobId('deal.detect', 'x')).toContain('deal.detect');
  });
});

describeRedis('BullMqQueueDriver against Redis', () => {
  const queueName = `voyagr-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let driver: QueueDriver;

  beforeAll(() => {
    driver = new BullMqQueueDriver(REDIS_URL!, { queueName, concurrency: 2 });
  });

  // Each run uses a fresh queue name, so without this Redis would slowly fill
  // with the leftovers of every test run anyone has ever done.
  afterAll(async () => {
    await (driver as BullMqQueueDriver).obliterate();
    await driver.stop();
  });

  it('round-trips a job through Redis to a handler', async () => {
    const seen: Job[] = [];
    driver.register('travel-watch.refresh', async (job) => {
      seen.push(job);
    });

    await driver.start();
    await driver.enqueue('travel-watch.refresh', { watchId: 'w1', reason: 'scheduled' });
    await driver.drain();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe('travel-watch.refresh');
    expect(seen[0]?.payload).toEqual({ watchId: 'w1', reason: 'scheduled' });
    expect(seen[0]?.attempt).toBe(1);
  });

  it('deduplicates by key while the first is still pending', async () => {
    // The property that stops a slow sweep overlapping the next tick from
    // doubling every provider call.
    const isolated = new BullMqQueueDriver(REDIS_URL!, { queueName: `${queueName}-dedupe` });

    try {
      const first = await isolated.enqueue(
        'travel-watch.refresh',
        { watchId: 'w2', reason: 'scheduled' },
        { dedupeKey: 'travel-watch.refresh:w2:2026-09-19T12:00:00.000Z' },
      );
      const second = await isolated.enqueue(
        'travel-watch.refresh',
        { watchId: 'w2', reason: 'scheduled' },
        { dedupeKey: 'travel-watch.refresh:w2:2026-09-19T12:00:00.000Z' },
      );

      expect(second).toBe(first);
      expect((await isolated.stats()).pending).toBe(1);
    } finally {
      await isolated.obliterate();
      await isolated.stop();
    }
  });

  it('keeps a job across a driver restart', async () => {
    // The Phase 1.6 requirement: work survives the process that enqueued it.
    const name = `${queueName}-restart`;
    const producer = new BullMqQueueDriver(REDIS_URL!, { queueName: name });

    await producer.enqueue('travel-watch.refresh', { watchId: 'w3', reason: 'scheduled' });
    expect((await producer.stats()).pending).toBe(1);
    await producer.stop();

    // A different driver instance, as a restarted process would be.
    const consumer = new BullMqQueueDriver(REDIS_URL!, { queueName: name });
    const seen: string[] = [];

    consumer.register('travel-watch.refresh', async (job) => {
      seen.push(job.payload.watchId);
    });

    try {
      await consumer.start();
      await consumer.drain();
      expect(seen).toEqual(['w3']);
    } finally {
      await consumer.obliterate();
      await consumer.stop();
    }
  });

  it('holds a delayed job back until its delay has passed', async () => {
    const isolated = new BullMqQueueDriver(REDIS_URL!, { queueName: `${queueName}-delay` });

    try {
      await isolated.enqueue(
        'travel-watch.refresh',
        { watchId: 'w4', reason: 'scheduled' },
        { delayMs: 60_000 },
      );

      const stats = await isolated.stats();
      // Delayed is pending: queued and certain to run, just not yet.
      expect(stats.pending).toBe(1);
      expect(stats.active).toBe(0);
    } finally {
      await isolated.obliterate();
      await isolated.stop();
    }
  });
});
