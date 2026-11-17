import { query } from '@/db/client';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { MemoryCacheStore } from './memory';
import { PostgresCacheStore } from './postgres';
import { connectIoRedis, RedisCacheStore } from './redis';
import type { CacheStore } from './types';

/**
 * Cache store factory.
 *
 * Redis when `REDIS_URL` is set; otherwise the database when `DATABASE_URL` is
 * set, so a deployment without Redis still shares results across instances and
 * survives a restart; otherwise the in-process store - so `npm run dev`, `npm
 * test` and CI need nothing. Unlike the queue, a missing backend is not an
 * error: a cache is an optimisation, and the queue's reason for refusing to
 * fall back (losing durable jobs) does not apply.
 */

const log = getLogger('cache.factory');

export function createCacheStore(): CacheStore {
  const { REDIS_URL, DATABASE_URL } = getEnv();

  if (REDIS_URL) return new RedisCacheStore(connectIoRedis(REDIS_URL));
  if (DATABASE_URL) return new PostgresCacheStore(query);

  return new MemoryCacheStore();
}

/**
 * On `globalThis` for the reason `src/search/cache.ts` gives: a silent split
 * into two stores doubles real provider calls with no visible symptom.
 */
declare global {
  var __voyagrCacheStore: CacheStore | undefined;
}

export function getCacheStore(): CacheStore {
  if (!globalThis.__voyagrCacheStore) {
    globalThis.__voyagrCacheStore = createCacheStore();
    log.info({ store: globalThis.__voyagrCacheStore.name }, 'cache store initialised');
  }

  return globalThis.__voyagrCacheStore;
}

/** Test helper - drops the shared instance. */
export function resetCacheStore(): void {
  globalThis.__voyagrCacheStore = undefined;
}

export { cacheKey, CACHE_KEY_VERSION, type CacheKind } from './key';
export {
  loadAndStore,
  readThrough,
  type ReadThroughOptions,
  type ReadThroughResult,
} from './read-through';
export type { CacheEntry, CacheStore } from './types';
