import { describe, expect, it } from 'vitest';
import { distanceMetres, formatKilometres } from './distance';

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    expect(
      distanceMetres({ latitude: 36.9, longitude: 30.7 }, { latitude: 36.9, longitude: 30.7 }),
    ).toBe(0);
  });

  it('matches a known distance: Paris to London is about 344 km', () => {
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    const london = { latitude: 51.5074, longitude: -0.1278 };

    const metres = distanceMetres(paris, london);

    expect(metres).toBeGreaterThan(340_000);
    expect(metres).toBeLessThan(348_000);
  });

  it('is symmetric', () => {
    const a = { latitude: 36.90812, longitude: 30.69556 };
    const b = { latitude: 36.8866, longitude: 30.7054 };

    expect(distanceMetres(a, b)).toBe(distanceMetres(b, a));
  });

  it('measures a degree of latitude as about 111 km', () => {
    const metres = distanceMetres({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });

    expect(metres).toBeGreaterThan(111_000);
    expect(metres).toBeLessThan(111_400);
  });

  it('does not return NaN for antipodal points', () => {
    const metres = distanceMetres({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });

    expect(metres).toBeGreaterThan(20_000_000);
    expect(metres).toBeLessThan(20_100_000);
  });

  it('goes the short way round the date line', () => {
    const metres = distanceMetres(
      { latitude: 0, longitude: 179.5 },
      { latitude: 0, longitude: -179.5 },
    );

    expect(metres).toBeLessThan(112_000);
  });

  it('refuses a point that is not on the globe', () => {
    expect(() =>
      distanceMetres({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      distanceMetres({ latitude: 0, longitude: 181 }, { latitude: 0, longitude: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      distanceMetres({ latitude: Number.NaN, longitude: 0 }, { latitude: 0, longitude: 0 }),
    ).toThrow(RangeError);
  });
});

describe('formatKilometres', () => {
  it('shows a tenth under ten kilometres and whole kilometres from ten', () => {
    expect(formatKilometres(0)).toBe('0.0 km');
    expect(formatKilometres(849)).toBe('0.8 km');
    expect(formatKilometres(9_949)).toBe('9.9 km');
    expect(formatKilometres(9_999)).toBe('10 km');
    expect(formatKilometres(10_000)).toBe('10 km');
    expect(formatKilometres(12_600)).toBe('13 km');
  });

  it('refuses a negative or non-finite distance', () => {
    expect(() => formatKilometres(-1)).toThrow(RangeError);
    expect(() => formatKilometres(Number.NaN)).toThrow(RangeError);
  });
});
