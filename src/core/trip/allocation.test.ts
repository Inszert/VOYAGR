import { describe, expect, it } from 'vitest';
import { budgetAllocation } from './allocation';
import { costTripCandidate } from './cost';
import { buildCandidate } from './test-support';

/**
 * Budget allocation.
 *
 * Defended: the shares are the engine's own lines grouped, they always add up
 * to 100, and an excluded cost is named rather than given a share of zero.
 */

describe('budgetAllocation', () => {
  it('splits the counted total into shares that add up to exactly 100', () => {
    const cost = costTripCandidate(buildCandidate());
    const { shares } = budgetAllocation(cost);

    expect(shares.map((share) => share.part)).toContain('flights');
    expect(shares.map((share) => share.part)).toContain('stay');
    expect(shares.reduce((total, share) => total + share.percent, 0)).toBe(100);
  });

  it('adds each part up from the engine lines, not from a recomputed price', () => {
    const cost = costTripCandidate(buildCandidate());
    const { shares } = budgetAllocation(cost);
    const counted = cost.lines.filter((line) => line.confidence !== 'excluded');

    const flights = counted
      .filter((line) => line.category === 'flight' || line.category === 'flight_fees')
      .reduce((total, line) => total + line.amount.amount, 0);
    expect(shares.find((share) => share.part === 'flights')?.amount.amount).toBe(flights);
    expect(shares.reduce((total, share) => total + share.amount.amount, 0)).toBe(
      cost.total.amount,
    );
  });

  it('names an excluded cost instead of giving it a share', () => {
    const cost = costTripCandidate(buildCandidate({ transfer: null }));
    const allocation = budgetAllocation(cost);

    expect(allocation.excluded.map((line) => line.category)).toContain('transfer');
    expect(allocation.shares.every((share) => share.amount.amount > 0)).toBe(true);
  });
});
