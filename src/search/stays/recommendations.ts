import type { Money } from '@/core/money';
import { format } from '@/core/money';
import { cheapestRate } from '@/core/stay/comparison';
import { pickRecommendations, type RecommendCandidate } from '@/core/stay/recommend';
import type { StayProperty } from '@/core/stay/types';
import { getRepositories } from '@/db';
import type {
  LiteApiEnvironment,
  LiteApiSnapshotRepository,
  VisitorSearchRepository,
} from '@/db/repository';
import { getEnv, liteApiEnvironment } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { readStoredRates } from '@/liteapi-snapshot/stored-schema';

/**
 * Hotel recommendations for the stays start page.
 *
 * Reads the stored snapshot from our own database and nothing else: no vendor call, no live
 * adapter. A hotel with no usable rate is still a card (content only) with `price: null`.
 * The price is the cheapest stored total in one currency. A tax payable at the hotel is never
 * part of it.
 */

const log = getLogger('search.stays.recommendations');

const ROW_LIMIT = 12;
const SEARCH_LIMIT = 100;

export interface RecommendationPrice {
  /** The whole stay, as quoted. Never includes anything payable at the hotel. */
  readonly total: Money;
  readonly perNight: Money;
  readonly totalLabel: string;
  readonly perNightLabel: string;
  /** The provider's sandbox: shown with a "Test prices" note. */
  readonly testPrices: boolean;
}

export interface RecommendationCard extends RecommendCandidate {
  readonly name: string;
  readonly photoUrl: string | null;
  readonly stars: number | null;
  readonly guestRating: number | null;
  readonly price: RecommendationPrice | null;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly observedAt: string;
  readonly testPrices: boolean;
}

export interface RecommendationDependencies {
  readonly repository: Pick<LiteApiSnapshotRepository, 'recentRates'>;
  /** Recent visitor searches. Absent means the stored prices alone choose. */
  readonly searches?: Pick<VisitorSearchRepository, 'listRecent'>;
  readonly environment: LiteApiEnvironment;
  readonly now: number;
}

function defaultDependencies(): RecommendationDependencies {
  return {
    repository: getRepositories().liteapiSnapshot,
    searches: getRepositories().visitorSearches,
    environment: liteApiEnvironment(getEnv()) ?? 'sandbox',
    now: Date.now(),
  };
}

function isUnexpired(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return true;
  const instant = Date.parse(expiresAt);
  return Number.isNaN(instant) || instant > now;
}

function toCard(
  property: StayProperty,
  rates: readonly import('@/core/stay/types').StayRate[],
  row: { destinationCode: string; checkIn: string; checkOut: string; observedAt: string },
  rowIsTest: boolean,
  now: number,
): RecommendationCard {
  const best = cheapestRate(rates.filter((rate) => isUnexpired(rate.expiresAt, now)));
  const testPrices = rowIsTest || best?.source.provenance === 'test';
  return {
    hotelKey: property.id,
    cityCode: row.destinationCode,
    hasPhoto: property.photos.length > 0,
    name: property.name,
    photoUrl: property.photos[0]?.url ?? null,
    stars: property.starRating,
    guestRating: property.guestRating?.outOfTen ?? null,
    price: best
      ? {
          total: best.total,
          perNight: best.perNight,
          totalLabel: format(best.total),
          perNightLabel: format(best.perNight),
          testPrices,
        }
      : null,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    observedAt: row.observedAt,
    testPrices,
  };
}

/** Up to `count` deterministic recommendations from the stored snapshot. */
export async function loadRecommendations(
  options: { readonly seed: string; readonly count: number; readonly exclude?: readonly string[] },
  dependencies?: RecommendationDependencies,
): Promise<RecommendationCard[]> {
  const deps = dependencies ?? defaultDependencies();
  const allRows = await deps.repository.recentRates({
    environment: deps.environment,
    limit: ROW_LIMIT,
  });
  /*
   * What visitors searched for comes first: the stored hotels and prices of each recently searched
   * destination. With no recent searches, or none we hold prices for, the newest stored rows
   * stand in. Either way it is our own database; no vendor is called.
   */
  const searched = await deps.searches
    ?.listRecent({ limit: SEARCH_LIMIT })
    .catch((error: unknown) => {
      log.warn({ error: error instanceof Error ? error.message : 'unknown' }, 'searches unread');
      return [];
    });
  const searchedCodes = new Set((searched ?? []).map((search) => search.destinationCode));
  const fromSearches = allRows.filter((row) => searchedCodes.has(row.destinationCode));
  const rows = fromSearches.length > 0 ? fromSearches : allRows;

  // Newest row first; a hotel seen twice keeps its newest, priced card.
  const byHotel = new Map<string, RecommendationCard>();
  for (const row of rows) {
    if (!isUnexpired(row.expiresAt, deps.now)) continue;
    const stored = readStoredRates(row.schemaVersion, row.rates);
    if (!stored.ok) {
      log.warn({ reason: stored.reason, destination: row.destinationCode }, 'unreadable row');
      continue;
    }
    for (const offer of stored.offers) {
      const card = toCard(
        offer.property,
        offer.rates,
        row,
        row.environment === 'sandbox',
        deps.now,
      );
      const existing = byHotel.get(card.hotelKey);
      if (!existing || (existing.price === null && card.price !== null)) {
        byHotel.set(card.hotelKey, card);
      }
    }
  }

  return pickRecommendations([...byHotel.values()], {
    seed: options.seed,
    exclude: options.exclude,
    count: options.count,
  });
}
