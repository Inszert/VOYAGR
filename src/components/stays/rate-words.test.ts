import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import type { StayRate } from '@/core/stay/types';
import { BOARD_LABEL, cancellationLabel, taxLines } from './rate-words';

const rate = (
  taxesAndFees: StayRate['taxesAndFees'],
  payableAtProperty: StayRate['payableAtProperty'],
) => ({ taxesAndFees, payableAtProperty }) as StayRate;

describe('taxLines', () => {
  it("says 'Taxes not stated' when both are null", () => {
    expect(taxLines(rate(null, null))).toEqual(['Taxes not stated']);
  });

  it('says taxes are included', () => {
    const lines = taxLines(rate(money(1200, 'EUR'), null));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Includes taxes/);
  });

  it('never adds the amount payable at the hotel to a total', () => {
    const lines = taxLines(rate(null, money(800, 'EUR')));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Payable at the hotel: .*not part of the price shown/);
  });

  it('shows both lines when both are present', () => {
    expect(taxLines(rate(money(1200, 'EUR'), money(800, 'EUR')))).toHaveLength(2);
  });
});

describe('labels', () => {
  it('words board and cancellation, with unknown as its own case', () => {
    expect(BOARD_LABEL.breakfast).toBe('Breakfast included');
    const c = (refundable: boolean | null) => ({ cancellation: { refundable } }) as StayRate;
    expect(cancellationLabel(c(null))).toBe('Cancellation terms not stated');
    expect(cancellationLabel(c(true))).toBe('Free cancellation');
    expect(cancellationLabel(c(false))).toBe('Non-refundable');
  });
});
