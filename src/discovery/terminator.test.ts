import { describe, expect, it } from 'vitest';
import {
  solarElevationSine,
  solarFactors,
  sunGeoJson,
  sunPosition,
  terminatorLatitude,
} from './terminator';

/**
 * Where the sun is.
 *
 * The claims worth defending are the ones a wrong sign would break quietly: a
 * planet lit on the wrong side still looks like a planet. So the tests check
 * the sun against places and hours anybody can verify - noon in Greenwich,
 * midnight in the Pacific, the Antarctic in June - rather than against
 * numbers this module produced.
 */

const JUNE = '2026-06-21';
const DECEMBER = '2026-12-21';
const MARCH = '2026-03-20';

/** Noon UTC, in minutes into the day. */
const NOON = 12 * 60;
const MIDNIGHT = 0;

describe('the sun', () => {
  it('stands over Greenwich at noon and over the antimeridian at midnight', () => {
    expect(sunPosition(JUNE, NOON).longitude).toBeCloseTo(0, 6);
    expect(Math.abs(sunPosition(JUNE, MIDNIGHT).longitude)).toBeCloseTo(180, 6);
  });

  it('moves west as the day goes on', () => {
    // Fifteen degrees an hour. Six hours after noon the sun is over the
    // Atlantic, not over India.
    expect(sunPosition(JUNE, NOON + 6 * 60).longitude).toBeCloseTo(-90, 6);
  });

  it('stands over the northern tropics in June and the southern in December', () => {
    expect(sunPosition(JUNE, NOON).declination).toBeGreaterThan(22);
    expect(sunPosition(DECEMBER, NOON).declination).toBeLessThan(-22);
  });

  it('never lets the declination reach zero', () => {
    // At exactly zero the dark region stops being a cap around a pole, which
    // is the one shape the polygon cannot express.
    expect(Math.abs(sunPosition(MARCH, NOON).declination)).toBeGreaterThan(0);
  });
});

describe('day and night', () => {
  it('puts noon in the light and the far side in the dark', () => {
    const sun = sunPosition(JUNE, NOON);

    // London at noon UTC in June: broad daylight.
    expect(solarElevationSine(51.5, -0.13, sun)).toBeGreaterThan(0);
    // Auckland at the same instant: the middle of the night.
    expect(solarElevationSine(-36.85, 174.76, sun)).toBeLessThan(0);
  });

  it('keeps the Antarctic dark all through a June day', () => {
    // Polar night is the strongest check there is on the sign of the
    // declination: it has to hold at every hour, not just at one.
    for (let minutes = 0; minutes < 24 * 60; minutes += 60) {
      const sun = sunPosition(JUNE, minutes);
      expect(solarElevationSine(-85, 0, sun)).toBeLessThan(0);
      expect(solarElevationSine(85, 0, sun)).toBeGreaterThan(0);
    }
  });

  it('puts the terminator where the sun is setting', () => {
    const sun = sunPosition(JUNE, NOON);

    for (const longitude of [-150, -60, 0, 45, 120]) {
      const latitude = terminatorLatitude(longitude, sun);
      expect(solarElevationSine(latitude, longitude, sun)).toBeCloseTo(0, 6);
    }
  });

  it('draws the dark cap around the pole that is in polar night', () => {
    const june = sunGeoJson(sunPosition(JUNE, NOON));
    const december = sunGeoJson(sunPosition(DECEMBER, NOON));

    const ring = (collection: ReturnType<typeof sunGeoJson>) =>
      (collection.features[0] as { geometry: { coordinates: number[][][] } }).geometry
        .coordinates[0]!;

    // In the northern summer the south is dark, so the cap is closed along
    // the south pole; in December the other way round.
    expect(ring(june).some(([, latitude]) => latitude === -90)).toBe(true);
    expect(ring(december).some(([, latitude]) => latitude === 90)).toBe(true);
  });

  it('gives the night a closed ring and the terminator an open line', () => {
    const collection = sunGeoJson(sunPosition(JUNE, NOON));

    // By kind, not by index: the night is drawn as a stack of swept caps and
    // how many there are is a rendering decision, not part of this contract.
    const night = collection.features.find((feature) => feature.properties.kind === 'night');
    const terminator = collection.features.find(
      (feature) => feature.properties.kind === 'terminator',
    );

    expect(night?.geometry.type).toBe('Polygon');
    expect(terminator?.geometry.type).toBe('LineString');

    const ring = (night as { geometry: { coordinates: number[][][] } }).geometry.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('hands the style the same trigonometry it would have done itself', () => {
    const sun = sunPosition(JUNE, NOON);
    const factors = solarFactors(sun);

    // The style multiplies these by each point's own sine and cosine. If the
    // two ever disagree, the lights come on in daylight.
    const rebuilt =
      factors.sinDeclination * Math.sin((40 * Math.PI) / 180) +
      factors.cosDeclination *
        Math.cos((40 * Math.PI) / 180) *
        Math.cos(((10 - factors.longitude) * Math.PI) / 180);

    expect(rebuilt).toBeCloseTo(solarElevationSine(40, 10, sun), 10);
  });
});
