import { lessThanOrEqual, minorUnitExponent, money, scale, type Money } from '@/core/money';
import type { SearchProfile } from '@/core/trip/types';
import type { RankedTrip, SearchOutcome } from './types';

/**
 * "What if I spent a little more?", answered from the search already run.
 *
 * A higher ceiling can only admit trips the search has already priced and
 * turned away for their cost: those whose one and only problem was the
 * budget, at or under the new ceiling. They are counted from
 * `outcome.overBudgetOnly`, every such trip, rather than from the page of
 * near misses, which is capped and would undercount.
 * Nothing is re-searched and nothing is estimated - each extra trip is a
 * trip with its own engine total, and the best of them is named by the
 * engine's own score.
 */

/** How far above the traveller's maximum each step looks. */
export const WHAT_IF_STEPS = [0.1, 0.2, 0.35] as const;

export interface BudgetStep {
  readonly ceiling: Money;
  /** Near misses this ceiling would let in. */
  readonly extraTrips: number;
  /** The best-scored of them, or null when there are none. */
  readonly best: RankedTrip | null;
}

/** Up to the next whole ten in the currency's major unit, so a ceiling reads as one. */
function roundUpToTen(value: Money): Money {
  const ten = 10 * 10 ** minorUnitExponent(value.currency);
  return money(Math.ceil(value.amount / ten) * ten, value.currency);
}

export function budgetWhatIf(outcome: SearchOutcome, profile: SearchProfile): BudgetStep[] {
  const sameCurrency = (total: Money) => total.currency === profile.maxBudget.currency;
  const onlyBudget = (trip: RankedTrip) =>
    trip.eligibility.violations.length > 0 &&
    trip.eligibility.violations.every((violation) => violation.code === 'OVER_MAX_BUDGET');

  // Counted from every trip turned away for price alone; the best is named
  // from the near misses kept, which are the ones the page can show.
  const totals = (outcome.overBudgetOnly ?? []).filter(sameCurrency);
  const shown = outcome.nearMisses.filter(
    (trip) => onlyBudget(trip) && sameCurrency(trip.cost.total),
  );

  return WHAT_IF_STEPS.map((step) => {
    const ceiling = roundUpToTen(scale(profile.maxBudget, 1 + step));
    const extraTrips = totals.filter((total) => lessThanOrEqual(total, ceiling)).length;
    const admitted = shown.filter((trip) => lessThanOrEqual(trip.cost.total, ceiling));
    const best = admitted.reduce<RankedTrip | null>(
      (top, trip) => (top === null || trip.score.score > top.score.score ? trip : top),
      null,
    );
    return { ceiling, extraTrips, best };
  });
}
