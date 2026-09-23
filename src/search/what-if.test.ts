import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { buildRankedTrip } from '@/components/search/test-support';
import { budgetWhatIf } from './what-if';
import type { SearchOutcome } from './types';

/**
 * The budget what-if.
 *
 * Defended: only near misses whose sole problem is the budget are counted,
 * each at its own engine total, against ceilings rounded up to a whole ten.
 */

const profile = buildProfile({ maxBudget: money(80_000, 'EUR') });

function over(total: number, extra: string[] = []) {
  const trip = buildRankedTrip();
  return {
    ...trip,
    cost: { ...trip.cost, total: money(total, 'EUR') },
    eligibility: {
      ...trip.eligibility,
      eligible: false,
      violations: [
        { code: 'OVER_MAX_BUDGET' as const, message: 'Over budget' },
        ...extra.map((code) => ({ code: code as never, message: code })),
      ],
    },
  };
}

function outcome(...nearMisses: ReturnType<typeof over>[]): SearchOutcome {
  return {
    results: [],
    nearMisses,
    overBudgetOnly: nearMisses
      .filter((trip) => trip.eligibility.violations.every((v) => v.code === 'OVER_MAX_BUDGET'))
      .map((trip) => trip.cost.total),
  } as unknown as SearchOutcome;
}

describe('budgetWhatIf', () => {
  it('offers ceilings above the maximum, rounded up to a whole ten', () => {
    const steps = budgetWhatIf(outcome(), profile);
    expect(steps.map((step) => step.ceiling.amount)).toEqual([88_000, 96_000, 108_000]);
  });

  it('counts only trips whose one problem was the budget, under each ceiling', () => {
    const steps = budgetWhatIf(
      outcome(over(85_000), over(95_000), over(90_000, ['DIRECT_FLIGHT_REQUIRED'])),
      profile,
    );

    expect(steps.map((step) => step.extraTrips)).toEqual([1, 2, 2]);
    expect(steps[0]!.best?.cost.total.amount).toBe(85_000);
  });

  it('has nothing to offer when nothing was turned away for its cost', () => {
    expect(budgetWhatIf(outcome(), profile).every((step) => step.best === null)).toBe(true);
  });
});

describe('budgetWhatIf counting', () => {
  it('counts every trip turned away for price, not only the near misses kept', () => {
    const kept = over(85_000);
    const outcomeWithMore = {
      results: [],
      nearMisses: [kept],
      overBudgetOnly: [85_000, 86_000, 87_000].map((amount) => money(amount, 'EUR')),
    } as unknown as SearchOutcome;

    const [first] = budgetWhatIf(outcomeWithMore, profile);
    expect(first!.extraTrips).toBe(3);
    expect(first!.best?.cost.total.amount).toBe(85_000);
  });
});
