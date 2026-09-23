import { lessThan } from '@/core/money';
import { detectDeal, type DealVerdict } from '@/core/deal-detection';
import { observationsFor } from './observations';
import { buildAlertContent } from './alerts';
import { searchProfileToQuery } from '@/search/schema';
import { resolveEntitlements } from '@/core/entitlements';
import { getLogger } from '@/lib/logger';
import { runSearch } from '@/search/orchestrator';
import { recordProviderCalls } from '@/search/observe';
import { resolveDestinationNames } from '@/search/destination-names';
import { WatchService } from './service';
import type { Repositories, TravelWatchRecord, TripSearchRecord } from '@/db/repository';
import type { SearchOutcome } from '@/search/types';
import type { Job, QueueDriver } from '@/queue/types';

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
  /**
   * Where to queue delivery of an alert this run raises.
   *
   * Optional. Without it the alert is still recorded and still visible; only
   * the push is skipped. Recording and delivering are separate steps precisely
   * so one can work without the other.
   */
  readonly queue?: Pick<QueueDriver, 'enqueue'>;
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
  /** True when the drop was material enough to alert the user about. */
  readonly alerted: boolean;
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
    return {
      watchId,
      ran: false,
      candidatesFound: 0,
      observations: 0,
      improvedBest: false,
      alerted: false,
    };
  }

  if (watch.status !== 'active') {
    // Paused between being enqueued and being picked up. Not an error, and not
    // rescheduled either: resuming is what schedules it again.
    log.info({ watchId, status: watch.status }, 'refresh skipped: watch is not active');
    return {
      watchId,
      ran: false,
      candidatesFound: 0,
      observations: 0,
      improvedBest: false,
      alerted: false,
    };
  }

  const saved = await repositories.tripSearches.findById(watch.tripSearchId);

  if (!saved) {
    log.error({ watchId }, 'refresh skipped: saved search is gone');
    return {
      watchId,
      ran: false,
      candidatesFound: 0,
      observations: 0,
      improvedBest: false,
      alerted: false,
    };
  }

  const owner = await repositories.users.findById(watch.userId);
  const entitlements = resolveEntitlements(owner?.plan);
  const service = new WatchService({ repositories, now });

  let outcome: SearchOutcome | null = null;

  try {
    outcome = await search(
      {
        profile: saved.profile,
        destinations: saved.destinations,
        destinationNames: resolveDestinationNames(saved.destinations),
        limits: { maxDestinations: entitlements.maxDestinationsPerSearch },
        requestId: `watch-${watchId}`,
      },
      { observe: recordProviderCalls(repositories) },
    );
  } catch (error) {
    // A profile the planner rejects will be rejected again in six hours, but
    // the watch still has to be rescheduled or it stops silently.
    log.error({ watchId, err: error }, 'refresh search failed');
  }

  const observed = outcome
    ? await recordObservations(watch, outcome, repositories, new Date(now()).toISOString())
    : { observations: 0, improvedBest: false, verdict: null, trip: null };

  const alerted =
    observed.verdict && observed.trip
      ? await raiseAlert(
          watch,
          saved,
          observed.trip,
          observed.verdict,
          repositories,
          dependencies.queue,
        )
      : false;

  // Always last, and always reached.
  await service.recordRun(watchId, entitlements, watch.priority);

  const candidatesFound = outcome?.results.length ?? 0;

  log.info(
    {
      watchId,
      candidatesFound,
      observations: observed.observations,
      improvedBest: observed.improvedBest,
      dealReason: observed.verdict?.reason ?? null,
      alerted,
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
    alerted,
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
): Promise<{
  observations: number;
  improvedBest: boolean;
  /** Null when there was nothing to judge. */
  verdict: DealVerdict | null;
  trip: SearchOutcome['results'][number] | null;
}> {
  // Only eligible trips count. A cheaper trip that breaks the user's own hard
  // limits is not a better trip, and recording it as the benchmark would make
  // every honest result afterwards look like a price rise.
  const cheapest = outcome.results.reduce<SearchOutcome['results'][number] | null>(
    (best, trip) => (best === null || lessThan(trip.cost.total, best.cost.total) ? trip : best),
    null,
  );

  if (!cheapest) return { observations: 0, improvedBest: false, verdict: null, trip: null };

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

  // Judged against the best *before* this run, which is why `previous` is read
  // from the watch as it was loaded. Comparing against the value we just wrote
  // would mean nothing was ever a deal.
  const verdict = detectDeal({ current: cheapest.cost.total, previousBest: previous });

  return {
    observations: rows.length,
    improvedBest: comparable && lowest !== null && lessThan(lowest.amount, previous),
    verdict,
    trip: cheapest,
  };
}

/**
 * Record an alert for a material drop.
 *
 * Exactly one, and only for a drop that cleared both thresholds. "Exactly one"
 * falls out of comparing against the previous best rather than a fixed figure:
 * once a drop has been alerted, that price becomes the best known, so the next
 * refresh finding the same price is not cheaper than anything and says nothing.
 *
 * Creating the notification and delivering it are separate steps on purpose.
 * A push that fails must not mean the user never learns there was a deal.
 */
async function raiseAlert(
  watch: TravelWatchRecord,
  search: TripSearchRecord,
  trip: SearchOutcome['results'][number],
  verdict: DealVerdict,
  repositories: Repositories,
  queue: Pick<QueueDriver, 'enqueue'> | undefined,
): Promise<boolean> {
  if (!verdict.material) return false;

  const content = buildAlertContent({
    search,
    trip,
    verdict,
    searchQuery: searchProfileToQuery(search.profile, search.destinations),
  });

  const notification = await repositories.notifications.create({
    userId: watch.userId,
    watchId: watch.id,
    // Assigned by the deterministic core, never by whoever writes the words.
    severity: verdict.severity,
    title: content.title,
    body: content.body,
    url: content.url,
    readAt: null,
    deliveredAt: null,
  });

  // Queued rather than pushed inline: a slow or unreachable push service must
  // not hold up the refresh, and the alert is already safely recorded.
  await queue?.enqueue(
    'notification.deliver',
    { notificationId: notification.id },
    { dedupeKey: `notification.deliver:${notification.id}` },
  );

  log.info(
    { watchId: watch.id, severity: verdict.severity, dropShare: verdict.dropShare },
    'deal alert raised',
  );

  return true;
}

/** The queue handler. Thin on purpose: the behaviour is testable without a queue. */
export function createRefreshHandler(dependencies: RefreshDependencies) {
  return async (job: Job<'travel-watch.refresh'>): Promise<void> => {
    await refreshWatch(job.payload.watchId, dependencies);
  };
}
