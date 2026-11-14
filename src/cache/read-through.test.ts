import { describe, expect, it, vi } from 'vitest';
import { MemoryCacheStore } from './memory';
import { readThrough } from './read-through';
import type { CacheStore } from './types';

/**
 * Stale-while-revalidate.
 *
 * What is defended: a fresh entry costs no load; a stale one is served at once
 * and refreshed exactly once however many readers arrive; a failing source
 * serves what there is and never throws; and an undated entry stays `unknown`.
 */

const FRESH = 10 * 60_000;
const STALE = 50 * 60_000;

function clock(start = Date.parse('2026-11-14T12:00:00.000Z')) {
  let at = start;
  return {
    now: () => at,
    advance(ms: number) {
      at += ms;
    },
  };
}

function setup() {
  const time = clock();
  const store = new MemoryCacheStore({ now: time.now });
  const options = (load: () => Promise<string>) => ({
    freshMs: FRESH,
    staleMs: STALE,
    load,
    now: time.now,
  });

  return { time, store, options };
}

describe('readThrough', () => {
  it('loads and stores on a miss, and reports it as fresh and dated', async () => {
    const { store, options } = setup();
    const load = vi.fn(async () => 'v1');

    const result = await readThrough(store, 'k', options(load));

    expect(result).toMatchObject({ value: 'v1', status: 'miss', freshness: 'fresh', ageMs: 0 });
    expect(result.observedAt).toBe('2026-11-14T12:00:00.000Z');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh entry without loading', async () => {
    const { time, store, options } = setup();
    const load = vi.fn(async () => 'v1');
    await readThrough(store, 'k', options(load));

    // The last instant it is still fresh.
    time.advance(FRESH);
    const result = await readThrough(store, 'k', options(load));

    expect(result).toMatchObject({ value: 'v1', status: 'fresh', ageMs: FRESH });
    expect(result.refresh).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves a stale entry immediately and refreshes in the background', async () => {
    const { time, store, options } = setup();
    await readThrough(
      store,
      'k',
      options(async () => 'v1'),
    );

    // One millisecond past fresh.
    time.advance(FRESH + 1);
    const load = vi.fn(async () => 'v2');
    const stale = await readThrough(store, 'k', options(load));

    expect(stale).toMatchObject({ value: 'v1', status: 'stale', freshness: 'stale' });
    await stale.refresh;
    expect(load).toHaveBeenCalledTimes(1);

    const next = await readThrough(store, 'k', options(load));
    expect(next).toMatchObject({ value: 'v2', status: 'fresh' });
  });

  it('starts one refresh however many readers hit the stale entry', async () => {
    const { time, store, options } = setup();
    await readThrough(
      store,
      'k',
      options(async () => 'v1'),
    );
    time.advance(FRESH + 1);

    let release!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const readers = await Promise.all([
      readThrough(store, 'k', options(load)),
      readThrough(store, 'k', options(load)),
      readThrough(store, 'k', options(load)),
    ]);

    expect(readers.map((reader) => reader.value)).toEqual(['v1', 'v1', 'v1']);
    release('v2');
    await Promise.all(readers.map((reader) => reader.refresh));

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent misses', async () => {
    const { store, options } = setup();
    const load = vi.fn(async () => 'v1');

    await Promise.all([
      readThrough(store, 'k', options(load)),
      readThrough(store, 'k', options(load)),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the stale value, reports the error, and does not throw when the refresh fails', async () => {
    const { time, store, options } = setup();
    await readThrough(
      store,
      'k',
      options(async () => 'v1'),
    );
    time.advance(FRESH + 1);

    const failing = vi.fn(async () => {
      throw new Error('provider down');
    });
    const result = await readThrough(store, 'k', options(failing));
    await result.refresh;

    expect(result.value).toBe('v1');
    // The old entry survives the failed refresh.
    expect((await readThrough(store, 'k', options(failing))).value).toBe('v1');
  });

  it('with an entry past its stale window and the source down, serves it labelled stale', async () => {
    const { time, store, options } = setup();
    // A store that outlives the window, as a Redis with a long TTL might.
    await store.set('k', 'v1', { ttlMs: 10 * (FRESH + STALE) });
    time.advance(FRESH + STALE + 1);

    const result = await readThrough(
      store,
      'k',
      options(async () => {
        throw new Error('provider down');
      }),
    );

    expect(result).toMatchObject({ value: 'v1', status: 'stale', freshness: 'stale' });
    expect(result.error).toBeInstanceOf(Error);
  });

  it('returns a null value and the error, rather than throwing, with nothing to serve', async () => {
    const { store, options } = setup();

    const result = await readThrough(
      store,
      'k',
      options(async () => {
        throw new Error('provider down');
      }),
    );

    expect(result).toMatchObject({ value: null, status: 'failed', freshness: 'unknown' });
    expect(result.observedAt).toBeNull();
    expect(result.ageMs).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('does not keep a failure: the next read tries again', async () => {
    const { store, options } = setup();
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce('v1');

    await readThrough(store, 'k', options(load));
    const second = await readThrough(store, 'k', options(load));

    expect(second.value).toBe('v1');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('with no stale window, loads again the moment the entry stops being fresh', async () => {
    const { time, store } = setup();
    const load = vi.fn(async () => 'v');
    const options = { freshMs: FRESH, staleMs: 0, load, now: time.now };

    await readThrough(store, 'k', options);
    time.advance(FRESH + 1);
    const result = await readThrough(store, 'k', options);

    expect(result.status).toBe('miss');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps an undated entry unknown: served and refreshed, never fresh or stale', async () => {
    const { time, options } = setup();
    const undated: CacheStore = {
      name: 'memory',
      get: async <T>() => ({ value: 'old' as T, observedAt: 'not a date' }),
      set: async <T>(_key: string, value: T) => ({ value, observedAt: '2026-11-14T12:00:00.000Z' }),
    };
    const load = vi.fn(async () => 'new');

    const result = await readThrough(undated, 'k', options(load));
    await result.refresh;

    expect(result).toMatchObject({ value: 'old', status: 'stale', freshness: 'unknown' });
    expect(result.ageMs).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(time.now()).toBeGreaterThan(0);
  });

  it('treats a store that throws as a miss and still returns the loaded value', async () => {
    const { options } = setup();
    const broken: CacheStore = {
      name: 'redis',
      get: async () => {
        throw new Error('connection refused');
      },
      set: async () => {
        throw new Error('connection refused');
      },
    };

    const result = await readThrough(
      broken,
      'k',
      options(async () => 'v1'),
    );

    expect(result).toMatchObject({ value: 'v1', status: 'miss' });
    expect(result.observedAt).toBe('2026-11-14T12:00:00.000Z');
  });
});
