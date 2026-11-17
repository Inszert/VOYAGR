import { randomUUID } from 'node:crypto';
import { daysBetween, isIsoDate } from '@/core/dates';
import type { FlightOffer, IsoDate } from '@/core/trip/types';
import type { LiteApiFlightsRow, Repositories } from '@/db/repository';
import { liteApiEnvironment, type Env } from '@/lib/env';
import type { Limiter } from '@/lib/concurrency';
import { AppError, type ErrorCode } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import type { Job } from '@/queue/types';
import { LiteApiFlightsClient, type LiteApiFlightsQuery } from '@/providers/flights/liteapi';
import type { ProviderResult } from '@/providers/types';
import {
  FLIGHTS_STORED_SCHEMA_VERSION,
  readStoredFlights,
  toStoredFlights,
} from './flights-stored-schema';
import {
  FLIGHTS_JOB,
  FLIGHT_ADULTS,
  FLIGHT_CABIN,
  FLIGHT_CURRENCY,
  MAX_FLIGHT_CALLS_PER_RUN,
  MAX_STORED_OFFERS,
  dailyFlightCallCeiling,
  flightRunLabel,
  flightTargetKey,
  type FlightTarget,
} from './flights-targets';
import { liteapiLimiterPool } from './limiter';
import { snapshotTtlMs } from './staleness';
import {
  LAUNCH_DESTINATIONS,
  WINDOW_NIGHTS,
  WINDOW_OFFSET_DAYS,
  type LaunchDestination,
} from './targets';

/**
 * The `liteapi.flights.refresh` job: fill one origin, destination and window row of our own
 * flights snapshot.
 *
 * Like `job.ts`, this runs in the worker and a page never imports it
 * (`import-guard.test.ts` holds that). One run makes **one** vendor call (`flights/rates`),
 * through the one `liteapi` limiter that hotels share, and the mapped, validated offers replace
 * the row.
 *
 * **A failure keeps the old row.** Nothing is written unless the whole answer was good, and the
 * job never throws on a provider error, so the queue does not retry it and spend more calls.
 * The log carries the run id, the route, the window, the error code and the calls made. It never
 * carries a key, a URL or a message from the vendor.
 *
 * An answer with no offers is a real answer, but it is not stored over a row that has some: a
 * route that went quiet for one refresh keeps its last priced row until that row expires.
 */

const log = getLogger('liteapi-snapshot.flights-job');

/** The one leaf call the job needs; `LiteApiFlightsClient` satisfies it. */
export interface FlightsSnapshotClient {
  fetchOffers(query: LiteApiFlightsQuery): Promise<ProviderResult<readonly FlightOffer[]>>;
}

type FlightsEnv = Pick<
  Env,
  | 'LITEAPI_API_KEY'
  | 'LITEAPI_SNAPSHOT_ENABLED'
  | 'LITEAPI_SNAPSHOT_REFRESHES_PER_DAY'
  | 'LITEAPI_SNAPSHOT_ORIGINS'
>;

export interface FlightsJobDependencies {
  readonly repositories: Pick<Repositories, 'liteapiSnapshot'>;
  readonly env: FlightsEnv;
  /** Milliseconds since the epoch. The only clock the job reads. */
  readonly now?: () => number;
  /** Builds the vendor client. Called only after the flag and the key have been checked. */
  readonly createClient?: (env: FlightsEnv, now: () => number) => FlightsSnapshotClient;
  /** Defaults to the process-wide limiter for `liteapi`, shared with the hotel job. */
  readonly limiter?: Limiter;
  readonly runId?: () => string;
  readonly destinations?: readonly LaunchDestination[];
  readonly maxCallsPerRun?: number;
}

function defaultClient(env: FlightsEnv, now: () => number): FlightsSnapshotClient {
  return new LiteApiFlightsClient({
    apiKey: env.LITEAPI_API_KEY!,
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

export function createFlightsRefreshHandler(dependencies: FlightsJobDependencies) {
  const { env } = dependencies;
  const repo = dependencies.repositories.liteapiSnapshot;
  const now = dependencies.now ?? Date.now;
  const newRunId = dependencies.runId ?? randomUUID;
  const destinations = dependencies.destinations ?? LAUNCH_DESTINATIONS;
  const maxCalls = dependencies.maxCallsPerRun ?? MAX_FLIGHT_CALLS_PER_RUN;
  const refreshes = env.LITEAPI_SNAPSHOT_REFRESHES_PER_DAY;

  return async (job: Job<'liteapi.flights.refresh'>): Promise<void> => {
    const { origin, destination, departureDate, returnDate } = job.payload;
    const runId = newRunId();
    const environment = liteApiEnvironment(env) ?? 'sandbox';
    const base = {
      runId,
      job: FLIGHTS_JOB,
      // The runs table has no origin column, so a flights run names its route here.
      destinationCode: flightRunLabel(origin, destination),
      checkIn: departureDate,
      checkOut: returnDate,
      environment,
    };

    // The flag and the key are checked before anything that could reach the vendor, and before
    // the client is built.
    if (!env.LITEAPI_SNAPSHOT_ENABLED || !env.LITEAPI_API_KEY) {
      await repo.startRun(base);
      await repo.finishRun(runId, { status: 'disabled', callsMade: 0 });
      log.info({ runId, origin, destination }, 'liteapi flights refresh is disabled');
      return;
    }

    await repo.startRun(base);
    let callsMade = 0;

    try {
      const target = findTarget(destinations, env, now(), job.payload);
      if (!target) throw new RunFailure('VALIDATION_ERROR');

      // The daily ceiling: origins x destinations x windows x refreshes, for flights alone.
      const ceiling = dailyFlightCallCeiling(
        env.LITEAPI_SNAPSHOT_ORIGINS.length,
        destinations.length,
        WINDOW_OFFSET_DAYS.length,
        refreshes,
      );
      const usedToday = await repo.callsSince(startOfUtcDay(now()), FLIGHTS_JOB);
      const budget = Math.min(maxCalls, ceiling - usedToday);
      if (budget < 1) {
        log.warn({ runId, origin, destination, usedToday, ceiling }, 'daily call ceiling reached');
        await repo.finishRun(runId, { status: 'skipped_cap', callsMade });
        return;
      }

      const limiter = dependencies.limiter ?? liteapiLimiterPool.for('liteapi', 1);
      const client = (dependencies.createClient ?? defaultClient)(env, now);

      const spend = <T>(call: () => Promise<ProviderResult<T>>): Promise<T> => {
        if (callsMade >= budget) throw new CapReached();
        callsMade += 1;
        // Only the leaf call holds the slot.
        return limiter.run(call).then((result) => {
          if (!result.ok) throw new RunFailure(result.error.code);
          return result.value;
        });
      };

      const fetched = await spend(() =>
        client.fetchOffers({
          origin: target.origin,
          destination: target.destination.code,
          departureDate: target.departureDate,
          returnDate: target.returnDate,
          adults: target.adults,
          currency: target.currency,
          cabin: target.cabin,
        }),
      );

      if (fetched.length === 0) {
        log.info({ runId, origin, destination }, 'liteapi returned no flights; nothing stored');
        await repo.finishRun(runId, { status: 'ok', callsMade });
        return;
      }

      // The cheapest few, then checked exactly as a reader will check them.
      const offers = [...fetched]
        .sort((a, b) => a.price.amount - b.price.amount)
        .slice(0, MAX_STORED_OFFERS);
      const stored = toStoredFlights(offers);
      const checked = readStoredFlights(
        FLIGHTS_STORED_SCHEMA_VERSION,
        JSON.parse(JSON.stringify(stored)),
      );
      if (!checked.ok) throw new RunFailure('INTERNAL_ERROR');

      // The row's instant is the call's own instant, which every offer carries.
      const observedAt = offers[0]!.observedAt;
      const row: LiteApiFlightsRow = {
        ...flightTargetKey(target),
        environment,
        schemaVersion: FLIGHTS_STORED_SCHEMA_VERSION,
        offers: stored,
        observedAt,
        expiresAt: new Date(Date.parse(observedAt) + snapshotTtlMs(refreshes)).toISOString(),
        runId,
      };
      await repo.putFlights(row);
      await repo.finishRun(runId, { status: 'ok', callsMade });
    } catch (error) {
      const capped = error instanceof CapReached;
      const code = codeOf(error);
      log.warn(
        {
          runId,
          origin,
          destination,
          departureDate,
          returnDate,
          code: capped ? 'CALL_CAP' : code,
          callsMade,
        },
        capped
          ? 'liteapi flights run stopped at its call cap'
          : 'liteapi flights run failed; the previous row is kept',
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
          'could not record the end of a flights run',
        );
      }
      // Never rethrown: a retry would spend more vendor calls on the same failure.
    }
  };
}

/**
 * The target a payload names, or null. It must be one of our origins and one of our launch
 * destinations, not the same place, four nights, and a departure near today plus the window
 * offsets: so a stray job can never ask the vendor about a route or a date we did not choose.
 */
function findTarget(
  destinations: readonly LaunchDestination[],
  env: FlightsEnv,
  now: number,
  payload: { origin: string; destination: string; departureDate: string; returnDate: string },
): FlightTarget | null {
  const origin = payload.origin.toUpperCase();
  if (!env.LITEAPI_SNAPSHOT_ORIGINS.includes(origin)) return null;
  const destination = destinations.find((entry) => entry.code === payload.destination);
  if (!destination || destination.code === origin) return null;
  if (!isIsoDate(payload.departureDate) || !isIsoDate(payload.returnDate)) return null;
  if (daysBetween(payload.departureDate, payload.returnDate) !== WINDOW_NIGHTS) return null;

  const offset = daysBetween(todayOf(now), payload.departureDate);
  const lowest = Math.min(...WINDOW_OFFSET_DAYS) - 1;
  const highest = Math.max(...WINDOW_OFFSET_DAYS) + 1;
  if (offset < lowest || offset > highest) return null;

  return {
    origin,
    destination,
    departureDate: payload.departureDate,
    returnDate: payload.returnDate,
    adults: FLIGHT_ADULTS,
    currency: FLIGHT_CURRENCY,
    cabin: FLIGHT_CABIN,
  };
}
