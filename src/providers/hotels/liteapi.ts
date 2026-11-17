import type { HotelOffer } from '@/core/trip/types';
import type { StayOffer, StayQuery, StayRate } from '@/core/stay/types';
import { liteApiEnvironment, type Env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import { readSnapshot, type SnapshotReadDependencies } from '@/liteapi-snapshot/read';
import { defaultDemoLive, type DemoLive } from '../demo-live';
import type {
  HotelProvider,
  HotelSearchQuery,
  ProviderHealth,
  ProviderPage,
  ProviderResult,
} from '../types';

/**
 * The trip search's hotel slot for LiteAPI, answered from our own snapshot.
 *
 * Like `providers/stays/snapshot.ts` this makes **no vendor call, ever**: it reads the rows the
 * worker's scheduled refresh wrote (`src/liteapi-snapshot/job.ts`) and imports neither the live
 * adapter nor `fetch`. `src/liteapi-snapshot/import-guard.test.ts` holds that.
 *
 * What it answers, per property, is the cheapest rate that fits the query. A destination, window
 * or party with no usable row answers an empty page: the trip is then assembled with no stay and
 * the cost engine says "Stay not priced". It is never a zero and never an error.
 *
 * Payable-at-the-hotel money becomes `excludedFees`, which the cost engine keeps outside every
 * total.
 */

const log = getLogger('providers.hotels.snapshot');

export const SNAPSHOT_HOTEL_PROVIDER_ID = 'liteapi';

export interface SnapshotHotelProviderOptions {
  /** Defaults to the real repositories and env, resolved on each search. */
  readonly dependencies?: () => SnapshotReadDependencies;
  readonly now?: () => number;
  /** DEMO ONLY: undefined resolves from the environment (null unless allowed); null is off. */
  readonly demoLive?: DemoLive | null;
}

export function createSnapshotHotelProvider(
  env: Pick<Env, 'LITEAPI_API_KEY'>,
  options: SnapshotHotelProviderOptions = {},
): SnapshotHotelProvider {
  const mode = liteApiEnvironment(env);
  log.info({ mode }, 'liteapi snapshot hotel provider enabled');
  return new SnapshotHotelProvider(mode === 'sandbox' ? 'test' : 'live', options);
}

/** The trip search asks about a party of `guests` in one room. */
function stayQueryFor(query: HotelSearchQuery): StayQuery {
  return {
    destination: { code: query.destination, name: null, position: null, radiusKm: null },
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    occupancy: { adults: query.guests, children: 0, rooms: 1 },
    currency: query.currency,
  };
}

/** The cheapest rate in the query's currency; refundable ones only when that is required. */
function cheapestRate(rates: readonly StayRate[], query: HotelSearchQuery): StayRate | null {
  let best: StayRate | null = null;
  for (const rate of rates) {
    if (rate.total.currency !== query.currency) continue;
    if (query.freeCancellationOnly === true && rate.cancellation.refundable !== true) continue;
    if (best === null || rate.total.amount < best.total.amount) best = rate;
  }
  return best;
}

function toHotelOffer(offer: StayOffer, rate: StayRate): HotelOffer {
  const { property } = offer;
  const photos = property.photos
    .map((photo) => photo.url)
    .filter((url) => url.startsWith('https://'));

  return {
    id: rate.id,
    providerId: SNAPSHOT_HOTEL_PROVIDER_ID,
    name: property.name,
    starRating: property.starRating,
    reviewScore: property.guestRating?.outOfTen ?? null,
    reviewCount: property.guestRating?.reviewCount ?? 0,
    // The snapshot holds no distances, and a distance nobody stated stays null.
    distanceToBeachMetres: null,
    distanceToCentreMetres: null,
    // `HotelOffer` has no unknown for these two: an unstated board reads as room only, and
    // anything but a stated refundable rate reads as not free to cancel.
    boardType: rate.board ?? 'room_only',
    freeCancellation: rate.cancellation.refundable === true,
    rooms: rate.occupancy.rooms,
    photoUrls: photos.length > 0 ? photos.slice(0, 20) : null,
    position: property.position ? [property.position.longitude, property.position.latitude] : null,
    area: null,
    totalPrice: rate.total,
    // Paid to the property: shown beside the price, never part of any total.
    excludedFees: rate.payableAtProperty,
    observedAt: rate.observedAt,
  };
}

export class SnapshotHotelProvider implements HotelProvider {
  readonly metadata: HotelProvider['metadata'];

  constructor(
    mode: 'test' | 'live',
    private readonly options: SnapshotHotelProviderOptions = {},
  ) {
    this.metadata = {
      id: SNAPSHOT_HOTEL_PROVIDER_ID,
      kind: 'hotels',
      displayName: 'LiteAPI',
      isMock: false,
      mode,
      rateLimitPerMinute: null,
    };
  }

  async checkHealth(): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      checkedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
      latencyMs: null,
      message: 'Reads stored prices; no vendor call is made.',
    };
  }

  async searchHotels(query: HotelSearchQuery): Promise<ProviderResult<ProviderPage<HotelOffer>>> {
    try {
      const read = await readSnapshot(
        stayQueryFor(query),
        (this.options.now ?? Date.now)(),
        this.options.dependencies?.(),
      );

      let stays: readonly StayOffer[] = read.offers;
      if (stays.length === 0) {
        // DEMO ONLY: no stored row, so ask the sandbox live (cached, counted, guarded).
        const demo =
          this.options.demoLive === undefined ? defaultDemoLive() : this.options.demoLive;
        if (demo) {
          const live = await demo.stays(stayQueryFor(query));
          if (live.ok) stays = live.value;
        }
      }

      const offers: HotelOffer[] = [];
      for (const stay of stays) {
        const rate = cheapestRate(stay.rates, query);
        if (rate === null) continue;
        const offer = toHotelOffer(stay, rate);
        if (
          query.minReviewScore !== undefined &&
          offer.reviewScore !== null &&
          offer.reviewScore < query.minReviewScore
        ) {
          continue;
        }
        offers.push(offer);
      }

      offers.sort((a, b) => a.totalPrice.amount - b.totalPrice.amount || a.id.localeCompare(b.id));
      const items = query.maxResults === undefined ? offers : offers.slice(0, query.maxResults);

      return ok({ items, nextCursor: null });
    } catch (error) {
      // Our own database, not the vendor: one fewer source, never an aborted search.
      log.warn(
        { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' },
        'snapshot read failed',
      );
      return err(
        new AppError('DEPENDENCY_UNAVAILABLE', 'The stored hotel prices could not be read.'),
      );
    }
  }
}
