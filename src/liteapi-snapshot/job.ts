import { randomUUID } from 'node:crypto';
import { daysBetween, isIsoDate } from '@/core/dates';
import type { StayOffer, StayProperty, StayRate } from '@/core/stay/types';
import type { IsoDate } from '@/core/trip/types';
import type { LiteApiRatesRow, Repositories } from '@/db/repository';
import { liteApiEnvironment, type Env } from '@/lib/env';
import type { Limiter } from '@/lib/concurrency';
import { AppError, type ErrorCode } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import type { Job } from '@/queue/types';
import type { ProviderResult } from '@/providers/types';
import { LiteApiStayProvider } from '@/providers/stays/liteapi';
import { liteapiLimiterPool } from './limiter';
import { snapshotTtlMs } from './staleness';
import {
  STORED_SCHEMA_VERSION,
  readStoredProperty,
  readStoredRates,
  toStoredRates,
} from './stored-schema';
import {
  LAUNCH_DESTINATIONS,
  SNAPSHOT_CURRENCY,
  SNAPSHOT_OCCUPANCY,
  WINDOW_NIGHTS,
  WINDOW_OFFSET_DAYS,
  dailyCallCeiling,
  targetKey,
  targetQuery,
  type LaunchDestination,
  type SnapshotTarget,
} from './targets';

/**
 * The `liteapi.snapshot.refresh` job: fill one destination-and-window row of our own snapshot.
 *
 * This file is the only place that calls the live LiteAPI client for display data, and it runs
 * in the worker. A page never imports it (`import-guard.test.ts` holds that).
 *
 * One run, at most two vendor calls:
 *   1. hotel content, one `data/hotels` call, only when our stored copy is missing or expired;
 *   2. rates, one `hotels/rates` call with the stored hotel ids;
 * then the mapped, validated result replaces the row.
 *
 * **A failure keeps the old row.** Nothing is written unless the whole answer was good, and the
 * job never throws on a provider error, so the queue does not retry it and spend more calls.
 * The log carries the run id, the destination, the window, the error code and the calls made.
 * It never carries a key, a URL or a message from the vendor.
 */

const log = getLogger('liteapi-snapshot.job');

export const SNAPSHOT_JOB = 'liteapi.snapshot.refresh';

/** At most this many vendor calls in one run. */
export const MAX_CALLS_PER_RUN = 2;

/** Hotel content (a list, photos, stars) changes slowly and is free: refreshed weekly. */
const HOTEL_CONTENT_TTL_MS = 7 * 24 * 3_600_000;

/** The two leaf calls the job needs; `LiteApiStayProvider` satisfies it. */
export interface SnapshotClient {
  listHotels(
    query: ReturnType<typeof targetQuery>,
  ): Promise<ProviderResult<readonly StayProperty[]>>;
  fetchRates(
    hotelIds: readonly string[],
    query: ReturnType<typeof targetQuery>,
  ): Promise<ProviderResult<ReadonlyMap<string, readonly StayRate[]>>>;
}

type SnapshotEnv = Pick<
  Env,
  | 'LITEAPI_API_KEY'
  | 'LITEAPI_GUEST_NATIONALITY'
  | 'LITEAPI_SNAPSHOT_ENABLED'
  | 'LITEAPI_SNAPSHOT_REFRESHES_PER_DAY'
>;

export interface SnapshotJobDependencies {
  readonly repositories: Pick<Repositories, 'liteapiSnapshot'>;
  readonly env: SnapshotEnv;
  /** Milliseconds since the epoch. The only clock the job reads. */
  readonly now?: () => number;
  /** Builds the vendor client. Called only after the flag and the key have been checked. */
  readonly createClient?: (env: SnapshotEnv, now: () => number) => SnapshotClient;
  /** Defaults to the process-wide limiter for `liteapi`. */
  readonly limiter?: Limiter;
  readonly runId?: () => string;
  readonly destinations?: readonly LaunchDestination[];
  readonly maxCallsPerRun?: number;
}

function defaultClient(env: SnapshotEnv, now: () => number): SnapshotClient {
  return new LiteApiStayProvider({
    apiKey: env.LITEAPI_API_KEY!,
    guestNationality: env.LITEAPI_GUEST_NATIONALITY,
    now: () => new Date(now()),
  });
}

function todayOf(now: number): IsoDate {
  return new Date(now).toISOString().slice(0, 10);
}

function startOfUtcDay(now: number): string {
  return `${todayOf(now)}T00:00:00.000Z`;
}

/** Thrown inside a run to end it as `failed` with a code. Never carries a message upward. */
class RunFailure extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

function codeOf(error: unknown): ErrorCode {
  if (error instanceof RunFailure || error instanceof AppError) return error.code;
  return 'INTERNAL_ERROR';
}

/** Thrown inside a run when a call would pass a cap. */
class CapReached extends Error {}

export function createSnapshotRefreshHandler(dependencies: SnapshotJobDependencies) {
  const { env } = dependencies;
  const repo = dependencies.repositories.liteapiSnapshot;
  const now = dependencies.now ?? Date.now;
  const newRunId = dependencies.runId ?? randomUUID;
  const destinations = dependencies.destinations ?? LAUNCH_DESTINATIONS;
  const maxCalls = dependencies.maxCallsPerRun ?? MAX_CALLS_PER_RUN;
  const refreshes = env.LITEAPI_SNAPSHOT_REFRESHES_PER_DAY;

  return async (job: Job<'liteapi.snapshot.refresh'>): Promise<void> => {
    const { destination: destinationCode, checkIn, checkOut } = job.payload;
    const runId = newRunId();
    const environment = liteApiEnvironment(env) ?? 'sandbox';
    const base = {
      runId,
      job: SNAPSHOT_JOB,
      destinationCode,
      checkIn,
      checkOut,
      // With no key nothing is called, so a `disabled` record's environment says nothing.
      environment,
    };

    // The flag and the key are checked before anything that could reach the vendor, and before
    // the client is built.
    if (!env.LITEAPI_SNAPSHOT_ENABLED || !env.LITEAPI_API_KEY) {
      await repo.startRun(base);
      await repo.finishRun(runId, { status: 'disabled', callsMade: 0 });
      log.info({ runId, destination: destinationCode }, 'liteapi snapshot refresh is disabled');
      return;
    }

    await repo.startRun(base);
    let callsMade = 0;

    try {
      const target = findTarget(destinations, env, now(), job.payload);
      if (!target) throw new RunFailure('VALIDATION_ERROR');

      // The daily ceiling: destinations x windows x refreshes (plus content calls).
      const ceiling = dailyCallCeiling(destinations.length, WINDOW_OFFSET_DAYS.length, refreshes);
      const usedToday = await repo.callsSince(startOfUtcDay(now()), SNAPSHOT_JOB);
      const budget = Math.min(maxCalls, ceiling - usedToday);
      if (budget < 1) {
        log.warn(
          { runId, destination: destinationCode, usedToday, ceiling },
          'daily call ceiling reached',
        );
        await repo.finishRun(runId, { status: 'skipped_cap', callsMade });
        return;
      }

      const limiter = dependencies.limiter ?? liteapiLimiterPool.for('liteapi', 1);
      const client = (dependencies.createClient ?? defaultClient)(env, now);
      const query = targetQuery(target);

      const spend = <T>(call: () => Promise<ProviderResult<T>>): Promise<T> => {
        if (callsMade >= budget) throw new CapReached();
        callsMade += 1;
        // Only the leaf call holds the slot.
        return limiter.run(call).then((result) => {
          if (!result.ok) throw new RunFailure(result.error.code);
          return result.value;
        });
      };

      // 1. Hotel content, only when missing or expired.
      let properties = (await repo.getHotels(target.destination.code))
        .map((row) => readStoredProperty(row.content))
        .filter((property): property is StayProperty => property !== null);

      if (properties.length === 0) {
        const listed = await spend(() => client.listHotels(query));
        if (listed.length === 0) {
          log.info(
            { runId, destination: destinationCode },
            'liteapi listed no hotels; nothing stored',
          );
          await repo.finishRun(runId, { status: 'ok', callsMade });
          return;
        }
        const fetchedAt = new Date(now());
        await repo.putHotels(
          listed.map((property) => ({
            hotelId: property.providerPropertyId,
            destinationCode: target.destination.code,
            content: property,
            fetchedAt: fetchedAt.toISOString(),
            expiresAt: new Date(fetchedAt.getTime() + HOTEL_CONTENT_TTL_MS).toISOString(),
          })),
        );
        properties = [...listed];
      }

      // 2. Rates for the stored ids.
      const ratesByHotel = await spend(() =>
        client.fetchRates(
          properties.map((property) => property.providerPropertyId),
          query,
        ),
      );

      // 3. Map, validate, then replace the row.
      const offers: StayOffer[] = properties.map((property) => ({
        property,
        rates: ratesByHotel.get(property.providerPropertyId) ?? [],
      }));
      const stored = toStoredRates(offers);
      const checked = readStoredRates(STORED_SCHEMA_VERSION, JSON.parse(JSON.stringify(stored)));
      if (!checked.ok) throw new RunFailure('INTERNAL_ERROR');

      // The row's instant is the rates call's own instant when a rate carries one.
      const observedAt =
        offers.flatMap((offer) => offer.rates)[0]?.observedAt ?? new Date(now()).toISOString();
      const row: LiteApiRatesRow = {
        ...targetKey(target),
        environment,
        schemaVersion: STORED_SCHEMA_VERSION,
        rates: stored,
        observedAt,
        expiresAt: new Date(Date.parse(observedAt) + snapshotTtlMs(refreshes)).toISOString(),
        runId,
      };
      await repo.putRates(row);
      await repo.finishRun(runId, { status: 'ok', callsMade });
    } catch (error) {
      const capped = error instanceof CapReached;
      const code = codeOf(error);
      log.warn(
        {
          runId,
          destination: destinationCode,
          checkIn,
          checkOut,
          code: capped ? 'CALL_CAP' : code,
          callsMade,
        },
        capped
          ? 'liteapi snapshot run stopped at its call cap'
          : 'liteapi snapshot run failed; the previous row is kept',
      );
      try {
        await repo.finishRun(
          runId,
          capped
            ? { status: 'skipped_cap', callsMade }
            : { status: 'failed', callsMade, errorCode: code },
        );
      } catch (finishError) {
        log.error(
          { runId, code: codeOf(finishError) },
          'could not record the end of a snapshot run',
        );
      }
      // Never rethrown: a retry would spend more vendor calls on the same failure.
    }
  };
}

/**
 * The target a payload names, or null. It must be a launch destination, four nights, and a
 * check-in near today plus the window offsets: so a stray job can never ask the vendor about a
 * place or a date we did not choose, while a job queued just before midnight still runs just
 * after it.
 */
function findTarget(
  destinations: readonly LaunchDestination[],
  env: SnapshotEnv,
  now: number,
  payload: { destination: string; checkIn: string; checkOut: string },
): SnapshotTarget | null {
  const destination = destinations.find((entry) => entry.code === payload.destination);
  if (!destination) return null;
  if (!isIsoDate(payload.checkIn) || !isIsoDate(payload.checkOut)) return null;
  if (daysBetween(payload.checkIn, payload.checkOut) !== WINDOW_NIGHTS) return null;

  const offset = daysBetween(todayOf(now), payload.checkIn);
  const lowest = Math.min(...WINDOW_OFFSET_DAYS) - 1;
  const highest = Math.max(...WINDOW_OFFSET_DAYS) + 1;
  if (offset < lowest || offset > highest) return null;

  return {
    destination,
    checkIn: payload.checkIn,
    checkOut: payload.checkOut,
    occupancy: SNAPSHOT_OCCUPANCY,
    currency: SNAPSHOT_CURRENCY,
    guestNationality: env.LITEAPI_GUEST_NATIONALITY.toUpperCase(),
  };
}
