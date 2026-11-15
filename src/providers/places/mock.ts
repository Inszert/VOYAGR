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
  ThingKind,
  ThingToDo,
  ThingsToDoQuery,
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

/**
 * Fixture things to do: invented names, plainly generic, one or two a group.
 * They exist so the section can be built and tested with no network; the page
 * says they are samples whenever the provider is a mock.
 */
const SAMPLE_THINGS: readonly { kind: ThingKind; title: string; description: string | null }[] = [
  { kind: 'sights', title: 'Old Town Gate', description: 'Sample entry: a historic gate' },
  { kind: 'sights', title: 'Clock Tower', description: null },
  { kind: 'museums', title: 'City Museum', description: 'Sample entry: a local history museum' },
  { kind: 'museums', title: 'Maritime Museum', description: null },
  { kind: 'outdoors', title: 'Seaside Park', description: 'Sample entry: a public park' },
  { kind: 'outdoors', title: 'Hilltop Viewpoint', description: null },
  { kind: 'neighbourhoods', title: 'Old Quarter', description: 'Sample entry: a historic quarter' },
  { kind: 'food', title: 'Central Market', description: 'Sample entry: a covered market' },
  { kind: 'culture', title: 'Municipal Theatre', description: 'Sample entry: a theatre' },
];

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

  async thingsToDo(
    query: ThingsToDoQuery,
    _options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly ThingToDo[]>> {
    const things = SAMPLE_THINGS.map((sample, index): ThingToDo => {
      const random = deterministicSource(`${query.destination}|thing|${index}`);

      return {
        id: `mock-thing-${query.destination}-${index}`,
        providerId: this.metadata.id,
        name: `${query.destinationName} ${sample.title}`,
        kind: sample.kind,
        description: sample.description,
        latitude: query.position[1],
        longitude: query.position[0],
        distanceFromCentreMetres: random.int(150, 9000),
        notability: random.int(2, 40),
        wikipediaUrl: null,
        imageFile: null,
      };
    }).sort((a, b) => b.notability - a.notability || a.id.localeCompare(b.id, 'en'));

    return ok(things.slice(0, query.maxResults ?? 60));
  }
}

export function createMockPlacesProvider(): PlacesProvider {
  return new MockPlacesProvider();
}

/** Re-exported so callers can assert the fixture timestamp in tests. */
export { MOCK_OBSERVED_AT };
