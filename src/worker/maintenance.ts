import { getLogger } from '@/lib/logger';
import type { Repositories } from '@/db/repository';

/**
 * Housekeeping the worker does between refreshes.
 *
 * Two jobs that nothing else was ever going to do: expired sessions and stale
 * price observations. Both grow forever otherwise, and both are the kind of
 * growth nobody notices until a table is large enough to be a problem.
 *
 * Deliberately conservative. Each sweep deletes only what it can justify, runs
 * on a slow timer, and survives its own failures: housekeeping that takes the
 * worker down with it is worse than housekeeping nobody runs.
 */

const log = getLogger('worker.maintenance');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Often enough that expired rows do not pile up, rare enough to be invisible. */
export const DEFAULT_SESSION_SWEEP_INTERVAL_MS = 6 * HOUR;

/**
 * How long price observations are kept.
 *
 * Ninety days covers a full booking season, which is the window over which
 * "is this actually cheap?" is a meaningful question. The cheapest observation
 * per watch survives regardless, so pruning can never make a watch's best-known
 * total rise.
 *
 * `docs/security.md` requires a retention policy before launch because travel
 * history is personal data. This is that policy for price observations; the
 * rest of a user's data needs its own answer, and deleting an account is not
 * implemented yet.
 */
export const DEFAULT_PRICE_HISTORY_RETENTION_DAYS = 90;

export const DEFAULT_PRUNE_INTERVAL_MS = 24 * HOUR;

export interface MaintenanceDependencies {
  readonly repositories: Repositories;
  readonly now?: () => number;
}

export interface MaintenanceOptions {
  readonly sessionSweepIntervalMs?: number;
  readonly priceHistoryRetentionDays?: number;
  readonly pruneIntervalMs?: number;
  /** Run both sweeps immediately, so a restart is not a free pass. */
  readonly runOnStart?: boolean;
}

export async function sweepExpiredSessions(dependencies: MaintenanceDependencies): Promise<number> {
  const now = dependencies.now ?? Date.now;
  // Only rows already past their own expiry. A session the user is still using
  // has an expiry in the future and is never in scope.
  const removed = await dependencies.repositories.sessions.deleteExpired(
    new Date(now()).toISOString(),
  );

  if (removed > 0) log.info({ removed }, 'expired sessions swept');
  return removed;
}

export async function prunePriceHistory(
  dependencies: MaintenanceDependencies,
  retentionDays: number = DEFAULT_PRICE_HISTORY_RETENTION_DAYS,
): Promise<number> {
  const now = dependencies.now ?? Date.now;
  const before = new Date(now() - retentionDays * DAY).toISOString();

  const removed = await dependencies.repositories.priceHistory.pruneOlderThan(before);

  if (removed > 0) log.info({ removed, before, retentionDays }, 'old price observations pruned');
  return removed;
}

export interface MaintenanceHandle {
  stop(): void;
}

/**
 * Run a task on an interval, surviving its own failures.
 *
 * A sweep that throws must not clear the timer: the next one may well succeed,
 * and a housekeeping loop that silently stopped is exactly the failure nobody
 * notices until the table is enormous.
 */
function repeat(intervalMs: number, task: () => Promise<unknown>, label: string): () => void {
  const timer = setInterval(() => {
    void task().catch((error: unknown) => {
      log.error({ err: error, task: label }, 'maintenance sweep failed');
    });
  }, intervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}

export function startMaintenance(
  dependencies: MaintenanceDependencies,
  options: MaintenanceOptions = {},
): MaintenanceHandle {
  const retentionDays = options.priceHistoryRetentionDays ?? DEFAULT_PRICE_HISTORY_RETENTION_DAYS;

  const stops = [
    repeat(
      options.sessionSweepIntervalMs ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS,
      () => sweepExpiredSessions(dependencies),
      'sessions',
    ),
    repeat(
      options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
      () => prunePriceHistory(dependencies, retentionDays),
      'price-history',
    ),
  ];

  if (options.runOnStart !== false) {
    // Awaited by nobody on purpose: a slow first sweep must not delay the
    // worker starting to do the job people are waiting on.
    void sweepExpiredSessions(dependencies).catch((error: unknown) =>
      log.error({ err: error }, 'initial session sweep failed'),
    );
  }

  log.info({ retentionDays }, 'maintenance started');

  return {
    stop() {
      for (const stop of stops) stop();
      log.info('maintenance stopped');
    },
  };
}
