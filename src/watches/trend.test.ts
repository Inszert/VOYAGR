import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { priceTrend } from './trend';

/**
 * A watch's price trend.
 *
 * Defended: one point per check, at that check's cheapest trip; checks in
 * order; other components and other currencies left out; and the change is
 * the latest less the first, never a guess.
 */

const at = (hour: number) => `2026-09-23T${String(hour).padStart(2, '0')}:00:00.000Z`;

const observation = (hour: number, amount: number, extra: Record<string, unknown> = {}) => ({
  componentType: 'trip_total' as const,
  amount: money(amount, 'EUR'),
  observedAt: at(hour),
  ...extra,
});

describe('priceTrend', () => {
  it('takes the cheapest trip of each check, in the order the checks ran', () => {
    const trend = priceTrend(
      [
        observation(12, 50_000),
        observation(6, 48_000),
        observation(12, 45_000),
        observation(6, 52_000),
      ],
      'EUR',
    );

    expect(trend.points.map((point) => [point.observedAt, point.lowest.amount])).toEqual([
      [at(6), 48_000],
      [at(12), 45_000],
    ]);
  });

  it('reports the change from the first check to the latest', () => {
    const trend = priceTrend([observation(6, 48_000), observation(12, 45_000)], 'EUR');
    expect(trend.change).toEqual(money(-3_000, 'EUR'));
  });

  it('has no change to report from a single check', () => {
    expect(priceTrend([observation(6, 48_000)], 'EUR').change).toBeNull();
  });

  it('leaves out component prices and other currencies rather than mixing them in', () => {
    const trend = priceTrend(
      [
        observation(6, 48_000),
        observation(6, 10_000, { componentType: 'flight' }),
        observation(6, 1_000, { amount: money(1_000, 'GBP') }),
      ],
      'EUR',
    );

    expect(trend.points).toHaveLength(1);
    expect(trend.points[0]!.lowest.amount).toBe(48_000);
  });
});
