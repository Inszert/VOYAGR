import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  compare,
  deserialize,
  format,
  fromMajor,
  minorUnitExponent,
  money,
  MoneyError,
  multiply,
  scale,
  serialize,
  subtract,
  sum,
  toMajor,
  zero,
} from './money';

describe('money construction', () => {
  it('rejects non-integer minor units', () => {
    // The whole point of minor units is that a fraction of one cannot exist.
    expect(() => money(10.5, 'EUR')).toThrow(MoneyError);
  });

  it('rejects malformed currency codes', () => {
    expect(() => money(100, 'EURO')).toThrow(MoneyError);
    expect(() => money(100, '')).toThrow(MoneyError);
  });

  it('normalises currency codes to upper case', () => {
    expect(money(100, 'eur').currency).toBe('EUR');
  });

  it('knows currencies with non-default minor units', () => {
    expect(minorUnitExponent('EUR')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
  });
});

describe('fromMajor', () => {
  it('converts major units without floating-point drift', () => {
    expect(fromMajor(12.34, 'EUR').amount).toBe(1234);
    expect(fromMajor(0.1, 'EUR').amount).toBe(10);
    // 8.115 * 100 is 811.4999... in binary floating point; rounding once after
    // scaling is what keeps this correct.
    expect(fromMajor(8.115, 'EUR').amount).toBe(812);
  });

  it('respects the currency minor unit', () => {
    expect(fromMajor(1200, 'JPY').amount).toBe(1200);
    expect(fromMajor(1.234, 'KWD').amount).toBe(1234);
  });

  it('rejects non-finite input', () => {
    expect(() => fromMajor(Number.NaN, 'EUR')).toThrow(MoneyError);
    expect(() => fromMajor(Number.POSITIVE_INFINITY, 'EUR')).toThrow(MoneyError);
  });

  it('round-trips through toMajor', () => {
    expect(toMajor(fromMajor(742.5, 'EUR'))).toBe(742.5);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(add(money(1050, 'EUR'), money(275, 'EUR')).amount).toBe(1325);
    expect(subtract(money(1050, 'EUR'), money(275, 'EUR')).amount).toBe(775);
  });

  it('refuses to combine different currencies', () => {
    // Silent conversion is how wrong totals happen, so this must be an error.
    expect(() => add(money(100, 'EUR'), money(100, 'USD'))).toThrow(MoneyError);
    expect(() => subtract(money(100, 'EUR'), money(100, 'GBP'))).toThrow(MoneyError);
    expect(() => compare(money(100, 'EUR'), money(100, 'USD'))).toThrow(MoneyError);
  });

  it('multiplies by whole counts without rounding', () => {
    expect(multiply(money(1999, 'EUR'), 3).amount).toBe(5997);
  });

  it('refuses fractional multipliers, directing callers to scale()', () => {
    expect(() => multiply(money(1000, 'EUR'), 1.5)).toThrow(MoneyError);
  });

  it('scales with explicit rounding modes', () => {
    expect(scale(money(1000, 'EUR'), 0.075).amount).toBe(75);
    expect(scale(money(101, 'EUR'), 0.5, 'half-up').amount).toBe(51);
    expect(scale(money(101, 'EUR'), 0.5, 'floor').amount).toBe(50);
    expect(scale(money(101, 'EUR'), 0.5, 'ceil').amount).toBe(51);
  });

  it('rounds half-even to avoid systematic bias', () => {
    // 0.5 ties go to the nearest even integer, so repeated rounding does not
    // drift upward across a long list of line items.
    expect(scale(money(5, 'EUR'), 0.5, 'half-even').amount).toBe(2);
    expect(scale(money(7, 'EUR'), 0.5, 'half-even').amount).toBe(4);
  });

  it('rounds negative half-up ties away from zero', () => {
    expect(scale(money(-101, 'EUR'), 0.5, 'half-up').amount).toBe(-51);
  });
});

describe('sum', () => {
  it('adds a list exactly', () => {
    const values = [money(14900, 'EUR'), money(32400, 'EUR'), money(6400, 'EUR')];
    expect(sum(values).amount).toBe(53700);
  });

  it('returns zero for an empty list given a currency', () => {
    expect(sum([], 'EUR')).toEqual(zero('EUR'));
  });

  it('refuses an empty list with no currency to fall back on', () => {
    expect(() => sum([])).toThrow(MoneyError);
  });

  it('rejects a mixed-currency list', () => {
    expect(() => sum([money(100, 'EUR'), money(100, 'USD')])).toThrow(MoneyError);
  });

  it('never drifts across many additions', () => {
    // 1000 additions of 0.01 must be exactly 10.00, which is the failure mode
    // that float accumulation produces and integer minor units prevent.
    const values = Array.from({ length: 1000 }, () => money(1, 'EUR'));
    expect(sum(values).amount).toBe(1000);
    expect(toMajor(sum(values))).toBe(10);
  });
});

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    const shares = allocate(money(1000, 'EUR'), 4);
    expect(shares.map((share) => share.amount)).toEqual([250, 250, 250, 250]);
  });

  it('distributes the remainder without losing or inventing a minor unit', () => {
    const shares = allocate(money(1000, 'EUR'), 3);
    expect(shares.map((share) => share.amount)).toEqual([334, 333, 333]);
    expect(sum(shares).amount).toBe(1000);
  });

  it('preserves the total for a negative amount', () => {
    const shares = allocate(money(-1000, 'EUR'), 3);
    expect(sum(shares).amount).toBe(-1000);
  });

  it('rejects a non-positive part count', () => {
    expect(() => allocate(money(1000, 'EUR'), 0)).toThrow(MoneyError);
    expect(() => allocate(money(1000, 'EUR'), -2)).toThrow(MoneyError);
  });

  it('always sums back to the original across many splits', () => {
    for (let total = 1; total <= 200; total += 7) {
      for (let parts = 1; parts <= 9; parts += 1) {
        const shares = allocate(money(total, 'EUR'), parts);
        expect(sum(shares).amount).toBe(total);
      }
    }
  });
});

describe('serialisation', () => {
  it('round-trips losslessly', () => {
    const value = money(74250, 'EUR');
    expect(deserialize(serialize(value))).toEqual(value);
  });

  it('rejects malformed input', () => {
    expect(() => deserialize('nonsense')).toThrow(MoneyError);
  });
});

describe('format', () => {
  it('renders the correct number of decimals for the currency', () => {
    // Non-breaking spaces vary by ICU build, so assert on the digits.
    expect(format(money(74250, 'EUR'), 'en-GB')).toContain('742.50');
    expect(format(money(1200, 'JPY'), 'en-GB')).toContain('1,200');
  });
});
