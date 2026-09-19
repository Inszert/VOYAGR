import { getLogger } from '@/lib/logger';
import type { QueueDriver } from '@/queue/types';
import type { Repositories } from '@/db/repository';

/**
 * The scheduler (implementation plan 1.6).
 *
 * Finds watches whose deadline has passed and enqueues a refresh for each. That
 * is all it does: it decides *what* is due, never *what to do about it*, so the
 * decision and the work can fail, retry and scale independently.
 *
 * Runs on a timer rather than as a durable repeating job, so that the schedule
 * lives in the database rather than in Redis. A watch's `nextRunAt` is the only
 * source of truth for when it runs, which is what lets the schedule survive a
 * worker restart, a Redis flush, or being moved to a different machine.
 */

const log = getLogger('watches.scheduler');

/** How many due watches one sweep will enqueue. */
export const DEFAULT_SCHEDULE_BATCH = 50;

export interface SchedulerDependencies {
  readonly repositories: Repositories;
  readonly queue: QueueDriver;
  readonly now?: () => number;
}

export interface SweepResult {
  readonly due: number;
  readonly enqueued: number;
}

/**
 * The deduplication key for a refresh.
 *
 * Includes the deadline the refresh was scheduled for, not just the watch id.
 * Keying on the id alone would mean a watch that has already run and been
 * rescheduled could not be enqueued again until its old job was cleaned up;
 * keying on the deadline means "this watch, for this due time" is enqueued at
 * most once, which is exactly the duplicate worth preventing.
 */
export function refreshDedupeKey(watchId: string, nextRunAt: string): string {
  return `travel-watch.refresh:${watchId}:${nextRunAt}`;
}

/**
 * Enqueue a refresh for every watch that is due.
 *
 * Returns what it found and what it enqueued, so a caller can tell "nothing was
 * due" from "everything was already queued" without reading the logs.
 */
export async function sweepDueWatches(
  dependencies: SchedulerDependencies,
  limit: number = DEFAULT_SCHEDULE_BATCH,
): Promise<SweepResult> {
  const now = dependencies.now ?? Date.now;
  const at = new Date(now()).toISOString();

  const due = await dependencies.repositories.travelWatches.listDue(at, limit);
  let enqueued = 0;

  for (const watch of due) {
    await dependencies.queue.enqueue(
      'travel-watch.refresh',
      { watchId: watch.id, reason: 'scheduled' },
      { dedupeKey: refreshDedupeKey(watch.id, watch.nextRunAt) },
    );

    enqueued += 1;
  }

  if (due.length > 0) {
    log.info({ due: due.length, enqueued, at }, 'enqueued due travel watches');
  }

  return { due: due.length, enqueued };
}

export interface SchedulerHandle {
  /** Stop sweeping. Safe to call more than once. */
  stop(): void;
}

/**
 * Sweep on an interval until stopped.
 *
 * The interval is how often we *look*, not how often a watch runs - that is the
 * watch's own `nextRunAt`. Looking every minute and finding nothing costs one
 * indexed query.
 */
export function startScheduler(
  dependencies: SchedulerDependencies,
  options: { intervalMs?: number; batch?: number } = {},
): SchedulerHandle {
  const intervalMs = options.intervalMs ?? 60_000;
  let stopped = false;

  const timer = setInterval(() => {
    void sweepDueWatches(dependencies, options.batch).catch((error: unknown) => {
      // A failed sweep must not kill the timer: the next one may well succeed,
      // and a scheduler that stops after one bad query is worse than useless
      // because nothing announces it.
      log.error({ err: error }, 'scheduler sweep failed');
    });
  }, intervalMs);

  // Do not hold the process open purely to sweep.
  timer.unref?.();

  log.info({ intervalMs }, 'scheduler started');

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      log.info('scheduler stopped');
    },
  };
}
