import { describe, expect, it } from 'vitest';
import { airportReferenceCount, resolveAirport } from './airports';

describe('resolveAirport', () => {
  it('resolves every one of the product home airports to a real position', () => {
    for (const code of ['KSC', 'BTS', 'PRG', 'VIE']) {
      const airport = resolveAirport(code);
      expect(airport).not.toBeNull();
      expect(airport?.position).toHaveLength(2);
      expect(airport?.position.every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(resolveAirport('vie')?.code).toBe('VIE');
  });

  it('returns null rather than a guessed position for an unknown code', () => {
    expect(resolveAirport('ZZZ')).toBeNull();
  });

  it('covers a real-world number of airports, not a fixture-sized handful', () => {
    // The fixture files this complements cover a few dozen airports by hand.
    // This is built from a public dataset and should be two orders of
    // magnitude bigger, or the build silently filtered almost everything out.
    expect(airportReferenceCount()).toBeGreaterThan(1000);
  });
});
