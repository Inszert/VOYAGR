import type { StayOffer, StayQuery } from '@/core/stay/types';
import { getRepositories } from '@/db';
import type { LiteApiSnapshotRepository } from '@/db/repository';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { classifySnapshot, type SnapshotState } from './staleness';
import { readStoredRates } from './stored-schema';
import { ratesKey } from './targets';

/**
 * The read path: what a visitor's page sees of the LiteAPI snapshot.
 *
 * Reads our own database and nothing else. This file imports no vendor client and no fetch, and
 * `import-guard.test.ts` keeps it that way. A row that is missing, expired, written under
 * another schema version or damaged is "missing": no price, and a plain line saying so.
 */

const log = getLogger('liteapi-snapshot.read');

export interface SnapshotStatus {
  readonly state: SnapshotState;
  readonly observedAt: string | null;
  /** Whole hours old. Null when there is no row, or when its date is not believed. */
  readonly ageHours: number | null;
  /** True when the data is the provider's sandbox: shown with a "Test prices" note. */
  readonly testPrices: boolean;
}

export interface SnapshotRead {
  readonly status: SnapshotStatus;
  /** Empty unless the row is usable. Never a live call's answer. */
  readonly offers: readonly StayOffer[];
}

export interface SnapshotReadDependencies {
  readonly repository: Pick<LiteApiSnapshotRepository, 'getRates'>;
  readonly refreshesPerDay: number;
  readonly guestNationality: string;
}

function defaultDependencies(): SnapshotReadDependencies {
  const env = getEnv();
  return {
    repository: getRepositories().liteapiSnapshot,
    refreshesPerDay: env.LITEAPI_SNAPSHOT_REFRESHES_PER_DAY,
    guestNationality: env.LITEAPI_GUEST_NATIONALITY,
  };
}

const MISSING: SnapshotRead = {
  status: { state: 'missing', observedAt: null, ageHours: null, testPrices: false },
  offers: [],
};

/** The stored answer for one stay query, with how old it is. */
export async function readSnapshot(
  query: StayQuery,
  now: number,
  dependencies: SnapshotReadDependencies = defaultDependencies(),
): Promise<SnapshotRead> {
  // A search with no destination code, or a party the snapshot does not price, has no row.
  if (!query.destination.code) return MISSING;

  const row = await dependencies.repository.getRates(
    ratesKey({
      destinationCode: query.destination.code,
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      occupancy: query.occupancy,
      currency: query.currency,
      guestNationality: dependencies.guestNationality,
    }),
  );
  if (!row) return MISSING;

  const stored = readStoredRates(row.schemaVersion, row.rates);
  if (!stored.ok) {
    log.warn(
      { reason: stored.reason, destination: row.destinationCode },
      'unreadable snapshot row',
    );
    return MISSING;
  }

  const staleness = classifySnapshot(row, now, dependencies.refreshesPerDay);
  if (staleness.state === 'missing') return MISSING;

  const testPrices =
    row.environment === 'sandbox' ||
    stored.offers.some((offer) => offer.rates.some((rate) => rate.source.provenance === 'test'));

  return {
    status: {
      state: staleness.state,
      observedAt: staleness.observedAt,
      ageHours: staleness.ageHours,
      testPrices,
    },
    offers: stored.offers,
  };
}

/** The freshness of the stored answer for one stay query. */
export async function snapshotStatus(
  query: StayQuery,
  now: number,
  dependencies?: SnapshotReadDependencies,
): Promise<SnapshotStatus> {
  return (await readSnapshot(query, now, dependencies)).status;
}
