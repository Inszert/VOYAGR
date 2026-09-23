import { describe, expect, it } from 'vitest';
import { nearbyOrigins } from './destination-names';

/**
 * Nearby departure airports.
 *
 * Defended: they are measured from the airports actually searched, nearest
 * first, within the distance given, and never repeat one already searched.
 */
describe('nearbyOrigins', () => {
  it('names the airports near Vienna, nearest first, not Vienna itself', () => {
    const nearby = nearbyOrigins(['VIE']);

    expect(nearby[0]?.code).toBe('BTS');
    expect(nearby[0]!.km).toBeGreaterThan(40);
    expect(nearby[0]!.km).toBeLessThan(80);
    expect(nearby.map((airport) => airport.code)).not.toContain('VIE');
    expect(
      nearby.every((airport, index, all) => index === 0 || all[index - 1]!.km <= airport.km),
    ).toBe(true);
  });

  it('keeps within the distance asked for', () => {
    expect(nearbyOrigins(['VIE'], 100).every((airport) => airport.km <= 100)).toBe(true);
  });

  it('leaves out airports already in the search', () => {
    expect(nearbyOrigins(['VIE', 'BTS']).map((airport) => airport.code)).not.toContain('BTS');
  });

  it('has nothing to say about an airport it cannot place', () => {
    expect(nearbyOrigins(['ZZZ'])).toEqual([]);
  });
});
