import type { IsoDate } from '@/core/trip/types';
import type { DiscoverySource } from '@/discovery/snapshot';
import { getDiscoverySource } from '@/discovery/snapshot';
import { isThingsToDoFresh, warmThingsToDo } from '@/discovery/things-to-do';
import { getLogger } from '@/lib/logger';
import type { Job, QueueDriver } from '@/queue/types';
import { resolveDestinationGeo } from '@/search/destination-names';
import {
  PLACES_DESTINATIONS_PER_ROUND,
  buildCacheTargets,
  findCacheTarget,
  parsePlacesTargetId,
  placesTargetDestinations,
  placesTargetId,
  type CacheTarget,
} from './targets';

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
  /** Injectable so a test can warm a destination without reaching Wikidata. */
  readonly places?: { warm: typeof warmThingsToDo };
  /** The clock, for the date window. Never read inside the targets. */
  readonly now?: () => number;
}

/** Today as `YYYY-MM-DD` from an instant. The one place the worker turns a clock into a date. */
function todayOf(now: number): IsoDate {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Wikidata etiquette, which this schedule is shaped by
 * (https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual):
 *  - a descriptive User-Agent that names the app and where to read about it,
 *    set by the provider (`src/providers/places/wikidata.ts`), never a browser's;
 *  - one query at a time - the places limiter is sized 1 and every lookup goes
 *    through it - and the lookups are spaced a minute apart on top of that;
 *  - a low rate overall: at most 40 destinations a round, a round every
 *    `PLACES_REFRESH_HOURS` (a week by default), and a destination still fresh
 *    in the cache is not asked about again.
 * The answers are cached for a week and served stale for a month more, so a
 * missed round costs a visitor a wait, never a blank page.
 */
const PLACES_SPACING_MS = MINUTE;

/**
 * Refresh one target. A failed refresh throws, so the queue retries with
 * backoff - and the entry it was meant to replace keeps being served meanwhile.
 * An unknown target does not: retrying a name nobody defines only delays the log.
 */
export function createCacheRefreshHandler(dependencies: CacheRefreshDependencies = {}) {
  const now = dependencies.now ?? Date.now;

  return async (job: Job<'cache.refresh'>): Promise<void> => {
    const destination = parsePlacesTargetId(job.payload.targetId);

    if (destination) {
      const geo = resolveDestinationGeo(destination);
      if (!geo) {
        log.error({ targetId: job.payload.targetId }, 'places target has no position; dropping');
        return;
      }

      const warm = dependencies.places?.warm ?? warmThingsToDo;
      const warmed = await warm({
        destination,
        destinationName: geo.name,
        position: geo.position,
      });

      log.info({ targetId: job.payload.targetId, warmed }, 'places target refreshed');
      return;
    }

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

/**
 * Enqueue the places lookups for the destinations that need one.
 *
 * Up to `limit` destinations whose things to do are not already fresh, a minute
 * apart: the first `limit` of the catalogue would otherwise be the same forty
 * every round and the rest would never be reached. Returns how many were queued.
 */
export async function enqueuePlacesRefresh(
  queue: Pick<QueueDriver, 'enqueue'>,
  dependencies: {
    /** Injectable so a test can decide what is fresh without a cache. */
    readonly isFresh?: (destination: string) => Promise<boolean>;
    readonly destinations?: readonly string[];
    readonly limit?: number;
  } = {},
): Promise<number> {
  const limit = dependencies.limit ?? PLACES_DESTINATIONS_PER_ROUND;
  const destinations = dependencies.destinations ?? placesTargetDestinations();
  const isFresh =
    dependencies.isFresh ??
    (async (destination: string) => {
      const geo = resolveDestinationGeo(destination);
      // No position means the lookup could never run; counting it as fresh keeps
      // it from using up a place in the round.
      if (!geo) return true;

      return isThingsToDoFresh({
        destination,
        destinationName: geo.name,
        position: geo.position,
      });
    });

  const due: string[] = [];
  for (const destination of destinations) {
    if (due.length >= limit) break;
    if (!(await isFresh(destination))) due.push(destination);
  }

  await Promise.all(
    due.map((destination, index) =>
      queue.enqueue(
        'cache.refresh',
        { targetId: placesTargetId(destination) },
        {
          delayMs: index * PLACES_SPACING_MS,
          dedupeKey: `cache.refresh:${placesTargetId(destination)}`,
        },
      ),
    ),
  );

  return due.length;
}

export interface CacheRefreshOptions {
  readonly runOnStart?: boolean;
  /** How often the places round runs, in hours. Unset means the places are not scheduled. */
  readonly placesIntervalHours?: number;
  /** The clock the date roll-over is read from. */
  readonly now?: () => number;
  /** How often the date is looked at, in milliseconds. */
  readonly rolloverCheckMs?: number;
  /** Injectable so a test can count rounds without a cache or a catalogue. */
  readonly enqueuePlaces?: (queue: Pick<QueueDriver, 'enqueue'>) => Promise<number>;
}

export interface CacheRefreshScheduler {
  stop(): void;
  /**
   * Start a round now if the UTC date has changed since the last look.
   *
   * The timer calls it; it is on the handle so a test can move the clock and
   * call it without waiting. True when it started one.
   */
  checkRollover(): boolean;
}

export function startCacheRefresh(
  queue: Pick<QueueDriver, 'enqueue'>,
  intervalMinutes: number,
  options: CacheRefreshOptions = {},
): CacheRefreshScheduler {
  const now = options.now ?? Date.now;

  const round = () =>
    enqueueCacheRefresh(queue, intervalMinutes).catch((error: unknown) => {
      log.error({ err: error }, 'could not enqueue the cache refresh round');
    });

  const placesRound = () =>
    (options.enqueuePlaces ?? ((q) => enqueuePlacesRefresh(q)))(queue).catch((error: unknown) => {
      log.error({ err: error }, 'could not enqueue the places refresh round');
    });

  const timer = setInterval(() => void round(), intervalMinutes * MINUTE);
  timer.unref?.();

  /*
   * The prices are keyed by date, so at 00:00 UTC every key changes at once and
   * nothing is cached under the new ones. A round on the interval's own clock
   * would leave that gap open for up to a whole interval (and a page serves
   * yesterday's entry, labelled, until it closes). Looking at the date every
   * half minute and starting the round the moment it turns closes it in the
   * first of them.
   */
  let lastDay = todayOf(now());
  const checkRollover = (): boolean => {
    const day = todayOf(now());
    if (day === lastDay) return false;

    lastDay = day;
    log.info({ day }, 'the UTC date changed; starting a cache refresh round');
    void round();
    return true;
  };
  const rolloverTimer = setInterval(checkRollover, options.rolloverCheckMs ?? 30_000);
  rolloverTimer.unref?.();

  let placesTimer: NodeJS.Timeout | undefined;
  if (options.placesIntervalHours !== undefined) {
    placesTimer = setInterval(() => void placesRound(), options.placesIntervalHours * 3_600_000);
    placesTimer.unref?.();
  }

  // A restart should not leave the front page cold for a whole interval.
  if (options.runOnStart !== false) {
    void round();
    if (options.placesIntervalHours !== undefined) void placesRound();
  }

  log.info(
    { intervalMinutes, placesIntervalHours: options.placesIntervalHours ?? null },
    'cache refresh scheduled',
  );

  return {
    checkRollover,
    stop: () => {
      clearInterval(timer);
      clearInterval(rolloverTimer);
      if (placesTimer) clearInterval(placesTimer);
    },
  };
}
