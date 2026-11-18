import { buildDiscoveryQuery, type DiscoveryInput } from '@/discovery/snapshot';
import { getLogger } from '@/lib/logger';
import { getQueue } from '@/queue';
import type { QueueDriver } from '@/queue/types';
import { refreshDedupeKey } from './refresh';
import { buildCacheTargets } from './targets';

/**
 * How a page view asks for fresh prices without making them.
 *
 * A page that finds yesterday's entry, or nothing, enqueues the same
 * `cache.refresh` job the worker's own schedule does - same job, same dedupe
 * key - and moves on. The worker's limiter pool then spends the provider quota,
 * in one place, rather than one visitor spending it in the request.
 */

const log = getLogger('cache.request-refresh');

/** The target a page's input is the same question as, or the default profile's. */
export function targetIdFor(input: DiscoveryInput): string {
  // Compared as the query they would run, which is what decides the cache key.
  const wanted = JSON.stringify(buildDiscoveryQuery(input));

  const match = buildCacheTargets().find(
    (target) => JSON.stringify(buildDiscoveryQuery(target.input(input.today))) === wanted,
  );

  // A visitor with settings no target covers is shown the default profile's
  // prices, so that is the entry to keep fresh on their behalf.
  return match?.id ?? 'recommended';
}

/** Requests within this window share one job; a later one is a new job, not an ignored duplicate. */
const REQUEST_DEDUPE_WINDOW_MS = 15 * 60_000;

/** Never throws: asking for a refresh must not be able to fail a page. */
export async function requestCacheRefresh(
  input: DiscoveryInput,
  queue?: Pick<QueueDriver, 'enqueue'>,
  now: () => number = Date.now,
): Promise<void> {
  const targetId = targetIdFor(input);

  try {
    // Resolved inside the try: a web process with a misconfigured queue must
    // still render the page.
    await (queue ?? getQueue()).enqueue(
      'cache.refresh',
      { targetId },
      { dedupeKey: refreshDedupeKey(targetId, now(), REQUEST_DEDUPE_WINDOW_MS) },
    );
  } catch (error) {
    log.warn({ err: error, targetId }, 'could not ask the worker for a refresh');
  }
}
