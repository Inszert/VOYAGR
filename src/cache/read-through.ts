import { ageOf, freshnessOf, type Freshness } from '@/core/freshness';
import type { IsoDateTime } from '@/core/trip/types';
import { getLogger } from '@/lib/logger';
import type { CacheEntry, CacheStore } from './types';

/**
 * Stale-while-revalidate over a `CacheStore`.
 *
 *  - **Fresh** (younger than `freshMs`): returned, nothing else happens.
 *  - **Stale** (older, but within `staleMs` more): returned immediately, and ONE
 *    background refresh is started however many readers arrive meanwhile. The
 *    next reader gets the new value.
 *  - **Missing** (or older than both): loaded, stored and returned.
 *
 * **A failing source degrades, never throws.** If the load fails and there is
 * any entry left to show it is served, still labelled stale, with the error
 * reported on the result. With nothing to show the result has a null value and
 * the error, and the caller decides what that means.
 *
 * **The age is returned, not hidden.** `observedAt` is the instant the value
 * was loaded and `freshness` reads it through `src/core/freshness.ts`, so
 * `unknown` stays its own case: an entry that cannot be dated is served and
 * refreshed, but never reported as fresh or as stale.
 */

const log = getLogger('cache.read-through');

export interface ReadThroughOptions<T> {
  /** How long a value is served with no refresh. */
  readonly freshMs: number;
  /** How much longer it may be served while a refresh runs. Zero for none. */
  readonly staleMs: number;
  readonly load: () => Promise<T>;
  /** Injectable so a test can age an entry without waiting. */
  readonly now?: () => number;
}

export interface ReadThroughResult<T> {
  /** Null only when nothing could be loaded and nothing was cached. */
  readonly value: T | null;
  readonly observedAt: IsoDateTime | null;
  /** Milliseconds since `observedAt`, or null when it is not dated. */
  readonly ageMs: number | null;
  readonly freshness: Freshness;
  readonly status: 'fresh' | 'stale' | 'miss' | 'failed';
  /** Why the load failed, when it did. A stale value may accompany it. */
  readonly error: unknown;
  /**
   * The background refresh this read started, if it started one. It never
   * rejects. Pages do not await it; tests and the worker may.
   */
  readonly refresh: Promise<void> | null;
}

/** In-flight loads, per store and key, so concurrent readers share one. */
const inflight = new WeakMap<CacheStore, Map<string, Promise<CacheEntry<unknown>>>>();

function shared<T>(
  store: CacheStore,
  key: string,
  start: () => Promise<CacheEntry<T>>,
): Promise<CacheEntry<T>> {
  let loads = inflight.get(store);
  if (!loads) {
    loads = new Map();
    inflight.set(store, loads);
  }

  const existing = loads.get(key);
  if (existing) return existing as Promise<CacheEntry<T>>;

  const running = start().finally(() => loads.delete(key));
  loads.set(key, running);

  return running;
}

async function safeGet<T>(store: CacheStore, key: string): Promise<CacheEntry<T> | null> {
  try {
    return await store.get<T>(key);
  } catch (error) {
    log.warn({ err: error, key }, 'cache read failed; treating as a miss');
    return null;
  }
}

/**
 * Load fresh and store, sharing one load per key.
 *
 * Exported for the worker, which wants the refresh without the freshness
 * question: it exists to replace a value before anyone has to ask.
 */
export function loadAndStore<T>(
  store: CacheStore,
  key: string,
  options: Pick<ReadThroughOptions<T>, 'freshMs' | 'staleMs' | 'load' | 'now'>,
): Promise<CacheEntry<T>> {
  return shared(store, key, async () => {
    const value = await options.load();
    const now = options.now ?? Date.now;

    try {
      return await store.set(key, value, {
        ttlMs: Math.max(1, options.freshMs + options.staleMs),
      });
    } catch (error) {
      // The value was loaded; failing to remember it is not failing to have it.
      log.warn({ err: error, key }, 'cache write failed; serving the loaded value');
      return { value, observedAt: new Date(now()).toISOString() };
    }
  });
}

export async function readThrough<T>(
  store: CacheStore,
  key: string,
  options: ReadThroughOptions<T>,
): Promise<ReadThroughResult<T>> {
  const now = options.now ?? Date.now;
  const entry = await safeGet<T>(store, key);

  const describe = (
    found: CacheEntry<T> | null,
    status: ReadThroughResult<T>['status'],
    extra: { error?: unknown; refresh?: Promise<void> | null } = {},
  ): ReadThroughResult<T> => {
    const at = now();

    return {
      value: found?.value ?? null,
      observedAt: found?.observedAt ?? null,
      ageMs: ageOf(found?.observedAt, at),
      freshness: freshnessOf(found?.observedAt, at, { maxAgeMs: options.freshMs }),
      status,
      error: extra.error ?? null,
      refresh: extra.refresh ?? null,
    };
  };

  if (entry) {
    const freshness = freshnessOf(entry.observedAt, now(), { maxAgeMs: options.freshMs });

    if (freshness === 'fresh') return describe(entry, 'fresh');

    const age = ageOf(entry.observedAt, now());
    const servable =
      freshness === 'unknown' || (age !== null && age <= options.freshMs + options.staleMs);

    if (servable) {
      const refresh = loadAndStore(store, key, options).then(
        () => undefined,
        (error: unknown) => {
          log.warn({ err: error, key }, 'background refresh failed; the stale value stays');
        },
      );

      return describe(entry, 'stale', { refresh });
    }
  }

  try {
    return describe(await loadAndStore(store, key, options), 'miss');
  } catch (error) {
    log.warn({ err: error, key }, 'load failed');

    // Past its stale window an entry is no longer trusted to refresh, but it is
    // still better than nothing when the source is down - labelled as it is.
    return describe(entry, entry ? 'stale' : 'failed', { error });
  }
}
