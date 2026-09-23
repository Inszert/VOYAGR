import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buySignal } from './signal';
import type { PriceTrend } from './trend';

/**
 * The buy/wait reading.
 *
 * Defended: it needs three checks, a new low outranks a direction, and the
 * direction is the last three checks only - never a fit or a projection.
 */

function trend(...amounts: number[]): PriceTrend {
  return {
    points: amounts.map((amount, index) => ({
      observedAt: `2026-09-${String(index + 1).padStart(2, '0')}T06:00:00.000Z`,
      lowest: money(amount, 'EUR'),
    })),
    change: null,
  };
}

describe('buySignal', () => {
  it('says nothing on fewer than three checks', () => {
    expect(buySignal(trend(500, 480))).toBeNull();
  });

  it('calls a new low the lowest seen, ahead of any direction', () => {
    expect(buySignal(trend(500, 520, 480))).toEqual({ kind: 'lowest', checks: 3 });
  });

  it('reads falling, rising and steady from the last three checks', () => {
    expect(buySignal(trend(400, 520, 500, 480))?.kind).toBe('falling');
    expect(buySignal(trend(400, 450, 470, 490))?.kind).toBe('rising');
    expect(buySignal(trend(400, 450, 440, 445))?.kind).toBe('steady');
  });
});
