import { describe, expect, it } from 'vitest';
import { buildRankedTrip } from '@/components/search/test-support';
import { summariseDestinations } from '@/search/destinations';
import type { SearchOutcome } from '@/search/types';
import {
  buildMapPoints,
  buildRoutes,
  groupByCountry,
  originsToGeoJson,
  routesToGeoJson,
  type DestinationGeo,
  type OriginPoint,
} from './map-model';

/**
 * Routes and countries on the globe.
 *
 * A route is drawn only where the search found a trip, a country group holds
 * exactly the destinations inside it, and nothing on the globe is a fact the
 * rail beside it does not also state.
 */

const PLACES: Record<string, DestinationGeo> = {
  AYT: { name: 'Antalya', country: 'Turkey', adm0: 'TUR', position: [30.79, 36.9], tier: 'major' },
  TBS: {
    name: 'Tbilisi',
    country: 'Georgia',
    adm0: 'GEO',
    position: [44.95, 41.67],
    tier: 'major',
  },
  BUS: { name: 'Batumi', country: 'Georgia', adm0: 'GEO', position: [41.6, 41.61], tier: 'major' },
  XXX: { name: 'Somewhere', country: 'Unknown', adm0: null, position: [10, 10], tier: 'major' },
};

const VIENNA: OriginPoint = { code: 'VIE', name: 'Vienna', adm0: 'AUT', position: [16.57, 48.11] };

const geo = (code: string) => PLACES[code] ?? null;

function outcomeOf(codes: readonly string[]): SearchOutcome {
  const trips = codes.map((destination, index) =>
    buildRankedTrip({
      id: `${destination}-${index}`,
      destination,
      destinationName: PLACES[destination]?.name ?? destination,
    }),
  );

  return {
    results: trips,
    nearMisses: [],
    routeOffers: [],
    destinationSummaries: summariseDestinations(trips),
    diagnostics: {},
  } as unknown as SearchOutcome;
}

describe('buildRoutes', () => {
  it('draws one route per origin and priced destination, ranked like the points', () => {
    const points = buildMapPoints({ outcome: outcomeOf(['AYT', 'TBS']), mode: 'cheapest', geo });
    const routes = buildRoutes(points, [VIENNA]);

    expect(routes.map((route) => [route.origin, route.destination, route.rank])).toEqual(
      points.map((point, rank) => ['VIE', point.destination, rank]),
    );
  });

  it('starts every route on its origin and ends it on its destination', () => {
    const points = buildMapPoints({ outcome: outcomeOf(['AYT']), mode: 'cheapest', geo });
    const [route] = buildRoutes(points, [VIENNA]);
    const segment = route!.path[0]!;

    expect(segment[0]).toEqual(VIENNA.position);
    expect(segment[segment.length - 1]).toEqual(PLACES.AYT!.position);
  });

  it('draws nothing from nowhere', () => {
    const points = buildMapPoints({ outcome: outcomeOf(['AYT']), mode: 'cheapest', geo });

    expect(buildRoutes(points, [])).toEqual([]);
  });
});

describe('routesToGeoJson', () => {
  it('flags the selected destination and nothing else', () => {
    const points = buildMapPoints({ outcome: outcomeOf(['AYT', 'TBS']), mode: 'cheapest', geo });
    const collection = routesToGeoJson(buildRoutes(points, [VIENNA]), 'TBS');

    const flagged = collection.features
      .filter((feature) => feature.properties.selected)
      .map((feature) => feature.properties.destination);

    expect(flagged).toEqual(['TBS']);
    expect(
      collection.features.every((feature) => feature.geometry.type === 'MultiLineString'),
    ).toBe(true);
  });
});

describe('originsToGeoJson', () => {
  it('places each origin where the catalogue says it is', () => {
    const collection = originsToGeoJson([VIENNA]);

    expect(collection.features[0]?.geometry.coordinates).toEqual([16.57, 48.11]);
    expect(collection.features[0]?.properties).toEqual({ code: 'VIE', name: 'Vienna' });
  });
});

describe('groupByCountry', () => {
  it('puts two Georgian airports in one group, in ranked order', () => {
    const points = buildMapPoints({
      outcome: outcomeOf(['TBS', 'AYT', 'BUS']),
      mode: 'cheapest',
      geo,
    });
    const groups = groupByCountry(points);
    const georgia = groups.find((group) => group.adm0 === 'GEO');

    expect(groups).toHaveLength(2);
    expect(georgia?.country).toBe('Georgia');
    expect(georgia?.points.map((point) => point.destination)).toEqual(
      points.filter((point) => point.adm0 === 'GEO').map((point) => point.destination),
    );
  });

  it('leaves out a place whose country it cannot name', () => {
    const points = buildMapPoints({ outcome: outcomeOf(['XXX', 'AYT']), mode: 'cheapest', geo });

    expect(groupByCountry(points).map((group) => group.adm0)).toEqual(['TUR']);
  });
});
