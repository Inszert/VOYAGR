import type { IsoDateTime } from '@/core/trip/types';

/**
 * The shared cache contract.
 *
 * A cache entry is an observation, not just a value: `observedAt` is the
 * instant the value was loaded from its source, and everything downstream -
 * whether to refresh, what the page says about its age - reads that rather than
 * guessing from when it happened to be fetched. `src/core/freshness.ts` owns
 * what the age means.
 *
 * Keys are `voyagr:v1:<kind>:<hash of query key>` - see `key.ts`.
 */

export interface CacheEntry<T> {
  readonly value: T;
  /** When the value was loaded, as an instant in UTC. */
  readonly observedAt: IsoDateTime;
}

export interface CacheSetOptions {
  /**
   * How long the store may keep the entry at all, in milliseconds.
   *
   * This is the *physical* lifetime, which is longer than the time an entry is
   * fresh: `readThrough` keeps an entry past its fresh window so it can serve it
   * while a refresh runs.
   */
  readonly ttlMs: number;
}

export interface CacheStore {
  readonly name: 'memory' | 'redis' | 'postgres';

  /** The entry, or null when there is none. A broken backend is a miss, not a throw. */
  get<T>(key: string): Promise<CacheEntry<T> | null>;

  /** Store a value, stamping `observedAt` from the store's clock. */
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<CacheEntry<T>>;
}
