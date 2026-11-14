import { createHash } from 'node:crypto';
import { stableStringify } from '@/search/cache';

/**
 * Cache keys: `voyagr:v1:<kind>:<hash of query key>`.
 *
 * `v1` is the shape of what is stored. Changing the serialised shape of a
 * cached value means bumping it, so a deploy never reads yesterday's shape back
 * out of a Redis that outlived it.
 *
 * The query is hashed rather than embedded: a search request is kilobytes of
 * JSON, and Redis keys are better short. 128 bits of SHA-256 is far beyond any
 * plausible collision across the few thousand live keys.
 */

export const CACHE_KEY_VERSION = 'v1';

export type CacheKind = 'discovery' | 'search' | 'weather' | 'flex';

export function cacheKey(kind: CacheKind, query: unknown): string {
  const hash = createHash('sha256').update(stableStringify(query)).digest('hex').slice(0, 32);

  return `voyagr:${CACHE_KEY_VERSION}:${kind}:${hash}`;
}
