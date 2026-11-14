import type { CacheEntry, CacheSetOptions, CacheStore } from './types';

/**
 * In-process cache store.
 *
 * What development and CI run on, and what a single-instance deployment gets
 * with no Redis. Per-instance: two servers keep two caches, which is why Redis
 * is the shared tier.
 *
 * Holds the value itself rather than a serialised copy, so a hit costs nothing -
 * which also means a caller must treat what it reads as immutable.
 */

export const DEFAULT_MEMORY_MAX_ENTRIES = 200;

interface Stored {
  readonly value: unknown;
  readonly observedAt: string;
  readonly expiresAt: number;
}

export interface MemoryCacheStoreOptions {
  readonly maxEntries?: number;
  /** Injectable so a test can age an entry without waiting. */
  readonly now?: () => number;
}

export class MemoryCacheStore implements CacheStore {
  readonly name = 'memory' as const;

  private readonly entries = new Map<string, Stored>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MEMORY_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const stored = this.entries.get(key);
    if (!stored) return null;

    if (this.now() >= stored.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    // Recency, so a busy key is not evicted by a one-off one.
    this.entries.delete(key);
    this.entries.set(key, stored);

    return { value: stored.value as T, observedAt: stored.observedAt };
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<CacheEntry<T>> {
    const at = this.now();
    const observedAt = new Date(at).toISOString();

    this.entries.delete(key);
    this.entries.set(key, { value, observedAt, expiresAt: at + options.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }

    return { value, observedAt };
  }
}
