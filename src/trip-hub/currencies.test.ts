import { describe, expect, it } from 'vitest';
import { format, money } from '@/core/money';
import { EXPENSE_CURRENCIES, expenseCurrencyOptions } from './currencies';

describe('expense currencies', () => {
  it('lists only codes the money arithmetic can hold and format', () => {
    for (const { code } of EXPENSE_CURRENCIES) {
      expect(() => format(money(1234, code))).not.toThrow();
    }
  });

  it('has no code twice and is sorted by code', () => {
    const codes = EXPENSE_CURRENCIES.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(codes);
  });

  it('keeps a currency an existing expense already uses, even when unlisted', () => {
    const options = expenseCurrencyOptions(['XAF', 'EUR']);
    expect(options.some((option) => option.value === 'XAF')).toBe(true);
    expect(options.filter((option) => option.value === 'EUR')).toHaveLength(1);
  });
});
