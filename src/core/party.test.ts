import { describe, expect, it } from 'vitest';
import { add, money, multiply } from './money';
import { evenShare, forParty, perTraveller, travellersLabel } from './party';

describe('forParty', () => {
  it('multiplies a one-traveller fare exactly', () => {
    expect(forParty(money(12_345, 'EUR'), 4)).toEqual(money(49_380, 'EUR'));
  });

  it('leaves a single traveller untouched', () => {
    expect(forParty(money(9_999, 'EUR'), 1)).toEqual(money(9_999, 'EUR'));
  });

  it('refuses a party that is not a positive whole number', () => {
    expect(() => forParty(money(100, 'EUR'), 0)).toThrow(/positive integer/);
    expect(() => forParty(money(100, 'EUR'), 2.5)).toThrow(/positive integer/);
  });
});

describe('perTraveller', () => {
  it('splits an even total with nothing left over', () => {
    expect(perTraveller(money(41_956, 'EUR'), 2)).toEqual({
      each: money(20_978, 'EUR'),
      remainder: money(0, 'EUR'),
    });
  });

  it('rounds the share down and reports the minor units it could not place', () => {
    const { each, remainder } = perTraveller(money(10_001, 'EUR'), 3);

    expect(each).toEqual(money(3_333, 'EUR'));
    expect(remainder).toEqual(money(2, 'EUR'));
  });

  it('always adds back up to the total', () => {
    for (const amount of [1, 99, 10_001, 123_457, 7]) {
      for (const travellers of [1, 2, 3, 4, 7, 9]) {
        const total = money(amount, 'EUR');
        const { each, remainder } = perTraveller(total, travellers);
        expect(add(multiply(each, travellers), remainder)).toEqual(total);
        expect(remainder.amount).toBeGreaterThanOrEqual(0);
        expect(remainder.amount).toBeLessThan(travellers);
      }
    }
  });

  it('rounds a negative difference toward zero, so a saving is never overstated', () => {
    const { each, remainder } = perTraveller(money(-1_001, 'EUR'), 2);

    expect(each).toEqual(money(-500, 'EUR'));
    expect(remainder).toEqual(money(-1, 'EUR'));
  });

  it('is the inverse of forParty for a fare quoted per traveller', () => {
    const fare = money(6_400, 'EUR');
    expect(perTraveller(forParty(fare, 4), 4)).toEqual({ each: fare, remainder: money(0, 'EUR') });
  });

  it('keeps currencies without minor units whole', () => {
    expect(perTraveller(money(10_000, 'JPY'), 3).each).toEqual(money(3_333, 'JPY'));
  });
});

describe('travellersLabel', () => {
  it('counts in words a block can state once', () => {
    expect(travellersLabel(1)).toBe('1 traveller');
    expect(travellersLabel(4)).toBe('4 travellers');
  });
});

describe('evenShare', () => {
  it('splits a stay into nights the same way, remainder reported', () => {
    expect(evenShare(money(27_132, 'EUR'), 4)).toEqual({
      each: money(6_783, 'EUR'),
      remainder: money(0, 'EUR'),
    });
    expect(evenShare(money(10_000, 'EUR'), 3).remainder).toEqual(money(1, 'EUR'));
    expect(() => evenShare(money(1, 'EUR'), 0)).toThrow(/positive integer/);
  });
});
