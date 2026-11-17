import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import type { StayRate } from '@/core/stay/types';
import { taxLines } from './stay-card';

const rate = (
  taxesAndFees: StayRate['taxesAndFees'],
  payableAtProperty: StayRate['payableAtProperty'],
) => ({ taxesAndFees, payableAtProperty }) as StayRate;

describe('taxLines', () => {
  it('says taxes are not stated when both are null', () => {
    expect(taxLines(rate(null, null))).toEqual(['Taxes not stated']);
  });

  it('says taxes are included', () => {
    const lines = taxLines(rate(money(1200, 'EUR'), null));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Includes taxes/);
  });

  it('says the hotel amount is not part of the price shown', () => {
    const lines = taxLines(rate(null, money(800, 'EUR')));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Payable at the hotel: .*not part of the price shown/);
  });

  it('shows both lines when both are present', () => {
    expect(taxLines(rate(money(1200, 'EUR'), money(800, 'EUR')))).toHaveLength(2);
  });
});
