import { describe, expect, it } from 'vitest';
import { greatCirclePath } from '@/discovery/geo';
import { fitSphere, limbFade, toArcRuns } from './globe-arcs';

type LngLat = readonly [number, number];

/** A route feature the way `routesToGeoJson` writes one. */
function route(
  origin: string,
  destination: string,
  from: LngLat,
  to: LngLat,
  rank: number,
  selected = false,
) {
  return {
    type: 'Feature',
    geometry: {
      type: 'MultiLineString',
      coordinates: greatCirclePath(from, to).map((segment) => segment.map((p) => [...p])),
    },
    properties: { origin, destination, rank, selected },
  };
}

const VIE: LngLat = [16.57, 48.11];
const LIS: LngLat = [-9.13, 38.77];
const MAD: LngLat = [-3.57, 40.47];
const JFK: LngLat = [-73.78, 40.64];
const BOS: LngLat = [-71.0, 42.36];
const BKK: LngLat = [100.75, 13.69];

const collection = (...features: ReturnType<typeof route>[]) => ({
  type: 'FeatureCollection',
  features,
});

describe('toArcRuns bundling', () => {
  it('draws two far-apart destinations as two whole arcs', () => {
    const runs = toArcRuns(
      collection(route('VIE', 'JFK', VIE, JFK, 0), route('VIE', 'BKK', VIE, BKK, 1)),
    );

    expect(runs.some((run) => run.key.endsWith('-branch'))).toBe(false);
  });

  it('draws a nearby destination as a branch of the main flight', () => {
    const runs = toArcRuns(
      collection(route('VIE', 'JFK', VIE, JFK, 0), route('VIE', 'BOS', VIE, BOS, 1)),
    );
    const branch = runs.find((run) => run.key === 'VIE-BOS-branch');

    expect(branch).toBeDefined();
    // It lands on its own destination, and starts well along the trunk.
    expect(branch!.points[branch!.points.length - 1]).toEqual(BOS);
    expect(branch!.fractions[0]).toBeGreaterThan(0.5);
    // Its full route is no longer drawn on its own.
    expect(runs.filter((run) => run.key.startsWith('BOS-'))).toHaveLength(0);
    expect(runs.some((run) => run.key.startsWith('BOS'))).toBe(false);
  });

  it('never folds the selected destination into another arc', () => {
    const runs = toArcRuns(
      collection(route('VIE', 'JFK', VIE, JFK, 0), route('VIE', 'BOS', VIE, BOS, 1, true)),
    );

    expect(runs.some((run) => run.key.endsWith('-branch'))).toBe(false);
  });

  it('does not bundle across origins', () => {
    const runs = toArcRuns(
      collection(route('VIE', 'JFK', VIE, JFK, 0), route('LIS', 'BOS', LIS, BOS, 1)),
    );

    expect(runs.some((run) => run.key.endsWith('-branch'))).toBe(false);
  });

  it('bundles Lisbon into the Madrid flight, which is what looks like one flight from far out', () => {
    const runs = toArcRuns(
      collection(route('VIE', 'MAD', VIE, MAD, 0), route('VIE', 'LIS', VIE, LIS, 1)),
    );

    expect(runs.some((run) => run.key === 'VIE-LIS-branch')).toBe(true);
  });

  it('does not bundle short hops where the branch would be as long as the trunk', () => {
    const MUC: LngLat = [11.79, 48.35];
    const ZRH: LngLat = [8.55, 47.46];
    const runs = toArcRuns(
      collection(route('VIE', 'MUC', VIE, MUC, 0), route('VIE', 'ZRH', VIE, ZRH, 1)),
    );

    expect(runs.some((run) => run.key.endsWith('-branch'))).toBe(false);
  });
});

describe('limbFade', () => {
  it('is fully visible facing the viewer and gone at the limb', () => {
    expect(limbFade(1)).toBe(1);
    expect(limbFade(0.3)).toBe(1);
    expect(limbFade(0.18)).toBe(0);
    expect(limbFade(-0.5)).toBe(0);
  });

  it('fades smoothly between, never going backwards', () => {
    let previous = 0;
    for (let cosine = 0; cosine <= 1; cosine += 0.02) {
      const value = limbFade(cosine);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(limbFade(0.24)).toBeCloseTo(0.5, 6);
  });
});

describe('fitSphere', () => {
  it('finds the centre and diameter of points on a circle, wherever it is', () => {
    const points = Array.from({ length: 16 }, (_, i) => ({
      x: 300 + 120 * Math.cos((i / 16) * 2 * Math.PI),
      y: 410 + 120 * Math.sin((i / 16) * 2 * Math.PI),
    }));
    const sphere = fitSphere(points);

    expect(sphere.x).toBeCloseTo(300, 6);
    expect(sphere.y).toBeCloseTo(410, 6);
    expect(sphere.diameter).toBeCloseTo(240, 6);
  });
});

describe('arc lift', () => {
  it('keeps the apex of the longest route within eight per cent of the radius', () => {
    const [run] = toArcRuns(collection(route('VIE', 'BKK', VIE, BKK, 0)));

    expect(run!.lift).toBeLessThanOrEqual(0.08 + 1e-9);
  });
});
