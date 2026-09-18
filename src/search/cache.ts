import { getLogger } from '@/lib/logger';
import type { SearchOutcome, SearchRequest } from './types';

/**
 * Short-lived search result cache.
 *
 * A search is expensive and a page is reloaded, shared, opened in a second tab
 * and returned to with the back button. Against in-process mocks re-running it
 * costs nothing; against a live provider it costs money and quota on every one
 * of those, so the seam belongs here rather than being retrofitted in a hurry
 * during 1.11.
 *
 * Three deliberate properties:
 *
 *  - **Opt-in at the call site.** `runSearch` is not wrapped. A Travel Watch
 *    refresh in 1.6 exists precisely to find out whether the price changed, and
 *    a refresh served from cache would be a monitoring loop that monitors its
 *    own memory. Only the page uses this.
 *  - **Identical concurrent searches share one run.** Two tabs opened at once
 *    on the same query is one provider call, not two.
 *  - **The age is returned, not hidden.** A cached price is a price observed
 *    some time ago, and the page says so rather than presenting it as fresh.
 *
 * In-process and therefore per-instance: two servers keep two caches. That is
 * acceptable for a short TTL and is the thing Redis replaces when 1.6 brings it.
 */

const log = getLogger('search.cache');

/**
 * How long a result may be reused.
 *
 * Short on purpose. The cache exists to absorb reloads and duplicate tabs, not
 * to keep yesterday's prices alive: a stale fare shown as current is the exact
 * dishonesty the cost engine's confidence tags exist to prevent.
 */
export const DEFAULT_SEARCH_TTL_MS = 5 * 60 * 1000;

/** Bounded so a burst of distinct searches cannot grow without limit. */
export const DEFAULT_MAX_ENTRIES = 25;

export interface SearchCacheOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  /** Injectable so a test can age an entry without waiting. */
  readonly now?: () => number;
}

export interface CachedSearch {
  readonly outcome: SearchOutcome;
  /** True when this came from the cache rather than from a fresh run. */
  readonly hit: boolean;
  /** How long ago the result was computed, in milliseconds. */
  readonly ageMs: number;
}

interface Entry {
  readonly promise: Promise<SearchOutcome>;
  readonly storedAt: number;
}

/**
 * A stable string for a request.
 *
 * Key order in an object literal is not guaranteed to match across call sites,
 * so keys are sorted rather than trusted. Everything that can change the result
 * is included - profile, destinations, limits - and `Money` serialises as its
 * minor units and currency, never as a formatted string.
 */
export function searchCacheKey(request: SearchRequest): string {
  return stableStringify(request);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

  return `{${entries.join(',')}}`;
}

export class SearchCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: SearchCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SEARCH_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Return a cached result for `request`, or run and remember one.
   *
   * A rejected run is never cached: the entry is dropped so the next attempt
   * tries again rather than replaying a failure for the rest of the TTL.
   */
  async run(request: SearchRequest, run: () => Promise<SearchOutcome>): Promise<CachedSearch> {
    const key = searchCacheKey(request);
    const existing = this.entries.get(key);
    const startedAt = this.now();

    if (existing && startedAt - existing.storedAt < this.ttlMs) {
      // Refresh recency so a busy query is not evicted by a one-off one.
      this.entries.delete(key);
      this.entries.set(key, existing);

      return {
        outcome: await existing.promise,
        hit: true,
        ageMs: this.now() - existing.storedAt,
      };
    }

    const promise = run();
    this.entries.set(key, { promise, storedAt: startedAt });
    this.evictOverflow();

    try {
      const outcome = await promise;
      return { outcome, hit: false, ageMs: 0 };
    } catch (error) {
      // Only drop the entry if it is still ours; a later run may have replaced it.
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
      log.debug({ evicted: true }, 'search cache evicted its least recently used entry');
    }
  }
}

let shared: SearchCache | undefined;

/** The process-wide cache used by the search page. */
export function getSearchCache(): SearchCache {
  shared ??= new SearchCache();
  return shared;
}

/** Test helper - drops the shared instance. */
export function resetSearchCache(): void {
  shared = undefined;
}
