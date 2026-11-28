import { describe, expect, it } from 'vitest';
import { routesToGeoJson } from './map-model';
import {
  inBounds,
  loadStoredRoutes,
  WORLD,
  withStoredRoutes,
  type StoredRoute,
} from './stored-routes';

const stored = (destination: string, to: [number, number]): StoredRoute => ({
  origin: 'VIE',
  destination,
  from: [16.57, 48.11],
  to,
  carriers: ['FR'],
  lastSeenAt: '2026-11-20T00:00:00.000Z',
});

describe('stored routes', () => {
  it('handles a box that crosses the antimeridian', () => {
    const box = { west: 170, south: -50, east: -170, north: 50 };
    expect(inBounds([175, 0], box)).toBe(true);
    expect(inBounds([-175, 0], box)).toBe(true);
    expect(inBounds([0, 0], box)).toBe(false);
  });

  it('draws nothing for an origin it cannot place', async () => {
    const graph = { upsertEdges: async () => undefined, destinationsFor: async () => [] };
    expect(
      await loadStoredRoutes({ origin: 'VIE', bounds: WORLD, graph, positionOf: () => null }),
    ).toEqual([]);
  });

  it('adds only routes the page does not already draw', () => {
    const base = routesToGeoJson([
      {
        origin: 'VIE',
        destination: 'BCN',
        rank: 0,
        stops: 0,
        path: [
          [
            [16, 48],
            [2, 41],
          ],
        ],
      },
    ]);
    const merged = withStoredRoutes(base, [
      stored('BCN', [2.08, 41.3]),
      stored('LIS', [-9.1, 38.8]),
    ]);
    expect(merged.features.map((f) => f.properties.destination)).toEqual(['BCN', 'LIS']);
    expect(withStoredRoutes(base, [])).toBe(base);
  });
});
