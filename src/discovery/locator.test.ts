import { describe, expect, it } from 'vitest';
import { buildLocator } from './locator';

/**
 * The locator map's projection.
 *
 * Defended: the place is in the middle, north is up, what lies outside the
 * frame is not drawn, and the scale bar is a round distance that fits.
 */

const square: (readonly [number, number])[] = [
  [2, 41],
  [2.5, 41],
  [2.5, 41.5],
  [2, 41.5],
];

const farAway: (readonly [number, number])[] = [
  [30, 10],
  [31, 10],
  [31, 11],
];

const base = {
  centre: { longitude: 2.17, latitude: 41.39 },
  width: 400,
  height: 300,
  land: [square, farAway],
  places: [
    { name: 'Near', kind: 'airport', position: [2.08, 41.3] as const },
    { name: 'Far', kind: 'capital', position: [12.5, 41.9] as const },
  ],
};

describe('buildLocator', () => {
  it('puts the place in the middle of the frame', () => {
    expect(buildLocator(base).marker).toEqual({ x: 200, y: 150 });
  });

  it('draws north up: a place further north sits higher', () => {
    const map = buildLocator({
      ...base,
      places: [{ name: 'North', kind: 'airport', position: [2.17, 41.6] }],
    });

    expect(map.places[0]!.y).toBeLessThan(map.marker.y);
  });

  it('draws the land that reaches into the frame and nothing beyond it', () => {
    const map = buildLocator(base);

    expect(map.land).toHaveLength(1);
    expect(map.land[0]).toMatch(/^M[\d.-]+ [\d.-]+(L[\d.-]+ [\d.-]+)+Z$/);
  });

  it('labels only the places inside the frame', () => {
    expect(buildLocator(base).places.map((place) => place.name)).toEqual(['Near']);
  });

  it('gives a round scale that fits in a quarter of the width', () => {
    const { scale } = buildLocator(base);

    expect([5, 10, 20, 25, 50, 100, 200, 250, 500]).toContain(scale.kilometres);
    expect(scale.pixels).toBeLessThanOrEqual(100);
    expect(scale.pixels).toBeGreaterThan(0);
  });
});
