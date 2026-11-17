import type { IsoDate } from '@/core/trip/types';
import type { LiteApiRunRecord } from '@/db/repository';
import { getLogger } from '@/lib/logger';
import type { QueueDriver } from '@/queue/types';
import { FLIGHTS_JOB, flightTargetId, flightTargets } from './flights-targets';
import { snapshotTargets, targetId, type LaunchDestination, LAUNCH_DESTINATIONS } from './targets';

/**
 * When a snapshot round starts.
 *
 * A round is one `liteapi.snapshot.refresh` job per destination and window, and, when departure
 * cities are given, one `liteapi.flights.refresh` job per origin, destination and window. Rounds start at
 * fixed UTC slots, not "every N hours from boot", so a restart does not move them and does not
 * trigger one:
 *
 *   refreshes a day = 3  ->  slots at 00:00, 08:00 and 16:00 UTC
 *
 * A 30-second check starts a round when the slot changes. After a restart a round starts only if
 * the latest recorded run is not already in the current slot, so restarting the worker five
 * times in one slot makes no calls beyond the first round's.
 */

const log = getLogger('liteapi-snapshot.schedule');

const DAY_MS = 86_400_000;

const HOTELS_JOB = 'liteapi.snapshot.refresh';

/**
 * The number of the slot an instant falls in: a whole number that goes up by one at each slot
 * boundary and restarts its day alignment at 00:00 UTC.
 */
export function slotOf(at: number, refreshesPerDay: number): number {
  const day = Math.floor(at / DAY_MS);
  const intoDay = at - day * DAY_MS;
  return day * refreshesPerDay + Math.floor((intoDay * refreshesPerDay) / DAY_MS);
}

/** The start of a slot, as an instant. For logs and tests. */
export function slotStart(slot: number, refreshesPerDay: number): number {
  const day = Math.floor(slot / refreshesPerDay);
  const index = slot - day * refreshesPerDay;
  return day * DAY_MS + Math.ceil((index * DAY_MS) / refreshesPerDay);
}

export interface SnapshotSchedulerOptions {
  readonly refreshesPerDay: number;
  readonly guestNationality: string;
  readonly now?: () => number;
  /** How often the slot is looked at. Defaults to 30 seconds. */
  readonly checkMs?: number;
  readonly destinations?: readonly LaunchDestination[];
  /**
   * Departure cities for the flights round. Omitted or empty means no flights jobs are ever
   * enqueued.
   */
  readonly origins?: readonly string[];
}

export interface SnapshotSchedulerDependencies {
  readonly queue: Pick<QueueDriver, 'enqueue'>;
  readonly repository: { latestRun(job?: string): Promise<LiteApiRunRecord | null> };
}

export interface SnapshotScheduler {
  /** The first look, made as the scheduler starts. True when it started a round. */
  readonly initial: Promise<boolean>;
  /** Look at the slot now. True when it started a round. The timer calls this. */
  check(): Promise<boolean>;
  stop(): void;
}

export function startSnapshotScheduler(
  { queue, repository }: SnapshotSchedulerDependencies,
  options: SnapshotSchedulerOptions,
): SnapshotScheduler {
  const now = options.now ?? Date.now;
  const destinations = options.destinations ?? LAUNCH_DESTINATIONS;
  let lastSlot: number | null = null;
  let checking = false;

  const check = async (): Promise<boolean> => {
    const at = now();
    const slot = slotOf(at, options.refreshesPerDay);
    if (slot === lastSlot || checking) return false;

    checking = true;
    try {
      // Each job asks about its own rounds: a flights run in this slot says nothing about hotels.
      const ranInSlot = async (job: string): Promise<boolean> => {
        const latest = await repository.latestRun(job);
        return (
          latest !== null && slotOf(Date.parse(latest.startedAt), options.refreshesPerDay) === slot
        );
      };
      const origins = options.origins ?? [];
      const hotelsRan = await ranInSlot(HOTELS_JOB);
      const flightsRan = origins.length === 0 ? true : await ranInSlot(FLIGHTS_JOB);
      lastSlot = slot;
      // A restart inside a slot that already ran is not a reason to call the vendor again.
      if (hotelsRan && flightsRan) {
        log.info({ slot }, 'this slot already has a snapshot round; not starting another');
        return false;
      }

      const today = new Date(at).toISOString().slice(0, 10) as IsoDate;
      let jobs = 0;

      if (!hotelsRan) {
        const targets = snapshotTargets(today, options.guestNationality, destinations);
        await Promise.all(
          targets.map((target) =>
            queue.enqueue(
              HOTELS_JOB,
              {
                destination: target.destination.code,
                checkIn: target.checkIn,
                checkOut: target.checkOut,
              },
              // One attempt: a failed run is recorded and waits for the next slot. A retry would
              // spend more vendor calls on whatever just failed.
              { attempts: 1, dedupeKey: `liteapi.snapshot.refresh:${targetId(target)}:${slot}` },
            ),
          ),
        );
        jobs += targets.length;
      }

      if (!flightsRan) {
        const targets = flightTargets(today, origins, destinations);
        await Promise.all(
          targets.map((target) =>
            queue.enqueue(
              FLIGHTS_JOB,
              {
                origin: target.origin,
                destination: target.destination.code,
                departureDate: target.departureDate,
                returnDate: target.returnDate,
              },
              { attempts: 1, dedupeKey: `${FLIGHTS_JOB}:${flightTargetId(target)}:${slot}` },
            ),
          ),
        );
        jobs += targets.length;
      }
      log.info({ slot, jobs }, 'liteapi snapshot round started');
      return true;
    } catch (error) {
      // Try again at the next check rather than waiting a whole slot.
      lastSlot = null;
      log.error(
        { code: error instanceof Error ? error.name : 'unknown' },
        'could not start a liteapi snapshot round',
      );
      return false;
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void check(), options.checkMs ?? 30_000);
  timer.unref?.();
  // A fresh process looks straight away, so a restart does not wait half a minute.
  const initial = check();

  log.info({ refreshesPerDay: options.refreshesPerDay }, 'liteapi snapshot scheduled');

  return { initial, check, stop: () => clearInterval(timer) };
}
