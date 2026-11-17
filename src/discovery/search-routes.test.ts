import { describe, expect, it } from 'vitest';
import {
  MAX_ROUTE_LINES,
  buildRoutePairs,
  routeCountText,
  routePairsToRoutes,
  routeText,
} from './search-routes';

const positions: Record<string, readonly [number, number]> = {
  VIE: [16.57, 48.11],
  BTS: [17.21, 48.17],
  AYT: [30.8, 36.9],
  LIS: [-9.13, 38.77],
};
const positionOf = (code: string) => positions[code] ?? null;

describe('buildRoutePairs', () => {
  it('joins every origin to every destination: 2 by 2 gives 4 lines', () => {
    const result = buildRoutePairs(['VIE', 'BTS'], ['AYT', 'LIS'], positionOf);
    expect(result.pairs.map(routeText)).toEqual([
      'VIE to AYT',
      'VIE to LIS',
      'BTS to AYT',
      'BTS to LIS',
    ]);
    expect(routeCountText(result)).toBe('4 routes shown');
  });

  it('draws no line, and does not throw, for an airport with no position', () => {
    const result = buildRoutePairs(['VIE', 'XXX'], ['AYT'], positionOf);
    expect(result.pairs.map(routeText)).toEqual(['VIE to AYT']);
    expect(result.unplaced).toBe(1);
    expect(() =>
      buildRoutePairs(['VIE'], ['AYT'], () => {
        throw new Error('no data');
      }),
    ).not.toThrow();
  });

  it('draws at most 25 lines and says how many were left out', () => {
    const many = Array.from({ length: 6 }, (_, i) => `A${String.fromCharCode(65 + i)}${'A'}`);
    const all = (code: string) => (code.length === 3 ? ([1, 2] as const) : null);
    const result = buildRoutePairs(many, [...many.map((c) => c.replace('A', 'B'))], all);
    expect(result.pairs).toHaveLength(MAX_ROUTE_LINES);
    expect(result.beyondCeiling).toBe(result.requested - MAX_ROUTE_LINES);
    expect(routeCountText(result)).toContain('25 routes shown');
  });

  it('turns pairs into great-circle routes the globe can draw', () => {
    const { pairs } = buildRoutePairs(['VIE'], ['AYT'], positionOf);
    const [route] = routePairsToRoutes(pairs);
    expect(route?.origin).toBe('VIE');
    expect(route?.path[0]?.length).toBeGreaterThan(2);
  });
});
