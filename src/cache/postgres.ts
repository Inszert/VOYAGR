import type { IsoDateTime } from '@/core/trip/types';
import { getLogger } from '@/lib/logger';
import type { CacheEntry, CacheSetOptions, CacheStore } from './types';

/**
 * Postgres cache store: the database tier.
 *
 * Used when `DATABASE_URL` is set and `REDIS_URL` is not, so a deployment
 * without Redis still shares its search results across instances and survives
 * a restart. Redis, when configured, takes precedence (see `index.ts`).
 *
 * The lifetime is physical, as with every store: `readThrough` decides what is
 * fresh from `observedAt`. An entry past `expires_at` is a miss, and expired
 * rows are removed on each write so the table does not grow without bound.
 *
 * **A broken database is a miss, not an outage**, as with Redis: a page that
 * cannot read its cache loads the data itself, and one that cannot write it
 * still shows what it loaded.
 *
 * Every value goes in as a bound parameter. The cache key is never
 * interpolated into SQL.
 */

const log = getLogger('cache.postgres');

/** The slice of `query` from `src/db/client.ts` this store uses. */
export type CacheQuery = (
  text: string,
  params?: readonly unknown[],
) => Promise<Record<string, unknown>[]>;

export class PostgresCacheStore implements CacheStore {
  readonly name = 'postgres' as const;

  constructor(
    private readonly query: CacheQuery,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const rows = await this.query(
        'SELECT payload, observed_at FROM cache_entries WHERE cache_key = $1 AND expires_at > $2',
        [key, new Date(this.now()).toISOString()],
      );
      const row = rows[0];
      if (!row) return null;

      const observed = row.observed_at;
      const observedAt = observed instanceof Date ? observed.toISOString() : String(observed);

      return { value: row.payload as T, observedAt: observedAt as IsoDateTime };
    } catch (error) {
      log.warn({ err: error }, 'cache read failed; treating as a miss');
      return null;
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<CacheEntry<T>> {
    const nowMs = this.now();
    const observedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + Math.max(1, Math.ceil(options.ttlMs))).toISOString();

    try {
      await this.query(
        `INSERT INTO cache_entries (cache_key, payload, observed_at, expires_at)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (cache_key) DO UPDATE SET
           payload = EXCLUDED.payload,
           observed_at = EXCLUDED.observed_at,
           expires_at = EXCLUDED.expires_at`,
        [key, JSON.stringify(value), observedAt, expiresAt],
      );
      await this.query('DELETE FROM cache_entries WHERE expires_at <= $1', [observedAt]);
    } catch (error) {
      log.warn({ err: error }, 'cache write failed; the value is still returned');
    }

    return { value, observedAt: observedAt as IsoDateTime };
  }
}
