import type { IsoDate } from '@/core/trip/types';
import type { DiscoverySource } from '@/discovery/snapshot';
import { getDiscoverySource } from '@/discovery/snapshot';
import { getLogger } from '@/lib/logger';
import type { Job, QueueDriver } from '@/queue/types';
import { buildCacheTargets, findCacheTarget, type CacheTarget } from './targets';

/**
 * The `cache.refresh` job: re-price one target and store the result.
 *
 * Pages read what this writes. Between them the provider is called on the
 * worker's schedule rather than per request, which is what keeps one popular
 * page from becoming a rate-limit outage.
 */

const log = getLogger('cache.refresh');

const MINUTE = 60_000;

export interface CacheRefreshDependencies {
  /** Injectable so a test can refresh without reaching a provider. */
  readonly discovery?: Pick<DiscoverySource, 'refresh'>;
  /** The clock, for the date window. Never read inside the targets. */
  readonly now?: () => number;
}

/** Today as `YYYY-MM-DD` from an instant. The one place the worker turns a clock into a date. */
function todayOf(now: number): IsoDate {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Refresh one target. A failed refresh throws, so the queue retries with
 * backoff - and the entry it was meant to replace keeps being served meanwhile.
 * An unknown target does not: retrying a name nobody defines only delays the log.
 */
export function createCacheRefreshHandler(dependencies: CacheRefreshDependencies = {}) {
  const now = dependencies.now ?? Date.now;

  return async (job: Job<'cache.refresh'>): Promise<void> => {
    const target = findCacheTarget(job.payload.targetId);

    if (!target) {
      log.error({ targetId: job.payload.targetId }, 'unknown cache target; dropping the job');
      return;
    }

    const discovery = dependencies.discovery ?? getDiscoverySource();
    const refreshed = await discovery.refresh({ ...target.input(todayOf(now())), source: 'api' });

    log.info({ targetId: target.id, refreshed }, 'cache target refreshed');
  };
}

export interface CacheRefreshScheduler {
  stop(): void;
}

/**
 * Enqueue every target, spread across the interval.
 *
 * Staggered rather than fired together: the targets' limiters are per search,
 * so nine searches started at once would present the vendor with nine times the
 * per-operation allowance in the same second. Spacing them by `interval /
 * targets` keeps the burst to one search's worth. The dedupe key means a round
 * that is still queued when the next arrives is not doubled up.
 */
export async function enqueueCacheRefresh(
  queue: Pick<QueueDriver, 'enqueue'>,
  intervalMinutes: number,
  targets: readonly CacheTarget[] = buildCacheTargets(),
): Promise<number> {
  const spacingMs = Math.floor((intervalMinutes * MINUTE) / Math.max(1, targets.length));

  await Promise.all(
    targets.map((target, index) =>
      queue.enqueue(
        'cache.refresh',
        { targetId: target.id },
        { delayMs: index * spacingMs, dedupeKey: `cache.refresh:${target.id}` },
      ),
    ),
  );

  return targets.length;
}

export function startCacheRefresh(
  queue: Pick<QueueDriver, 'enqueue'>,
  intervalMinutes: number,
  options: { runOnStart?: boolean } = {},
): CacheRefreshScheduler {
  const round = () =>
    enqueueCacheRefresh(queue, intervalMinutes).catch((error: unknown) => {
      log.error({ err: error }, 'could not enqueue the cache refresh round');
    });

  const timer = setInterval(() => void round(), intervalMinutes * MINUTE);
  timer.unref?.();

  // A restart should not leave the front page cold for a whole interval.
  if (options.runOnStart !== false) void round();

  log.info({ intervalMinutes }, 'cache refresh scheduled');

  return { stop: () => clearInterval(timer) };
}
