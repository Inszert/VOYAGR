import { describe, expect, it, vi } from 'vitest';
import { MemoryQueueDriver } from './memory';

describe('MemoryQueueDriver', () => {
  it('runs a registered handler with its payload', async () => {
    const queue = new MemoryQueueDriver();
    const received: unknown[] = [];

    queue.register('travel-watch.refresh', async (job) => {
      received.push(job.payload);
    });

    await queue.enqueue('travel-watch.refresh', { watchId: 'w1', reason: 'manual' });
    await queue.drain();

    expect(received).toEqual([{ watchId: 'w1', reason: 'manual' }]);
  });

  it('drops a job with no handler instead of hanging', async () => {
    const queue = new MemoryQueueDriver();

    await queue.enqueue('travel-watch.refresh', { watchId: 'w1', reason: 'manual' });
    await queue.drain();

    expect((await queue.stats()).failed).toBe(1);
  });

  it('retries a failing job up to its attempt limit', async () => {
    const queue = new MemoryQueueDriver();
    let attempts = 0;

    queue.register('deal.detect', async () => {
      attempts += 1;
      throw new Error('provider unavailable');
    });

    await queue.enqueue('deal.detect', { watchId: 'w1', candidateId: 'c1' }, { attempts: 3 });

    // Each retry is delayed by backoff, so the queue is drained repeatedly with
    // the clock advanced rather than by sleeping.
    vi.useFakeTimers();
    try {
      for (let pass = 0; pass < 3; pass += 1) {
        await queue.drain();
        await vi.advanceTimersByTimeAsync(60_000);
      }
    } finally {
      vi.useRealTimers();
    }

    expect(attempts).toBe(3);
    expect((await queue.stats()).failed).toBe(1);
  });

  it('succeeds on a retry after a transient failure', async () => {
    const queue = new MemoryQueueDriver();
    let attempts = 0;

    queue.register('deal.detect', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
    });

    await queue.enqueue('deal.detect', { watchId: 'w1', candidateId: 'c1' });

    vi.useFakeTimers();
    try {
      await queue.drain();
      await vi.advanceTimersByTimeAsync(1000);
      await queue.drain();
    } finally {
      vi.useRealTimers();
    }

    expect(attempts).toBe(2);
    expect((await queue.stats()).completed).toBe(1);
  });

  it('suppresses a duplicate job while one is pending', async () => {
    // A user hammering "refresh" must not queue five provider searches.
    const queue = new MemoryQueueDriver();
    const handler = vi.fn(async () => {});

    queue.register('travel-watch.refresh', handler);

    const options = { dedupeKey: 'watch:w1' };
    await queue.enqueue('travel-watch.refresh', { watchId: 'w1', reason: 'manual' }, options);
    await queue.enqueue('travel-watch.refresh', { watchId: 'w1', reason: 'manual' }, options);
    await queue.enqueue('travel-watch.refresh', { watchId: 'w1', reason: 'manual' }, options);

    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allows the same key again once the first job completed', async () => {
    const queue = new MemoryQueueDriver();
    const handler = vi.fn(async () => {});

    queue.register('travel-watch.refresh', handler);

    await queue.enqueue(
      'travel-watch.refresh',
      { watchId: 'w1', reason: 'manual' },
      { dedupeKey: 'k' },
    );
    await queue.drain();
    await queue.enqueue(
      'travel-watch.refresh',
      { watchId: 'w1', reason: 'manual' },
      { dedupeKey: 'k' },
    );
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not run a delayed job before its time', async () => {
    const queue = new MemoryQueueDriver();
    const handler = vi.fn(async () => {});

    queue.register('provider.health-check', handler);
    await queue.enqueue('provider.health-check', {}, { delayMs: 60_000 });

    await queue.drain();
    expect(handler).not.toHaveBeenCalled();

    expect((await queue.stats()).pending).toBe(1);
  });

  it('reports accurate stats', async () => {
    const queue = new MemoryQueueDriver();

    queue.register('travel-watch.refresh', async () => {});
    queue.register('deal.detect', async () => {
      throw new Error('always fails');
    });

    await queue.enqueue('travel-watch.refresh', { watchId: 'w1', reason: 'manual' });
    await queue.enqueue('deal.detect', { watchId: 'w1', candidateId: 'c1' }, { attempts: 1 });
    await queue.drain();

    const stats = await queue.stats();
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('stops cleanly', async () => {
    const queue = new MemoryQueueDriver();

    await queue.start();
    await queue.start(); // idempotent
    await queue.stop();

    expect((await queue.stats()).active).toBe(0);
  });
});
