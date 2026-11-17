import { describe, expect, it, vi } from 'vitest';
import type { Job } from '@/queue/types';
import {
  createCacheRefreshHandler,
  enqueueCacheRefresh,
  enqueuePlacesRefresh,
  startCacheRefresh,
} from './refresh';
import {
  PLACES_DESTINATIONS_PER_ROUND,
  buildCacheTargets,
  parsePlacesTargetId,
  placesTargetDestinations,
  placesTargetId,
  refreshCallCeilingPerHour,
} from './targets';

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

describe('places pre-warming', () => {
  const [first, second] = placesTargetDestinations() as [string, string];

  it('warms the named destination with its own name and position', async () => {
    const warm = vi.fn(async () => 'warmed' as const);

    await createCacheRefreshHandler({ places: { warm } })(job(placesTargetId(first)));

    expect(warm).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: first,
        destinationName: expect.any(String),
        position: [expect.any(Number), expect.any(Number)],
      }),
    );
  });

  it('drops a places target that names no known destination', async () => {
    const warm = vi.fn(async () => 'warmed' as const);

    await createCacheRefreshHandler({ places: { warm } })(job('places:ZZZ'));

    expect(warm).not.toHaveBeenCalled();
  });

  it('lets a failed warm throw, so the queue retries it', async () => {
    const handler = createCacheRefreshHandler({
      places: {
        warm: async () => {
          throw new Error('wikidata timed out');
        },
      },
    });

    await expect(handler(job(placesTargetId(first)))).rejects.toThrow('wikidata timed out');
  });

  it('enqueues no more than 40 destinations a round, a minute apart', async () => {
    const enqueue = vi.fn(async () => 'id');
    const destinations = Array.from({ length: 55 }, (_, index) => `D${index}`);

    const count = await enqueuePlacesRefresh(
      { enqueue },
      { destinations, isFresh: async () => false },
    );

    expect(count).toBe(40);
    expect(PLACES_DESTINATIONS_PER_ROUND).toBe(40);
    const options = enqueue.mock.calls.map((call) => (call as unknown[])[2] as { delayMs: number });
    expect(options.map((o) => o.delayMs)).toEqual(
      Array.from({ length: 40 }, (_, index) => index * 60_000),
    );
  });

  it('skips destinations that are still fresh and moves on to the next 40', async () => {
    const enqueue = vi.fn(async () => 'id');
    const fresh = new Set(['D0', 'D1']);

    const count = await enqueuePlacesRefresh(
      { enqueue },
      {
        destinations: ['D0', 'D1', 'D2', 'D3'],
        isFresh: async (destination) => fresh.has(destination),
      },
    );

    expect(count).toBe(2);
    expect(enqueue.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { targetId: 'places:D2' },
      { targetId: 'places:D3' },
    ]);
  });

  it('enqueues nothing when everything is fresh', async () => {
    const enqueue = vi.fn(async () => 'id');

    expect(
      await enqueuePlacesRefresh(
        { enqueue },
        { destinations: [first, second], isFresh: async () => true },
      ),
    ).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('parses only well-formed places ids', () => {
    expect(parsePlacesTargetId(placesTargetId(first))).toBe(first);
    expect(parsePlacesTargetId('places:')).toBeNull();
    expect(parsePlacesTargetId('recommended')).toBeNull();
  });
});

describe('the UTC date roll-over', () => {
  const noPlaces = async () => 0;

  function start(clock: { at: number }) {
    const enqueue = vi.fn(async () => 'id');
    const scheduler = startCacheRefresh({ enqueue }, 30, {
      runOnStart: false,
      now: () => clock.at,
      enqueuePlaces: noPlaces,
    });

    return { enqueue, scheduler };
  }

  it('starts a round the moment the date changes, and only then', async () => {
    const clock = { at: Date.parse('2026-11-14T23:59:30.000Z') };
    const { enqueue, scheduler } = start(clock);

    expect(scheduler.checkRollover()).toBe(false);
    clock.at = Date.parse('2026-11-14T23:59:59.999Z');
    expect(scheduler.checkRollover()).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();

    clock.at = Date.parse('2026-11-15T00:00:00.000Z');
    expect(scheduler.checkRollover()).toBe(true);
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(buildCacheTargets().length));

    // The same day again is not a second round.
    clock.at = Date.parse('2026-11-15T12:00:00.000Z');
    expect(scheduler.checkRollover()).toBe(false);

    scheduler.stop();
  });

  it('starts one round per date change, across a month end', async () => {
    const clock = { at: Date.parse('2026-11-30T23:59:59.000Z') };
    const { enqueue, scheduler } = start(clock);

    clock.at = Date.parse('2026-12-01T00:00:00.000Z');
    expect(scheduler.checkRollover()).toBe(true);
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());

    scheduler.stop();
  });

  it('puts the recommended target first, so the front page is the first thing refilled', async () => {
    const clock = { at: Date.parse('2026-11-14T23:59:59.000Z') };
    const { enqueue, scheduler } = start(clock);

    clock.at = Date.parse('2026-11-15T00:00:00.000Z');
    scheduler.checkRollover();
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalled());

    const [name, payload, options] = enqueue.mock.calls[0] as unknown as [
      string,
      { targetId: string },
      { delayMs: number },
    ];
    expect(name).toBe('cache.refresh');
    expect(payload.targetId).toBe('recommended');
    expect(options.delayMs).toBe(0);

    scheduler.stop();
  });

  it('with the kill switch off schedules no round and makes no call', async () => {
    vi.useFakeTimers();
    try {
      const enqueue = vi.fn(async () => 'id');
      const clock = { at: Date.parse('2026-11-14T23:59:59.000Z') };
      const scheduler = startCacheRefresh({ enqueue }, 30, {
        discoveryEnabled: false,
        now: () => clock.at,
        enqueuePlaces: noPlaces,
      });

      clock.at = Date.parse('2026-11-15T00:00:00.000Z');
      expect(scheduler.checkRollover()).toBe(false);
      await vi.advanceTimersByTimeAsync(24 * 3_600_000);

      expect(enqueue).not.toHaveBeenCalled();
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('with the kill switch on runs the start-up round and the interval round', async () => {
    vi.useFakeTimers();
    try {
      const enqueue = vi.fn(async () => 'id');
      const scheduler = startCacheRefresh({ enqueue }, 30, {
        discoveryEnabled: true,
        now: () => Date.parse('2026-11-15T10:00:00.000Z'),
        enqueuePlaces: noPlaces,
      });
      const perRound = buildCacheTargets().length;

      await vi.advanceTimersByTimeAsync(1);
      expect(enqueue).toHaveBeenCalledTimes(perRound);
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(enqueue).toHaveBeenCalledTimes(perRound * 2);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the places round on start, but only when places are scheduled', async () => {
    const enqueue = vi.fn(async () => 'id');
    const enqueuePlaces = vi.fn(async () => 0);
    const clock = { at: Date.parse('2026-11-15T10:00:00.000Z') };

    const without = startCacheRefresh({ enqueue }, 30, { now: () => clock.at, enqueuePlaces });
    without.stop();
    expect(enqueuePlaces).not.toHaveBeenCalled();

    const withPlaces = startCacheRefresh({ enqueue }, 30, {
      now: () => clock.at,
      enqueuePlaces,
      placesIntervalHours: 168,
    });
    withPlaces.stop();
    expect(enqueuePlaces).toHaveBeenCalledTimes(1);
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
