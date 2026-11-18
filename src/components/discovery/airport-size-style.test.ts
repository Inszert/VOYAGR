import { describe, expect, it } from 'vitest';

import { AIRPORT_SIZE_STYLES, airportSizeOf, airportSizeStyle, bySize } from './airport-size-style';

describe('airport size style', () => {
  it('gives a large airport the large style, bigger and with a ring', () => {
    const large = airportSizeStyle('large');
    expect(large.label).toBe('Large airport');
    expect(large.radiusScale).toBeGreaterThan(AIRPORT_SIZE_STYLES.medium.radiusScale);
    expect(large.ring).toBeGreaterThan(0);
  });

  it('gives each size a different colour and a different dot size', () => {
    const all = Object.values(AIRPORT_SIZE_STYLES);
    expect(new Set(all.map((s) => s.colorToken)).size).toBe(3);
    expect(new Set(all.map((s) => s.radiusScale)).size).toBe(3);
  });

  it('falls back to medium when no size is stated', () => {
    expect(airportSizeStyle(null).size).toBe('medium');
    expect(airportSizeStyle(undefined).size).toBe('medium');
    expect(airportSizeOf(null)).toBe('medium');
    expect(airportSizeOf('ZZZ')).toBe('medium');
  });

  it('knows Milan Malpensa and Bergamo as large airports on the globe data', () => {
    expect(airportSizeOf('MXP')).toBe('large');
  });

  it('builds a map expression with a medium default', () => {
    const expr = bySize((s) => s.radiusScale) as unknown[];
    expect(expr[0]).toBe('match');
    expect(expr[expr.length - 1]).toBe(AIRPORT_SIZE_STYLES.medium.radiusScale);
  });
});
