import { describe, expect, it } from 'vitest';
import {
  bandFor,
  bandsToGeoJson,
  dayOfYear,
  daylightHours,
  describeSeason,
  seasonModel,
  sunLatitude,
} from './seasons';

/**
 * The seasonal model.
 *
 * What is defended is that it is a model of sunlight and behaves like one:
 * the sun goes where the sun goes, the hemispheres are opposites, the poles
 * have days with no night and nights with no day, and the pattern is the same
 * every time the same date is asked about.
 */

const MIDSUMMER = '2026-06-21';
const MIDWINTER = '2026-12-21';
const EQUINOX = '2026-03-20';

describe('dayOfYear', () => {
  it('counts from the first of January', () => {
    expect(dayOfYear('2026-01-01')).toBe(1);
    expect(dayOfYear('2026-12-31')).toBe(365);
  });

  it('accounts for a leap day', () => {
    expect(dayOfYear('2028-03-01')).toBe(dayOfYear('2026-03-01') + 1);
    expect(dayOfYear('2028-02-01')).toBe(dayOfYear('2026-02-01'));
  });
});

describe('sunLatitude', () => {
  it('reaches the tropics at the solstices and the equator at an equinox', () => {
    expect(sunLatitude(MIDSUMMER)).toBeGreaterThan(23);
    expect(sunLatitude(MIDWINTER)).toBeLessThan(-23);
    expect(Math.abs(sunLatitude(EQUINOX))).toBeLessThan(1.5);
  });

  it('never leaves the tropics, because the sun does not', () => {
    for (let day = 1; day <= 365; day += 1) {
      const date = `2026-01-01`;
      const month = String(Math.min(12, Math.ceil(day / 30))).padStart(2, '0');
      const value = sunLatitude(`${date.slice(0, 5)}${month}-15`);
      expect(Math.abs(value)).toBeLessThanOrEqual(23.44);
    }
  });
});

describe('daylightHours', () => {
  it('gives the equator about twelve hours all year', () => {
    expect(daylightHours(0, sunLatitude(MIDSUMMER))).toBeCloseTo(12, 0);
    expect(daylightHours(0, sunLatitude(MIDWINTER))).toBeCloseTo(12, 0);
  });

  it('gives a polar day and a polar night at the solstices', () => {
    expect(daylightHours(80, sunLatitude(MIDSUMMER))).toBe(24);
    expect(daylightHours(80, sunLatitude(MIDWINTER))).toBe(0);

    // And the other way round at the other end of the world.
    expect(daylightHours(-80, sunLatitude(MIDSUMMER))).toBe(0);
    expect(daylightHours(-80, sunLatitude(MIDWINTER))).toBe(24);
  });
});

describe('bandFor', () => {
  it('freezes the Arctic in December and thaws it in June', () => {
    expect(bandFor(70, sunLatitude(MIDWINTER)).kind).toBe('ice');
    expect(bandFor(70, sunLatitude(MIDSUMMER)).kind).not.toBe('ice');
  });

  it('treats the hemispheres as opposites', () => {
    const december = sunLatitude(MIDWINTER);

    expect(bandFor(55, december).kind).toBe('snow');
    expect(bandFor(-55, december).kind).not.toBe('snow');
  });

  it('greens the temperate north in May', () => {
    // What the request asked for in as many words: Europe green in May.
    expect(bandFor(48, sunLatitude('2026-05-15')).kind).toBe('temperate');
  });

  it('keeps the dry belt dry in every month', () => {
    // The subtropical highs sit there all year, which is why the Sahara,
    // the Arabian peninsula and the Kalahari are where they are.
    for (const date of [MIDSUMMER, MIDWINTER, EQUINOX]) {
      expect(bandFor(24, sunLatitude(date)).kind).toBe('arid');
      expect(bandFor(-24, sunLatitude(date)).kind).toBe('arid');
    }
  });

  it('keeps the tropics green in every month', () => {
    for (const date of [MIDSUMMER, MIDWINTER, EQUINOX]) {
      expect(bandFor(5, sunLatitude(date)).kind).toBe('tropical');
    }
  });

  it('gives every band a strength inside its range', () => {
    for (let latitude = -89; latitude < 90; latitude += 2) {
      const { strength } = bandFor(latitude, sunLatitude(MIDWINTER));
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
    }
  });

  it('fades the polar cap in rather than drawing a rim', () => {
    // A hard line at a latitude reads as a rendering artefact, because that
    // is what it would be. Walking north into the cap, the tint has to climb.
    const winter = sunLatitude(MIDWINTER);
    const strengths = [64, 68, 72, 76, 80].map((latitude) => bandFor(latitude, winter).strength);

    for (let index = 1; index < strengths.length; index += 1) {
      expect(strengths[index]).toBeGreaterThanOrEqual(strengths[index - 1]!);
    }
  });
});

describe('seasonModel', () => {
  it('covers the world from pole to pole without a gap', () => {
    const model = seasonModel(MIDSUMMER);

    expect(model.bands[0]?.south).toBe(-90);
    expect(model.bands[model.bands.length - 1]?.north).toBe(90);

    for (let index = 1; index < model.bands.length; index += 1) {
      expect(model.bands[index]?.south).toBe(model.bands[index - 1]?.north);
    }
  });

  it('is the same every time it is asked about the same date', () => {
    expect(seasonModel(MIDWINTER)).toEqual(seasonModel(MIDWINTER));
  });

  it('looks different in June than in December', () => {
    const june = seasonModel(MIDSUMMER).bands.map((band) => band.kind);
    const december = seasonModel(MIDWINTER).bands.map((band) => band.kind);

    expect(june).not.toEqual(december);
  });

  it('says which hemisphere has the sun, rather than implying an observation', () => {
    expect(describeSeason(seasonModel(MIDSUMMER))).toMatch(/northern/);
    expect(describeSeason(seasonModel(MIDWINTER))).toMatch(/southern/);
    expect(describeSeason(seasonModel(MIDSUMMER))).toMatch(/midday sun stands/);
  });
});

describe('bandsToGeoJson', () => {
  it('draws each band as a closed ring around the world', () => {
    const model = seasonModel(MIDSUMMER);
    const collection = bandsToGeoJson(model);

    // One ring per band, whatever the bands are cut at. The count used to be
    // written here as 90, which said nothing about the conversion and broke
    // the moment the bands were made finer to smooth the poles.
    expect(collection.features).toHaveLength(model.bands.length);

    for (const feature of collection.features) {
      const ring = feature.geometry.coordinates[0]!;
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      // Enough points along each edge to bend with the projection rather
      // than cutting a chord across the globe.
      expect(ring.length).toBeGreaterThan(60);
    }
  });

  it('carries the kind and strength the renderer paints with', () => {
    const feature = bandsToGeoJson(seasonModel(MIDWINTER)).features.at(-1)!;

    expect(feature.properties.kind).toBe('ice');
    expect(feature.properties.strength).toBeGreaterThan(0);
  });
});
