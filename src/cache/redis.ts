import { getLogger } from '@/lib/logger';
import type { CacheEntry, CacheSetOptions, CacheStore } from './types';

/**
 * Redis cache store.
 *
 * The shared tier: every web instance and the worker read and write the same
 * entries, so a refresh the worker made is what every page serves.
 *
 * Talks to Redis through the two commands it needs, so a test hands in a fake
 * and the real `ioredis` client is only imported when a connection is wanted -
 * `next build` and the memory-only path never load it.
 *
 * **Redis being down is a cache miss, not an outage.** `get` and `set` swallow
 * the failure and report it, because a page that cannot read its cache should
 * go and load the data, and one that cannot write it should still show what it
 * loaded.
 */

const log = getLogger('cache.redis');

/** The slice of an ioredis client this store uses. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
}

interface Envelope {
  readonly v: unknown;
  readonly o: string;
}

export class RedisCacheStore implements CacheStore {
  readonly name = 'redis' as const;

  private client: Promise<RedisLike> | undefined;

  constructor(
    private readonly connect: () => Promise<RedisLike>,
    private readonly now: () => number = Date.now,
  ) {}

  private connection(): Promise<RedisLike> {
    // Memoised, including a failure's retry: a rejected connect is dropped so
    // the next call tries again rather than replaying the failure forever.
    this.client ??= this.connect().catch((error: unknown) => {
      this.client = undefined;
      throw error;
    });

    return this.client;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const raw = await (await this.connection()).get(key);
      if (raw === null) return null;

      const envelope = JSON.parse(raw) as Envelope;
      if (typeof envelope !== 'object' || envelope === null || typeof envelope.o !== 'string') {
        return null;
      }

      return { value: envelope.v as T, observedAt: envelope.o };
    } catch (error) {
      log.warn({ err: error }, 'cache read failed; treating as a miss');
      return null;
    }
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<CacheEntry<T>> {
    const observedAt = new Date(this.now()).toISOString();
    const envelope: Envelope = { v: value, o: observedAt };

    try {
      await (
        await this.connection()
      ).set(key, JSON.stringify(envelope), 'PX', Math.max(1, Math.ceil(options.ttlMs)));
    } catch (error) {
      log.warn({ err: error }, 'cache write failed; the value is still returned');
    }

    return { value, observedAt };
  }
}

/** The real client, imported on first use. */
export function connectIoRedis(url: string): () => Promise<RedisLike> {
  return async () => {
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(url, {
      // A page waiting on a dead cache is worse than a page that skips it.
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    });

    client.on('error', (error: unknown) => log.warn({ err: error }, 'redis cache client error'));

    return client;
  };
}
