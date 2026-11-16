import { describe, expect, it } from 'vitest';
import { money } from '../money';
import { areaAround, distanceFromCentre, matchListing, priceDifference } from './listing';

const barcelona = { latitude: 41.39, longitude: 2.17 };

describe('priceDifference', () => {
  it('says how much more or less, measured from the selected stay', () => {
    expect(priceDifference(money(40_000, 'EUR'), money(46_550, 'EUR'))).toEqual({
      kind: 'more',
      amount: money(6_550, 'EUR'),
    });
    expect(priceDifference(money(40_000, 'EUR'), money(31_000, 'EUR'))).toEqual({
      kind: 'less',
      amount: money(9_000, 'EUR'),
    });
    expect(priceDifference(money(40_000, 'EUR'), money(40_000, 'EUR'))).toEqual({ kind: 'same' });
  });

  it('has nothing to say unless both prices are known, in one currency', () => {
    expect(priceDifference(null, money(1, 'EUR'))).toBeNull();
    expect(priceDifference(money(1, 'EUR'), null)).toBeNull();
    expect(priceDifference(money(1, 'EUR'), money(1, 'GBP'))).toBeNull();
  });
});

describe('areaAround', () => {
  it('is a box about the radius each way, wider in longitude away from the equator', () => {
    const area = areaAround(barcelona, 5);
    expect(area.north - barcelona.latitude).toBeCloseTo(0.0449, 3);
    expect(area.east - barcelona.longitude).toBeGreaterThan(area.north - barcelona.latitude);
    expect(area.south).toBeLessThan(barcelona.latitude);
  });

  it('refuses a radius that is not a city', () => {
    expect(() => areaAround(barcelona, 0)).toThrow(RangeError);
    expect(() => areaAround(barcelona, 400)).toThrow(RangeError);
  });
});

describe('distanceFromCentre', () => {
  it('is in whole metres', () => {
    const metres = distanceFromCentre(barcelona, { latitude: 41.4, longitude: 2.17 });
    expect(Number.isInteger(metres)).toBe(true);
    expect(metres).toBeGreaterThan(1_000);
    expect(metres).toBeLessThan(1_200);
  });
});

describe('matchListing', () => {
  const stays = new Map([
    ['a', { name: 'Hotel Arts Barcelona', position: { latitude: 41.3869, longitude: 2.1962 } }],
    ['b', { name: 'Hotel Central', position: { latitude: 41.0, longitude: 2.0 } }],
  ]);

  it('matches the same name within a short walk', () => {
    expect(
      matchListing(
        { name: 'HOTEL ARTS BARCELONA', position: { latitude: 41.387, longitude: 2.1963 } },
        stays,
      ),
    ).toBe('a');
  });

  it('does not match a namesake across town', () => {
    expect(
      matchListing(
        { name: 'Hotel Central', position: { latitude: 41.39, longitude: 2.17 } },
        stays,
      ),
    ).toBeNull();
  });
});
