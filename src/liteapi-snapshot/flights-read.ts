import type { FlightOffer } from '@/core/trip/types';
import { getRepositories } from '@/db';
import type { LiteApiFlightsKey, LiteApiSnapshotRepository } from '@/db/repository';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { readStoredFlights } from './flights-stored-schema';
import { flightsKey } from './flights-targets';
import { classifySnapshot, stalenessLine, type SnapshotState } from './staleness';

/**
 * The flights read path: what a visitor's page sees of the flights snapshot.
 *
 * Reads our own database and nothing else. This file imports no vendor client and no fetch, and
 * `import-guard.test.ts` keeps it that way. A row that is missing, expired, written under
 * another schema version or damaged is "missing": no LiteAPI price, and a plain line saying so.
 *
 * Freshness uses the hotel snapshot's four states and wording (`staleness.ts`), and every stored
 * flight price carries one fixed line, `flightFareLine(observedAt)`. Stored fares are shown as
 * indicative prices with the time they were seen. An offer's own `expiresAt` is information only:
 * it never hides an offer, and nothing here says an offer is valid until a time. A stored offer is
 * never sent to booking or prebook.
 */

const log = getLogger('liteapi-snapshot.flights-read');

/** The time of day an instant was seen, `HH:MM` in UTC, or null when it is not a real instant. */
function utcClock(observedAt: string): string | null {
  const ms = Date.parse(observedAt);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(11, 16);
}

/**
 * The fixed line under every stored flight price: when it was seen, in UTC, and that fares move.
 * Null when the observation time is not a real instant, because no time may then be claimed.
 */
export function flightFareLine(observedAt: string): string | null {
  const clock = utcClock(observedAt);
  return clock === null
    ? null
    : `Seen at ${clock} UTC. Fares change within minutes; check the airline before you book.`;
}

/** The hotel snapshot's "not loaded" line, for flights. */
export const FLIGHTS_MISSING_LINE = 'Flight prices are not loaded for these dates yet.';

export interface FlightSnapshotStatus {
  readonly state: SnapshotState;
  readonly observedAt: string | null;
  /** Whole hours old. Null when there is no row, or when its date is not believed. */
  readonly ageHours: number | null;
  /** True when the data is the provider's sandbox: shown with a "Test prices" note. */
  readonly testPrices: boolean;
}

export interface FlightSnapshotRead {
  readonly status: FlightSnapshotStatus;
  /** Empty unless the row is usable. An offer's own expiry does not hide it. */
  readonly offers: readonly FlightOffer[];
}

export interface FlightSnapshotReadDependencies {
  readonly repository: Pick<LiteApiSnapshotRepository, 'getFlights'>;
  readonly refreshesPerDay: number;
}

function defaultDependencies(): FlightSnapshotReadDependencies {
  return {
    repository: getRepositories().liteapiSnapshot,
    refreshesPerDay: getEnv().LITEAPI_SNAPSHOT_REFRESHES_PER_DAY,
  };
}

const MISSING: FlightSnapshotRead = {
  status: { state: 'missing', observedAt: null, ageHours: null, testPrices: false },
  offers: [],
};

/** The stored offers for one route, pair of days and party, with how old they are. */
export async function readFlightSnapshot(
  query: Omit<LiteApiFlightsKey, 'cabin'> & { readonly cabin?: string },
  now: number,
  dependencies: FlightSnapshotReadDependencies = defaultDependencies(),
): Promise<FlightSnapshotRead> {
  const row = await dependencies.repository.getFlights(flightsKey(query));
  if (!row) return MISSING;

  const stored = readStoredFlights(row.schemaVersion, row.offers);
  if (!stored.ok) {
    log.warn(
      { reason: stored.reason, origin: row.origin, destination: row.destination },
      'unreadable flights snapshot row',
    );
    return MISSING;
  }

  const staleness = classifySnapshot(row, now, dependencies.refreshesPerDay);
  if (staleness.state === 'missing') return MISSING;

  // The offer's own expiry is stored as information only; it never hides an indicative price.
  const offers = stored.offers;
  if (offers.length === 0) return MISSING;

  return {
    status: {
      state: staleness.state,
      observedAt: staleness.observedAt,
      ageHours: staleness.ageHours,
      testPrices: row.environment === 'sandbox',
    },
    offers,
  };
}

/** The freshness of the stored answer for one route and window. */
export async function flightSnapshotStatus(
  query: Omit<LiteApiFlightsKey, 'cabin'> & { readonly cabin?: string },
  now: number,
  dependencies?: FlightSnapshotReadDependencies,
): Promise<FlightSnapshotStatus> {
  return (await readFlightSnapshot(query, now, dependencies)).status;
}

/**
 * The sentence a page shows for a flights status: the hotel wording for `fresh` and `aging`, the
 * flights wording for `missing`, and none for `unknown` (no age claim may be made).
 */
export function flightStalenessLine(status: FlightSnapshotStatus): string | null {
  if (status.state === 'missing') return FLIGHTS_MISSING_LINE;
  return stalenessLine(status);
}
