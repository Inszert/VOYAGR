import { money } from '@/core/money';
import type { HotelOffer } from '@/core/trip/types';
import { ok } from '@/lib/result';
import { nightsBetween } from '@/core/dates';
import { deterministicSource, MOCK_OBSERVED_AT } from '../fixtures/deterministic';
import { resolveDestination } from '../fixtures/destinations';
import type {
  HotelProvider,
  HotelSearchQuery,
  ProviderPage,
  ProviderHealth,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';

/**
 * Mock hotel provider.
 *
 * Deterministic fixtures covering the properties the ranking engine needs to
 * distinguish: location, board, cancellation terms, review depth and fees that
 * are excluded from the headline rate.
 */

const HOTEL_NAME_PREFIXES = ['Hotel', 'Casa', 'Villa', 'Aparthotel', 'Residence', 'Blue'] as const;
const HOTEL_NAME_SUFFIXES = [
  'Marina',
  'Bellavista',
  'Panorama',
  'Central',
  'Playa',
  'Riviera',
  'Garden',
  'Old Town',
] as const;

const BOARD_TYPES = ['room_only', 'breakfast', 'breakfast', 'half_board', 'all_inclusive'] as const;

function decodeHotelOffset(cursor: string | undefined): number {
  if (!cursor) return 0;

  const parsed = Number.parseInt(cursor.replace('mock-page-', ''), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export class MockHotelProvider implements HotelProvider {
  readonly metadata = {
    id: 'mock-hotels',
    kind: 'hotels',
    displayName: 'Mock Hotel Provider',
    isMock: true,
    rateLimitPerMinute: null,
  } as const;

  async checkHealth(_options?: ProviderRequestOptions): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      checkedAt: MOCK_OBSERVED_AT,
      latencyMs: 0,
      message: 'Mock provider; no network call performed.',
    };
  }

  async searchHotels(
    query: HotelSearchQuery,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ProviderPage<HotelOffer>>> {
    const nights = nightsBetween(query.checkIn, query.checkOut);
    if (nights <= 0) {
      return ok({ items: [], nextCursor: null });
    }

    const profile = resolveDestination(query.destination);
    const pageSize = query.maxResults ?? 8;
    const offers: HotelOffer[] = [];

    // Generated beyond one page so the cursor has somewhere to go.
    const generated = pageSize * 3;

    for (let index = 0; index < generated; index += 1) {
      const seed = `${query.destination}|${query.checkIn}|${query.checkOut}|${query.guests}|${index}`;
      const random = deterministicSource(seed);

      const starRating = random.int(2, 5);
      // Review scores cluster high, as they do on real booking sites.
      const reviewScore = Math.round(random.float(6.4, 9.6) * 10) / 10;
      const reviewCount = random.int(18, 3200);

      const distanceToBeachMetres = profile.hasBeach ? random.int(60, 3400) : null;
      const distanceToCentreMetres = random.int(120, 4200);

      const boardType = random.pick(BOARD_TYPES);
      const freeCancellation = random.chance(0.55);

      // Nightly rate rises with stars, review score and proximity to the beach.
      const starFactor = 0.62 + starRating * 0.16;
      const reviewFactor = 0.85 + (reviewScore - 6.4) * 0.07;
      const locationFactor =
        distanceToBeachMetres === null ? 1 : 1.25 - Math.min(0.4, distanceToBeachMetres / 8000);
      const boardFactor =
        boardType === 'all_inclusive' ? 1.45 : boardType === 'half_board' ? 1.22 : 1;
      const cancellationFactor = freeCancellation ? 1.08 : 1;

      const nightlyCents = Math.round(
        profile.baselineHotelNightlyCents *
          starFactor *
          reviewFactor *
          locationFactor *
          boardFactor *
          cancellationFactor *
          random.float(0.88, 1.16),
      );

      // Extra guests share a room but push the rate up.
      const occupancyFactor = 1 + Math.max(0, query.guests - 2) * 0.28;
      const totalCents = Math.round(nightlyCents * nights * occupancyFactor);

      // Some properties charge a city tax on arrival rather than in the rate.
      const hasExcludedFees = random.chance(0.35);
      const excludedFeesCents = hasExcludedFees ? random.int(150, 400) * nights * query.guests : 0;

      const offer: HotelOffer = {
        id: `mock-hotel-${query.destination}-${query.checkIn}-${index}`,
        providerId: this.metadata.id,
        name: `${random.pick(HOTEL_NAME_PREFIXES)} ${random.pick(HOTEL_NAME_SUFFIXES)}`,
        starRating,
        reviewScore,
        reviewCount,
        distanceToBeachMetres,
        distanceToCentreMetres,
        boardType,
        freeCancellation,
        // The mock prices one shared room for the party; see occupancyFactor.
        rooms: 1,
        totalPrice: money(totalCents, query.currency),
        excludedFees: excludedFeesCents > 0 ? money(excludedFeesCents, query.currency) : null,
        observedAt: MOCK_OBSERVED_AT,
        deepLink: undefined,
      };

      // Filters are applied here rather than downstream so the adapter behaves
      // like a real provider that honours its own query parameters.
      if (query.minReviewScore !== undefined && offer.reviewScore !== null) {
        if (offer.reviewScore < query.minReviewScore) continue;
      }
      if (query.freeCancellationOnly === true && !offer.freeCancellation) continue;

      offers.push(offer);
    }

    const sorted = offers.sort((a, b) => a.totalPrice.amount - b.totalPrice.amount);

    const offset = decodeHotelOffset(query.cursor);
    const page = sorted.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;

    return ok({
      items: page,
      nextCursor: nextOffset < sorted.length ? `mock-page-${nextOffset}` : null,
    });
  }
}

export function createMockHotelProvider(): HotelProvider {
  return new MockHotelProvider();
}
