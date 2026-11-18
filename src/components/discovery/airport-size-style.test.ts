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

describe('airport size on the globe features', () => {
  it('maps traffic tiers to all three sizes', async () => {
    const { airportSizeOfRank } = await import('./airport-size-style');
    expect(airportSizeOfRank(8)).toBe('large');
    expect(airportSizeOfRank(7)).toBe('large');
    expect(airportSizeOfRank(5)).toBe('medium');
    expect(airportSizeOfRank(3)).toBe('small');
    expect(airportSizeOfRank(1)).toBe('small');
    expect(airportSizeOfRank(null)).toBe('medium');
  });

  it('evaluates the style expression per feature: rank first, IATA without one', async () => {
    const spec = await import('@maplibre/maplibre-gl-style-spec');
    const parsed = spec.createExpression(
      bySize((s) => s.radiusScale) as never,
      {
        type: 'number',
        'property-type': 'data-driven',
        expression: { interpolated: false, parameters: ['feature'] },
      } as never,
    );
    if (parsed.result !== 'success') throw new Error('expression did not parse');
    const at = (properties: Record<string, unknown>) =>
      parsed.value.evaluate({ zoom: 0 } as never, { properties, type: 1 } as never);
    expect(at({ iata: 'LPL', rank: 2 })).toBe(AIRPORT_SIZE_STYLES.small.radiusScale);
    expect(at({ iata: 'LHR', rank: 8 })).toBe(AIRPORT_SIZE_STYLES.large.radiusScale);
    expect(at({ iata: 'BRU', rank: 5 })).toBe(AIRPORT_SIZE_STYLES.medium.radiusScale);
    expect(at({ iata: 'MXP' })).toBe(AIRPORT_SIZE_STYLES.large.radiusScale);
    expect(at({})).toBe(AIRPORT_SIZE_STYLES.medium.radiusScale);
  });
});
