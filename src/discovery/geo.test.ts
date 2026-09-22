import { describe, expect, it } from 'vitest';
import {
  angularDistance,
  distanceKm,
  greatCirclePath,
  midpoint,
  splitAtAntimeridian,
  type LngLat,
} from './geo';

/**
 * Globe geometry.
 *
 * Checked against figures a reader can verify independently - published
 * distances between airports, and the plain fact that a great circle between
 * two points in the northern hemisphere bows north of the straight line.
 */

const VIENNA: LngLat = [16.57, 48.11];
const TBILISI: LngLat = [44.95, 41.67];
const FARO: LngLat = [-7.97, 37.01];

describe('distance', () => {
  it('matches the published great-circle distance', () => {
    // Vienna to Tbilisi is about 2,330 km by any published airport-distance
    // table; the band allows for the two-decimal fixture coordinates.
    expect(distanceKm(VIENNA, TBILISI)).toBeGreaterThan(2_300);
    expect(distanceKm(VIENNA, TBILISI)).toBeLessThan(2_360);
  });

  it('is symmetric and zero for a point against itself', () => {
    expect(distanceKm(VIENNA, FARO)).toBe(distanceKm(FARO, VIENNA));
    expect(angularDistance(VIENNA, VIENNA)).toBe(0);
  });
});

describe('greatCirclePath', () => {
  it('starts and ends exactly on the airports', () => {
    const [segment] = greatCirclePath(VIENNA, TBILISI, 8);

    expect(segment?.[0]).toEqual(VIENNA);
    expect(segment?.[segment.length - 1]).toEqual(TBILISI);
    expect(segment).toHaveLength(9);
  });

  it('bows north of the straight line, as a real flight does', () => {
    const mid = midpoint(VIENNA, TBILISI);
    const straightLineLatitude = (VIENNA[1] + TBILISI[1]) / 2;

    expect(mid[1]).toBeGreaterThan(straightLineLatitude);
  });

  it('is one segment when it does not cross the antimeridian', () => {
    expect(greatCirclePath(VIENNA, FARO)).toHaveLength(1);
  });

  it('splits into two segments across the antimeridian', () => {
    const tokyo: LngLat = [139.78, 35.55];
    const losAngeles: LngLat = [-118.41, 33.94];

    const segments = greatCirclePath(tokyo, losAngeles);

    expect(segments).toHaveLength(2);

    const first = segments[0]!;
    const second = segments[1]!;

    // Each half ends on its own edge of the map, at the same latitude, so the
    // two pieces meet when drawn.
    expect(first[first.length - 1]?.[0]).toBe(180);
    expect(second[0]?.[0]).toBe(-180);
    expect(first[first.length - 1]?.[1]).toBe(second[0]?.[1]);
  });

  it('handles a degenerate route from a place to itself', () => {
    expect(greatCirclePath(VIENNA, VIENNA, 16)).toEqual([[VIENNA, VIENNA]]);
  });
});

describe('splitAtAntimeridian', () => {
  it('leaves a path alone when nothing crosses', () => {
    const path: LngLat[] = [
      [10, 10],
      [20, 12],
      [30, 14],
    ];

    expect(splitAtAntimeridian(path)).toEqual([path]);
  });

  it('interpolates the crossing latitude rather than jumping', () => {
    const segments = splitAtAntimeridian([
      [170, 0],
      [-170, 10],
    ]);

    // Halfway across the twenty-degree gap the latitude is halfway too.
    expect(segments).toEqual([
      [
        [170, 0],
        [180, 5],
      ],
      [
        [-180, 5],
        [-170, 10],
      ],
    ]);
  });
});
