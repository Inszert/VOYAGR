import { pruneRows } from '@/core/cleanup/prune';
import type { IsoDate } from '@/core/trip/types';
import type { Repositories } from '@/db/repository';
import { getLogger } from '@/lib/logger';
import type { Job, JobHandler, QueueDriver } from '@/queue/types';

/**
 * The nightly cleanup: every stored Kiwi lookup that departs before today is deleted, after its
 * route-and-month aggregate has been written, so an alert baseline survives the offers.
 *
 * It never calls a provider and never reads the clock: the day arrives in the payload, from the
 * scheduler. Price observations (`price_observations`) are not touched here: they belong to a
 * watch, carry no departure date, and have their own retention (`PriceHistoryRepository`).
 */

export const NIGHTLY_CLEANUP_JOB = 'cleanup.nightly' as const;

const log = getLogger('jobs.nightly-cleanup');

export interface NightlyCleanupResult {
  readonly deleted: number;
  readonly aggregates: number;
}

export async function runNightlyCleanup(
  repositories: Pick<Repositories, 'kiwiOffers' | 'routeAggregates'>,
  today: IsoDate,
  computedAt: string,
): Promise<NightlyCleanupResult> {
  const rows = await repositories.kiwiOffers.listDepartingBefore(today);
  const { toDelete, aggregates } = pruneRows(rows, today, computedAt);
  if (toDelete.length === 0) return { deleted: 0, aggregates: 0 };

  // Aggregates first: if the delete then fails, the next run recomputes from the same rows and
  // the merge double-counts at worst; losing a baseline would be worse.
  await repositories.routeAggregates.write(aggregates);
  const deleted = await repositories.kiwiOffers.deleteDepartingBefore(today);
  return { deleted, aggregates: aggregates.length };
}

export function createNightlyCleanupHandler(deps: {
  repositories: Pick<Repositories, 'kiwiOffers' | 'routeAggregates'>;
  now?: () => number;
}): JobHandler<typeof NIGHTLY_CLEANUP_JOB> {
  const now = deps.now ?? Date.now;
  return async (job: Job<typeof NIGHTLY_CLEANUP_JOB>) => {
    const result = await runNightlyCleanup(
      deps.repositories,
      job.payload.day,
      new Date(now()).toISOString(),
    );
    log.info({ day: job.payload.day, ...result }, 'nightly cleanup done');
  };
}

export interface NightlyCleanupScheduler {
  check(): Promise<boolean>;
  stop(): void;
}

/**
 * Enqueue the cleanup once per UTC day, from `hourUtc` on. A restart later the same day enqueues
 * again (the deletion is idempotent), but a dedupe key keeps a pending one from doubling.
 */
export function startNightlyCleanupScheduler(
  queue: Pick<QueueDriver, 'enqueue'>,
  options: { hourUtc: number; now?: () => number; checkMs?: number },
): NightlyCleanupScheduler {
  const now = options.now ?? Date.now;
  let lastDay: string | null = null;

  const check = async (): Promise<boolean> => {
    const at = new Date(now());
    const day = at.toISOString().slice(0, 10);
    if (at.getUTCHours() < options.hourUtc || day === lastDay) return false;
    lastDay = day;
    await queue.enqueue(
      NIGHTLY_CLEANUP_JOB,
      { day },
      { attempts: 1, dedupeKey: `${NIGHTLY_CLEANUP_JOB}:${day}` },
    );
    return true;
  };

  const timer = setInterval(() => {
    check().catch((error: unknown) => log.error({ err: error }, 'cleanup scheduling failed'));
  }, options.checkMs ?? 60_000);
  timer.unref();

  return { check, stop: () => clearInterval(timer) };
}
