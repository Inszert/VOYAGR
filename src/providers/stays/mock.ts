import { fromMajor } from '@/core/money';
import { nightsIn, type StayOffer, type StayQuery, type StayRate } from '@/core/stay/types';
import { hashString } from '../fixtures/deterministic';
import { ok } from '@/lib/result';
import type { ProviderResult } from '../types';
import type { StayProvider } from './types';

/**
 * A stay provider that invents nothing and repeats itself exactly.
 *
 * Kept for the same reasons the other mocks are: the suite must not need a
 * network, a credential or a vendor's sandbox, and a fixture that changes
 * between runs cannot be asserted against. Variation comes from a hash of
 * the query - never `Math.random`, never `new Date()`.
 *
 * It is also the reference implementation of the provider contract. If a new
 * adapter cannot satisfy the same tests this one does, the adapter is wrong.
 */

const PROPERTIES = [
  {
    id: 'seaside',
    name: 'Hotel Marina',
    propertyType: 'hotel',
    starRating: 4,
    position: { latitude: 41.3851, longitude: 2.1734 },
    amenities: ['wifi', 'pool', 'air conditioning'],
  },
  {
    id: 'oldtown',
    name: 'Casa Antiga',
    propertyType: 'apartment',
    starRating: 3,
    position: { latitude: 41.3809, longitude: 2.1775 },
    amenities: ['wifi', 'kitchen'],
  },
  {
    id: 'parkside',
    name: 'Parkside Residence',
    propertyType: 'hotel',
    starRating: 5,
    position: { latitude: 41.3925, longitude: 2.1649 },
    amenities: ['wifi', 'spa', 'gym', 'breakfast'],
  },
] as const;

/** Two rates per property, deliberately differing in their conditions. */
const RATE_SHAPES = [
  {
    suffix: 'flex',
    roomName: 'Double room',
    board: 'breakfast' as const,
    refundable: true,
    paymentTiming: 'pay_later' as const,
    benefits: ['Breakfast included', 'Free cancellation'],
    premium: 1.18,
  },
  {
    suffix: 'saver',
    roomName: 'Double room',
    board: 'room_only' as const,
    refundable: false,
    paymentTiming: 'pay_now' as const,
    benefits: [],
    premium: 1,
  },
];

export class MockStayProvider implements StayProvider {
  readonly metadata = {
    id: 'mock-stays',
    kind: 'stays',
    displayName: 'Mock Stays',
    isMock: true,
    mode: 'mock',
    rateLimitPerMinute: null,
  } as const;

  async searchStays(query: StayQuery): Promise<ProviderResult<readonly StayOffer[]>> {
    const nights = nightsIn(query);
    const wanted = query.maxResults ?? PROPERTIES.length;

    const offers: StayOffer[] = PROPERTIES.slice(0, wanted).map((property) => {
      /*
       * The price moves with the dates, so the date calendar has something
       * real to show - and it moves deterministically, so a test can assert
       * which window is cheapest.
       */
      const seed = hashString(`${property.id}:${query.checkIn}:${query.occupancy.rooms}`);
      const perNightMajor = 70 + (seed % 60);

      const rates: StayRate[] = RATE_SHAPES.map((shape) => {
        const total = Math.round(perNightMajor * nights * shape.premium);

        return {
          id: `${this.metadata.id}:${property.id}:${shape.suffix}`,
          providerRateId: `${property.id}-${shape.suffix}`,
          providerRoomId: `${property.id}-room`,
          roomName: shape.roomName,
          bedConfiguration: '1 double bed',
          board: shape.board,
          cancellation: {
            refundable: shape.refundable,
            deadline: shape.refundable ? `${query.checkIn}T12:00:00Z` : null,
            description: shape.refundable
              ? 'Free cancellation until midday on the day of arrival.'
              : 'Non-refundable.',
          },
          paymentTiming: shape.paymentTiming,
          benefits: shape.benefits,
          total: fromMajor(total, query.currency),
          perNight: fromMajor(total / nights, query.currency),
          base: null,
          taxesAndFees: null,
          payableAtProperty: null,
          occupancy: query.occupancy,
          // Fixed, so a run is reproducible and freshness is assertable.
          observedAt: '2026-01-15T09:00:00Z',
          expiresAt: null,
          source: {
            part: 'stays',
            providerId: this.metadata.id,
            displayName: this.metadata.displayName,
            provenance: 'mock',
          },
        };
      });

      return {
        property: {
          id: `${this.metadata.id}:${property.id}`,
          providerPropertyId: property.id,
          name: property.name,
          description: null,
          photos: [],
          address: {
            line: null,
            city: query.destination.name,
            region: null,
            postcode: null,
            countryCode: null,
          },
          position: property.position,
          starRating: property.starRating,
          guestRating: {
            score: 8 + (hashString(property.id) % 15) / 10,
            scale: 10,
            outOfTen: 8 + (hashString(property.id) % 15) / 10,
            reviewCount: 100 + (hashString(property.id) % 900),
          },
          amenities: [...property.amenities],
          propertyType: property.propertyType,
        },
        rates,
      };
    });

    return ok(offers);
  }
}

export function createMockStayProvider(): StayProvider {
  return new MockStayProvider();
}
