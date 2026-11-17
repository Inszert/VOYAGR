import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EARTH_SNOW_COVER,
  earthLayer,
  earthPaint,
  formSeasonDate,
  ROUTE_DASH_STEPS,
  routeDashPattern,
  warmEdge,
} from './globe-style';

describe('warmEdge', () => {
  it('tints the night towards the twilight and stays dark', () => {
    expect(warmEdge('#060914', '#f0a35c')).toBe('rgb(39, 31, 30)');
  });

  it('returns the night untouched when a colour cannot be read', () => {
    expect(warmEdge('#060914', 'oklch(0.78 0.14 58)')).toBe('#060914');
  });
});

/**
 * The marching route dash.
 *
 * Defended: however long a globe page lives, the animation hands MapLibre a
 * bounded set of dash arrays - an unbounded set filled its line atlas and made
 * every later frame throw - and every one keeps the line the same length.
 */
describe('routeDashPattern', () => {
  it('never produces more than a fixed set of patterns, however long it runs', () => {
    const seen = new Set<string>();
    // An hour of frames at 60 a second.
    for (let frame = 0; frame < 60 * 60 * 60; frame += 1) {
      seen.add(routeDashPattern(frame / 60).join(','));
    }

    expect(seen.size).toBeLessThanOrEqual(ROUTE_DASH_STEPS);
  });

  it('keeps the dash and its gaps the same total length', () => {
    for (const seconds of [0, 0.4, 1.3, 2.9, 17.2, 3600.05]) {
      const [lead, dash, gap] = routeDashPattern(seconds);
      expect(lead + dash + gap).toBeCloseTo(8, 10);
    }
  });

  it('still moves', () => {
    expect(routeDashPattern(0)).not.toEqual(routeDashPattern(0.5));
  });
});

/**
 * The season step.
 *
 * The planet's paint follows how much of the north is snow in that month's
 * tiles. These hold the two ends - January's whites stretched, July painted
 * as it always was - and hold the table to the tiles it was measured from.
 */
describe('earthPaint', () => {
  it('stretches a snowy month towards white', () => {
    const january = earthPaint('01');
    expect(january.contrast).toBeGreaterThanOrEqual(0.24);
    expect(january.brightnessMax).toBeGreaterThanOrEqual(0.99);
  });

  it('paints a summer month almost exactly as before', () => {
    const july = earthPaint('07');
    expect(july.contrast).toBeCloseTo(0.1, 1);
    expect(july.contrast).toBeLessThan(0.11);
    expect(july.brightnessMax).toBeLessThan(0.96);
  });

  it('never adds colour and stays inside its bounds in every month', () => {
    for (let index = 1; index <= 12; index += 1) {
      const paint = earthPaint(String(index).padStart(2, '0'));
      expect(paint.saturation).toBe(0.15);
      expect(paint.contrast).toBeGreaterThanOrEqual(0.1);
      expect(paint.contrast).toBeLessThanOrEqual(0.25);
      expect(paint.brightnessMax).toBeGreaterThanOrEqual(0.95);
      expect(paint.brightnessMax).toBeLessThanOrEqual(1);
    }
  });

  it('is what the layer is painted with', () => {
    expect(earthLayer('earth-01', 'earth-01', 0, '01').paint).toMatchObject({
      'raster-contrast': earthPaint('01').contrast,
      'raster-brightness-max': earthPaint('01').brightnessMax,
      'raster-opacity': 0,
    });
  });

  it('matches the snow actually in the tiles', async () => {
    const root = join(process.cwd(), 'public', 'geo', 'earth', 'v2');
    if (!existsSync(root)) return;
    const { default: sharp } = await import('sharp');

    const size = 1024;
    const latitude = (y: number) =>
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;

    for (const month of ['01', '07']) {
      let snow = 0;
      let total = 0;
      for (let tx = 0; tx < 4; tx += 1) {
        for (let ty = 0; ty < 4; ty += 1) {
          const pixels = await sharp(join(root, month, '2', String(tx), `${ty}.webp`))
            .removeAlpha()
            .raw()
            .toBuffer();
          for (let py = 0; py < 256; py += 1) {
            const lat = latitude(ty * 256 + py);
            if (lat <= 35 || lat >= 72) continue;
            for (let px = 0; px < 256; px += 1) {
              const lng = ((tx * 256 + px) / size) * 360 - 180;
              if (lat > 59 && lng > -75 && lng < -10) continue;
              const at = (py * 256 + px) * 3;
              total += 1;
              if (Math.min(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!) > 170) snow += 1;
            }
          }
        }
      }
      expect((100 * snow) / total).toBeCloseTo(EARTH_SNOW_COVER[month]!, 0);
    }
  });
});

describe('formSeasonDate', () => {
  const fields = {
    flexibility: 'exact',
    departureDate: '2027-01-10',
    returnDate: '2027-01-20',
    monthStart: '2027-07-01',
  };

  it('lights the middle of the trip, as the server does', () => {
    expect(formSeasonDate(fields)).toBe('2027-01-15');
  });

  it('uses the chosen month when the dates are "anytime that month"', () => {
    expect(formSeasonDate({ ...fields, flexibility: 'month' })).toBe('2027-07-01');
  });

  it('falls back to the departure when the return is missing or earlier', () => {
    expect(formSeasonDate({ ...fields, returnDate: '' })).toBe('2027-01-10');
    expect(formSeasonDate({ ...fields, returnDate: '2027-01-02' })).toBe('2027-01-10');
  });

  it('answers nothing for a date that is not a date', () => {
    expect(formSeasonDate({ ...fields, departureDate: '' })).toBeNull();
    expect(formSeasonDate({ ...fields, departureDate: '2027-02-30' })).toBeNull();
    expect(formSeasonDate({ ...fields, flexibility: 'month', monthStart: null })).toBeNull();
  });
});
