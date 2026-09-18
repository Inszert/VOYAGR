import { ok } from '@/lib/result';
import { deterministicSource, MOCK_OBSERVED_AT } from '../fixtures/deterministic';
import { resolveDestination } from '../fixtures/destinations';
import type {
  Place,
  PlaceCategory,
  PlacesProvider,
  PlacesQuery,
  ProviderHealth,
  ProviderRequestOptions,
  ProviderResult,
} from '../types';

/**
 * Mock places provider.
 *
 * Feeds the restaurant and activity planning surfaces (specification sections 11
 * and 12) with deterministic fixtures. Licensing for real restaurant and
 * activity data is an open question in section 22, so keeping this behind the
 * adapter interface matters more here than anywhere else.
 */

const NAME_PARTS: Record<PlaceCategory, readonly string[]> = {
  restaurant: ['Taverna', 'Trattoria', 'Meze House', 'Ocakbasi', 'Grill', 'Kitchen'],
  cafe: ['Cafe', 'Kaffeehaus', 'Espresso Bar', 'Bakery'],
  beach: ['Beach', 'Cove', 'Bay', 'Lido'],
  attraction: ['Museum', 'Old Town', 'Fortress', 'Cathedral', 'Viewpoint'],
  activity: ['Boat Trip', 'Diving Centre', 'Walking Tour', 'Cooking Class'],
  nightlife: ['Rooftop Bar', 'Wine Bar', 'Beach Club', 'Live Music Bar'],
};

const QUALIFIERS = ['Central', 'Old Port', 'Marina', 'Hilltop', 'Seaside', 'Garden'] as const;

export class MockPlacesProvider implements PlacesProvider {
  readonly metadata = {
    id: 'mock-places',
    kind: 'places',
    displayName: 'Mock Places Provider',
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

  async searchPlaces(
    query: PlacesQuery,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly Place[]>> {
    const profile = resolveDestination(query.destination);
    const perCategory = Math.max(
      1,
      Math.floor((query.maxResults ?? 12) / Math.max(1, query.categories.length)),
    );
    const places: Place[] = [];

    for (const category of query.categories) {
      // A landlocked destination has no beaches to return.
      if (category === 'beach' && !profile.hasBeach) continue;

      for (let index = 0; index < perCategory; index += 1) {
        const random = deterministicSource(`${query.destination}|${category}|${index}`);
        const parts = NAME_PARTS[category];

        places.push({
          id: `mock-place-${query.destination}-${category}-${index}`,
          providerId: this.metadata.id,
          name: `${random.pick(parts)} ${random.pick(QUALIFIERS)}`,
          category,
          priceLevel: category === 'beach' || category === 'attraction' ? null : random.int(1, 4),
          rating: Math.round(random.float(3.6, 4.9) * 10) / 10,
          ratingCount: random.int(24, 2400),
          distanceFromCentreMetres: random.int(80, 5200),
        });
      }
    }

    return ok(
      places.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, query.maxResults ?? 12),
    );
  }
}

export function createMockPlacesProvider(): PlacesProvider {
  return new MockPlacesProvider();
}

/** Re-exported so callers can assert the fixture timestamp in tests. */
export { MOCK_OBSERVED_AT };
