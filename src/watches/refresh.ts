import { lessThan } from '@/core/money';
import { observationsFor } from './observations';
import { resolveEntitlements } from '@/core/entitlements';
import { getLogger } from '@/lib/logger';
import { runSearch } from '@/search/orchestrator';
import { resolveDestinationNames } from '@/search/destination-names';
import { WatchService } from './service';
import type { Repositories, TravelWatchRecord } from '@/db/repository';
import type { SearchOutcome } from '@/search/types';
import type { Job } from '@/queue/types';

/**
 * Refreshing one Travel Watch (implementation plan 1.6).
 *
 * Replays the saved search, records that the watch ran, and remembers the best
 * total it has ever seen. Deciding whether that is *news* is 1.8; this only
 * establishes the facts that decision will be made from.
 *
 * Two properties matter more than speed here:
 *
 *  - **A refresh always reschedules.** Whether the search found nothing, the
 *    providers were down or the whole thing threw, the watch gets a new
 *    `nextRunAt`. A watch that fails to reschedule is a watch that has silently
 *    stopped, and nothing in the product would announce it.
 *  - **The cadence comes from the owner's plan**, resolved per run rather than
 *    captured when the watch was made, so changing plan changes the cadence
 *    without touching a single row.
 */

const log = getLogger('watches.refresh');

export interface RefreshDependencies {
  readonly repositories: Repositories;
  readonly now?: () => number;
  /** Injectable so a test can refresh without reaching a provider. */
  readonly search?: typeof runSearch;
}

export interface RefreshResult {
  readonly watchId: string;
  readonly ran: boolean;
  readonly candidatesFound: number;
  /** Rows written to price history by this run. */
  readonly observations: number;
  /** True when this run beat every total previously recorded for the watch. */
  readonly improvedBest: boolean;
}

/**
 * Run one watch.
 *
 * Never throws for an expected failure: a missing watch, a search that cannot
 * run, an unreachable provider. Those are outcomes to record, not reasons to
 * fail a job and have it retried three times to the same effect.
 */
export async function refreshWatch(
  watchId: string,
  dependencies: RefreshDependencies,
): Promise<RefreshResult> {
  const { repositories } = dependencies;
  const now = dependencies.now ?? Date.now;
  const search = dependencies.search ?? runSearch;

  const watch = await repositories.travelWatches.findById(watchId);

  if (!watch) {
    log.warn({ watchId }, 'refresh skipped: watch no longer exists');
    return { watchId, ran: false, candidatesFound: 0, observations: 0, improvedBest: false };
  }

  if (watch.status !== 'active') {
    // Paused between being enqueued and being picked up. Not an error, and not
    // rescheduled either: resuming is what schedules it again.
    log.info({ watchId, status: watch.status }, 'refresh skipped: watch is not active');
    return { watchId, ran: false, candidatesFound: 0, observations: 0, improvedBest: false };
  }

  const saved = await repositories.tripSearches.findById(watch.tripSearchId);

  if (!saved) {
    log.error({ watchId }, 'refresh skipped: saved search is gone');
    return { watchId, ran: false, candidatesFound: 0, observations: 0, improvedBest: false };
  }

  const owner = await repositories.users.findById(watch.userId);
  const entitlements = resolveEntitlements(owner?.plan);
  const service = new WatchService({ repositories, now });

  let outcome: SearchOutcome | null = null;

  try {
    outcome = await search({
      profile: saved.profile,
      destinations: saved.destinations,
      destinationNames: resolveDestinationNames(saved.destinations),
      limits: { maxDestinations: entitlements.maxDestinationsPerSearch },
      requestId: `watch-${watchId}`,
    });
  } catch (error) {
    // A profile the planner rejects will be rejected again in six hours, but
    // the watch still has to be rescheduled or it stops silently.
    log.error({ watchId, err: error }, 'refresh search failed');
  }

  const observed = outcome
    ? await recordObservations(watch, outcome, repositories, new Date(now()).toISOString())
    : { observations: 0, improvedBest: false };

  // Always last, and always reached.
  await service.recordRun(watchId, entitlements, watch.priority);

  const candidatesFound = outcome?.results.length ?? 0;

  log.info(
    {
      watchId,
      candidatesFound,
      observations: observed.observations,
      improvedBest: observed.improvedBest,
      degraded: outcome?.diagnostics.degraded ?? null,
    },
    'travel watch refreshed',
  );

  return {
    watchId,
    ran: outcome !== null,
    candidatesFound,
    observations: observed.observations,
    improvedBest: observed.improvedBest,
  };
}

/**
 * Write this run's observations, then re-derive the best-known total from them.
 *
 * The order matters. `bestKnownTotal` is a cache of "the cheapest we have ever
 * recorded", and reading it back out of the history rather than setting it from
 * the candidate in hand means the two cannot drift: one source of truth and one
 * value derived from it, instead of two numbers that are supposed to agree.
 */
async function recordObservations(
  watch: TravelWatchRecord,
  outcome: SearchOutcome,
  repositories: Repositories,
  observedAt: string,
): Promise<{ observations: number; improvedBest: boolean }> {
  // Only eligible trips count. A cheaper trip that breaks the user's own hard
  // limits is not a better trip, and recording it as the benchmark would make
  // every honest result afterwards look like a price rise.
  const cheapest = outcome.results.reduce<SearchOutcome['results'][number] | null>(
    (best, trip) => (best === null || lessThan(trip.cost.total, best.cost.total) ? trip : best),
    null,
  );

  if (!cheapest) return { observations: 0, improvedBest: false };

  const rows = observationsFor(watch.id, cheapest, observedAt);
  for (const row of rows) {
    await repositories.priceHistory.record(row);
  }

  const currency = cheapest.cost.total.currency;
  const lowest = await repositories.priceHistory.findLowest(watch.id, 'trip_total', currency);
  const previous = watch.bestKnownTotal;

  if (lowest) {
    await repositories.travelWatches.update(watch.id, { bestKnownTotal: lowest.amount });
  }

  // A currency change makes the comparison meaningless rather than favourable,
  // so the new figure is recorded and simply not called an improvement.
  const comparable = previous !== null && previous.currency === currency;

  return {
    observations: rows.length,
    improvedBest: comparable && lowest !== null && lessThan(lowest.amount, previous),
  };
}

/** The queue handler. Thin on purpose: the behaviour is testable without a queue. */
export function createRefreshHandler(dependencies: RefreshDependencies) {
  return async (job: Job<'travel-watch.refresh'>): Promise<void> => {
    await refreshWatch(job.payload.watchId, dependencies);
  };
}
