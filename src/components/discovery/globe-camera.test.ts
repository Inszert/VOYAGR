import { describe, expect, it } from 'vitest';
import {
  HOME_MAX_OFFSET,
  angularDistance,
  daylitShare,
  restingCentre,
  type Sun,
} from './globe-camera';

const VIE = { lng: 16.57, lat: 48.11 };

/** The sun over a longitude, at the equinox. */
const sunOver = (longitude: number, declination = 0): Sun => ({ longitude, declination });

describe('daylitShare', () => {
  it('is all of the disc when facing the sun and none when facing away', () => {
    expect(daylitShare({ lng: 10, lat: 0 }, sunOver(10))).toBeCloseTo(1, 6);
    expect(daylitShare({ lng: 190, lat: 0 }, sunOver(10))).toBeCloseTo(0, 6);
    expect(daylitShare({ lng: 100, lat: 0 }, sunOver(10))).toBeCloseTo(0.5, 6);
  });
});

describe('restingCentre', () => {
  it('stays on the home airport when the view is already mostly daylit', () => {
    const [lng, lat] = restingCentre({ home: VIE, sun: sunOver(20) });

    expect(lng).toBeCloseTo(VIE.lng, 6);
    expect(lat).toBeCloseTo(30, 6);
  });

  it('turns towards the sun when the airport is in daylight but the view is not', () => {
    // Sun over the Atlantic far to the west of Vienna: Vienna is only just lit.
    const sun = sunOver(-65);
    const before = daylitShare({ lng: VIE.lng, lat: 36.11 }, sun);
    const [lng, lat] = restingCentre({ home: VIE, sun });

    expect(before).toBeLessThan(0.6);
    expect(daylitShare({ lng, lat }, sun)).toBeGreaterThan(before);
    expect(lng).toBeLessThan(VIE.lng);
  });

  it('never lets the home airport leave the middle of the disc', () => {
    for (let longitude = -180; longitude < 180; longitude += 15) {
      const [lng, lat] = restingCentre({ home: VIE, sun: sunOver(longitude) });
      expect(angularDistance({ lng, lat }, VIE)).toBeLessThanOrEqual(HOME_MAX_OFFSET + 12 + 1e-9);
    }
  });

  it('accepts night when the home airport is itself in night', () => {
    const [lng] = restingCentre({ home: VIE, sun: sunOver(-170) });

    expect(lng).toBeCloseTo(VIE.lng, 6);
  });

  it('is deterministic for a given clock', () => {
    const sun = sunOver(-40, -18);
    expect(restingCentre({ home: VIE, sun })).toEqual(restingCentre({ home: VIE, sun }));
  });
});
