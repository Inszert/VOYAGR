import { describe, expect, it } from 'vitest';
import { money, MoneyError } from './money';
import { convert, crossVia, firstOf, fixedRates, type ExchangeRate } from './fx';
import type { IsoDateTime } from './trip/types';

const AT = '2026-09-22T09:00:00Z' as IsoDateTime;
const EARLIER = '2026-09-20T09:00:00Z' as IsoDateTime;

const rate = (from: string, to: string, value: number, observedAt = AT): ExchangeRate => ({
  from,
  to,
  rate: value,
  observedAt,
});

describe('convert', () => {
  it('returns the same value when nothing needs converting', () => {
    const value = money(12_345, 'EUR');
    const result = convert(value, 'EUR', fixedRates([]));

    // Identity is the one case that needs no rate, and it must not need one:
    // an empty table is the production default.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(value);
  });

  it('converts in integer minor units', () => {
    const result = convert(money(10_000, 'EUR'), 'USD', fixedRates([rate('EUR', 'USD', 1.085)]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(money(10_850, 'USD'));
  });

  it('applies the minor-unit exponent difference, so JPY is not out by a hundred', () => {
    // 10,000 JPY (exponent 0) at 0.0062 is 62 EUR, which is 6,200 minor units.
    const result = convert(money(10_000, 'JPY'), 'EUR', fixedRates([rate('JPY', 'EUR', 0.0062)]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(money(6_200, 'EUR'));
  });

  it('rounds half to even by default, so a ranking is not biased upward', () => {
    // 0.5 minor units exactly: half-up would take every one of these up.
    const table = fixedRates([rate('EUR', 'USD', 1.5)]);

    expect(convert(money(1, 'EUR'), 'USD', table)).toMatchObject({
      value: money(2, 'USD'),
    });
    expect(convert(money(3, 'EUR'), 'USD', table)).toMatchObject({
      value: money(4, 'USD'),
    });
  });

  it('refuses a pair it has no rate for rather than inventing one', () => {
    const result = convert(money(10_000, 'EUR'), 'GBP', fixedRates([rate('EUR', 'USD', 1.085)]));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe('no_rate');
      expect(result.failure).toMatchObject({ from: 'EUR', to: 'GBP' });
    }
  });

  it('does not treat a reversed pair as the same pair', () => {
    // USD->EUR is not EUR->USD, and guessing the reciprocal would be a rate
    // nobody published.
    const result = convert(money(100, 'USD'), 'EUR', fixedRates([rate('EUR', 'USD', 1.085)]));

    expect(result.ok).toBe(false);
  });

  it('refuses a rate older than the caller will accept', () => {
    const result = convert(
      money(10_000, 'EUR'),
      'USD',
      fixedRates([rate('EUR', 'USD', 1.085, EARLIER)]),
      { notBefore: AT },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe('stale_rate');
  });

  it('accepts a rate observed at or after the cutoff', () => {
    const result = convert(
      money(10_000, 'EUR'),
      'USD',
      fixedRates([rate('EUR', 'USD', 1.085, AT)]),
      { notBefore: AT },
    );

    expect(result.ok).toBe(true);
  });

  it('throws on a rate that could only produce a wrong price', () => {
    // Degrading around "no rate" is reasonable; degrading around "this rate
    // is nonsense" would ship a number nobody could detect as wrong.
    expect(() => fixedRates([rate('EUR', 'USD', 0)])).toThrow(MoneyError);
    expect(() => fixedRates([rate('EUR', 'USD', -1)])).toThrow(MoneyError);
    expect(() => fixedRates([rate('EUR', 'USD', Number.NaN)])).toThrow(MoneyError);
  });

  it('normalises case, so eur and EUR are one currency', () => {
    const result = convert(money(100, 'eur'), 'usd', fixedRates([rate('EUR', 'USD', 2)]));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(money(200, 'USD'));
  });
});

describe('firstOf', () => {
  it('prefers the earlier source and falls through to the later one', () => {
    const source = firstOf([
      fixedRates([rate('EUR', 'USD', 1.1)]),
      fixedRates([rate('EUR', 'USD', 9.9), rate('EUR', 'GBP', 0.85)]),
    ]);

    expect(source.rateFor('EUR', 'USD')?.rate).toBe(1.1);
    expect(source.rateFor('EUR', 'GBP')?.rate).toBe(0.85);
    expect(source.rateFor('EUR', 'JPY')).toBeNull();
  });
});

describe('crossVia', () => {
  const direct = fixedRates([rate('USD', 'EUR', 0.9, AT), rate('EUR', 'GBP', 0.85, EARLIER)]);

  it('derives a pair the source does not hold directly', () => {
    const derived = crossVia('EUR', direct).rateFor('USD', 'GBP');

    expect(derived?.rate).toBeCloseTo(0.765, 10);
  });

  it('dates a cross rate with its staler half', () => {
    // A cross rate is only as fresh as its older leg, or a stale leg hides
    // behind a fresh one.
    expect(crossVia('EUR', direct).rateFor('USD', 'GBP')?.observedAt).toBe(EARLIER);
  });

  it('prefers a direct rate over a derived one', () => {
    const source = crossVia('EUR', fixedRates([...[rate('USD', 'GBP', 0.5)]]));

    expect(source.rateFor('USD', 'GBP')?.rate).toBe(0.5);
  });

  it('returns nothing when a leg is missing', () => {
    expect(crossVia('EUR', fixedRates([rate('USD', 'EUR', 0.9)])).rateFor('USD', 'GBP')).toBeNull();
  });
});
