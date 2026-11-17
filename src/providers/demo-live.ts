import type { StayOffer, StayQuery } from '@/core/stay/types';
import type { FlightOffer } from '@/core/trip/types';
import { demoLiveAllowed, getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import { LAUNCH_DESTINATIONS } from '@/liteapi-snapshot/targets';
import { LiteApiFlightsClient, type LiteApiFlightsQuery } from './flights/liteapi';
import { LiteApiStayProvider } from './stays/liteapi';
import type { ProviderResult } from './types';

/**
 * DEMO ONLY: live LiteAPI SANDBOX calls from a visitor's search.
 *
 * This is a deliberate, owner-approved exception to "a visitor makes zero vendor calls", made so
 * the product can be tested against real sandbox responses (sandbox prices are not real). It is
 * locked three ways: `demoLiveAllowed` (DEMO_MODE on, a `sand_` key, not the production host),
 * `parseEnv` refusing to start when DEMO_MODE is on and the guard fails, and a per-process cap.
 * With DEMO_MODE off (the default, and production) `defaultDemoLive()` is null and nothing here
 * runs. This module is the only visitor-reachable file allowed to import the live adapters; the
 * import guard test names it.
 *
 * Answers are cached in memory for an hour, and live calls are counted per process: after
 * `DEMO_CALL_LIMIT` the call is refused with a plain error rather than spent.
 */

const log = getLogger('providers.demo-live');

export const DEMO_CALL_LIMIT = 200;
export const DEMO_CACHE_MS = 60 * 60 * 1000;

/** The part of the live flights client the demo uses. */
export interface DemoFlightsClient {
  fetchOffers(query: LiteApiFlightsQuery): Promise<ProviderResult<readonly FlightOffer[]>>;
}

/** The part of the live stays adapter the demo uses. */
export interface DemoStaysClient {
  searchStays(query: StayQuery): Promise<ProviderResult<readonly StayOffer[]>>;
}

export interface DemoLiveOptions {
  readonly flights: DemoFlightsClient;
  readonly stays: DemoStaysClient;
  readonly now?: () => number;
  readonly limit?: number;
}

interface Entry<T> {
  readonly at: number;
  readonly value: T;
}

export interface DemoLive {
  flights(query: LiteApiFlightsQuery): Promise<ProviderResult<readonly FlightOffer[]>>;
  stays(query: StayQuery): Promise<ProviderResult<readonly StayOffer[]>>;
  /** True when a cached (not live) stay answer for the query exists: what "Test prices" reads. */
  hasStays(query: StayQuery): boolean;
  /** Live calls made so far in this process. */
  readonly callCount: () => number;
}

/** A launch destination's position when the query names only a code. A fact, not a guess. */
function withPosition(query: StayQuery): StayQuery {
  if (query.destination.position || !query.destination.code) return query;
  const code = query.destination.code.toUpperCase();
  const known = LAUNCH_DESTINATIONS.find((destination) => destination.code === code);
  if (!known) return query;
  return { ...query, destination: { ...query.destination, position: known.position } };
}

const flightsKeyOf = (q: LiteApiFlightsQuery) =>
  [q.origin, q.destination, q.departureDate, q.returnDate, q.adults, q.currency, q.cabin]
    .map(String)
    .join('|')
    .toUpperCase();

const staysKeyOf = (q: StayQuery) =>
  [
    q.destination.code ?? '',
    q.destination.position
      ? `${q.destination.position.latitude},${q.destination.position.longitude}`
      : '',
    q.checkIn,
    q.checkOut,
    q.occupancy.adults,
    q.occupancy.children,
    q.occupancy.rooms,
    q.currency,
  ]
    .map(String)
    .join('|')
    .toUpperCase();

export function createDemoLive(options: DemoLiveOptions): DemoLive {
  const now = options.now ?? Date.now;
  const limit = options.limit ?? DEMO_CALL_LIMIT;
  const flightCache = new Map<string, Entry<readonly FlightOffer[]>>();
  const stayCache = new Map<string, Entry<readonly StayOffer[]>>();
  let calls = 0;

  const fresh = <T>(entry: Entry<T> | undefined): entry is Entry<T> =>
    entry !== undefined && now() - entry.at < DEMO_CACHE_MS;

  /** Takes one live call from the budget, or says plainly that none is left. */
  const take = (): boolean => {
    if (calls >= limit) return false;
    calls += 1;
    log.info({ calls, limit }, 'demo live sandbox call');
    return true;
  };

  const refused = () =>
    err(
      new AppError(
        'PROVIDER_UNAVAILABLE',
        `The demo call limit was reached (${limit} live sandbox calls per process).`,
      ),
    );

  return {
    callCount: () => calls,

    async flights(query) {
      const key = flightsKeyOf(query);
      const hit = flightCache.get(key);
      if (fresh(hit)) return ok(hit.value);
      if (!take()) return refused();
      const result = await options.flights.fetchOffers(query);
      if (result.ok) flightCache.set(key, { at: now(), value: result.value });
      else log.warn({ code: result.error.code }, 'demo live flights call failed');
      return result;
    },

    async stays(rawQuery) {
      const query = withPosition(rawQuery);
      const key = staysKeyOf(query);
      const hit = stayCache.get(key);
      if (fresh(hit)) return ok(hit.value);
      if (!take()) return refused();
      const result = await options.stays.searchStays(query);
      if (result.ok) stayCache.set(key, { at: now(), value: result.value });
      else log.warn({ code: result.error.code }, 'demo live stays call failed');
      return result;
    },

    hasStays(rawQuery) {
      return fresh(stayCache.get(staysKeyOf(withPosition(rawQuery))));
    },
  };
}

declare global {
  var __voyagrDemoLive: DemoLive | undefined;
}

/**
 * The process's demo live path, or null. Null unless the guard passes, so with DEMO_MODE off the
 * readers behave exactly as they did. Held on `globalThis` so the count and cache are shared by
 * every bundle in the process.
 */
export function defaultDemoLive(): DemoLive | null {
  const env = getEnv();
  if (!demoLiveAllowed(env).ok || !env.LITEAPI_API_KEY) return null;
  globalThis.__voyagrDemoLive ??= createDemoLive({
    flights: new LiteApiFlightsClient({ apiKey: env.LITEAPI_API_KEY }),
    stays: new LiteApiStayProvider({
      apiKey: env.LITEAPI_API_KEY,
      guestNationality: env.LITEAPI_GUEST_NATIONALITY,
    }),
  });
  return globalThis.__voyagrDemoLive;
}
