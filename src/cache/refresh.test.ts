import { describe, expect, it, vi } from 'vitest';
import type { Job } from '@/queue/types';
import { createCacheRefreshHandler, enqueueCacheRefresh } from './refresh';
import { buildCacheTargets, refreshCallCeilingPerHour } from './targets';

const job = (targetId: string): Job<'cache.refresh'> => ({
  id: '1',
  name: 'cache.refresh',
  payload: { targetId },
  attempt: 1,
  enqueuedAt: '2026-11-14T12:00:00.000Z',
});

describe('cache.refresh handler', () => {
  it('refreshes the named target for the clock’s day, against the API source', async () => {
    const refresh = vi.fn(async () => true);
    const handler = createCacheRefreshHandler({
      discovery: { refresh },
      now: () => Date.parse('2026-11-14T23:59:59.000Z'),
    });

    await handler(job('origin:LHR'));

    expect(refresh).toHaveBeenCalledWith({
      today: '2026-11-14',
      defaults: { origins: 'LHR' },
      source: 'api',
    });
  });

  it('drops an unknown target without refreshing or throwing', async () => {
    const refresh = vi.fn(async () => true);

    await createCacheRefreshHandler({ discovery: { refresh } })(job('nope'));

    expect(refresh).not.toHaveBeenCalled();
  });

  it('lets a failed refresh throw, so the queue retries it', async () => {
    const handler = createCacheRefreshHandler({
      discovery: {
        refresh: async () => {
          throw new Error('provider down');
        },
      },
    });

    await expect(handler(job('recommended'))).rejects.toThrow('provider down');
  });
});

describe('enqueueCacheRefresh', () => {
  it('enqueues every target once, deduplicated, spread across the interval', async () => {
    const enqueue = vi.fn(async () => 'id');
    const targets = buildCacheTargets();

    const count = await enqueueCacheRefresh({ enqueue }, 30);

    expect(count).toBe(targets.length);
    expect(enqueue).toHaveBeenCalledTimes(targets.length);

    const delays = enqueue.mock.calls.map((call) => (call as unknown[])[2] as { delayMs: number });
    expect(delays[0]!.delayMs).toBe(0);
    expect(Math.max(...delays.map((options) => options.delayMs))).toBeLessThan(30 * 60_000);
    expect(new Set(delays.map((options) => JSON.stringify(options))).size).toBe(targets.length);
  });
});

describe('cache targets', () => {
  it('have unique ids and cover the recommended, per-origin and themed cases', () => {
    const targets = buildCacheTargets();
    const ids = targets.map((target) => target.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(targets.map((target) => target.kind))).toEqual(
      new Set(['recommended', 'origin', 'collection']),
    );
  });

  it('stay inside the flight vendor’s rate limit at the default interval', () => {
    // 600 calls a minute: `rateLimitPerMinute` in src/providers/flights/aviasales.ts.
    const perHourAllowed = 600 * 60;

    expect(refreshCallCeilingPerHour(buildCacheTargets(), 30)).toBeLessThanOrEqual(perHourAllowed);
  });

  it('scale the ceiling inversely with the interval', () => {
    const targets = buildCacheTargets();

    expect(refreshCallCeilingPerHour(targets, 15)).toBe(2 * refreshCallCeilingPerHour(targets, 30));
  });
});
