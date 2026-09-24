import { sum, type Money } from '../money';
import type { TripCost } from './cost';
import type { CostCategory, CostLine } from './types';

/**
 * Where the money in a trip goes (implementation plan 3.6).
 *
 * Shares of the total by part of the trip, read from the cost engine's own
 * counted lines - nothing is re-priced here. Excluded lines are not part of the
 * total, so they cannot have a share of it; they are returned by name instead,
 * so a breakdown that says "flights 61%" can also say what it left out.
 *
 * Shares are whole percentages that add up to exactly 100, by largest
 * remainder, so the rows never sum to 99 or 101 on the page.
 */

export type AllocationPart = 'flights' | 'stay' | 'getting_around' | 'other';

const PART_OF: Record<CostCategory, AllocationPart> = {
  flight: 'flights',
  flight_fees: 'flights',
  hotel: 'stay',
  hotel_fees: 'stay',
  transfer: 'getting_around',
  local_transport: 'getting_around',
  car_rental: 'getting_around',
  parking: 'getting_around',
  food: 'other',
  activities: 'other',
  other: 'other',
};

const PART_ORDER: readonly AllocationPart[] = ['flights', 'stay', 'getting_around', 'other'];

export interface AllocationShare {
  readonly part: AllocationPart;
  readonly amount: Money;
  /** Whole percent of the counted total, 0-100. */
  readonly percent: number;
}

export interface BudgetAllocation {
  /** In a fixed order, and only parts the trip actually spends on. */
  readonly shares: readonly AllocationShare[];
  /** Costs not in the total, named so they are not mistaken for free. */
  readonly excluded: readonly CostLine[];
}

export function budgetAllocation(cost: TripCost): BudgetAllocation {
  const counted = cost.lines.filter((line) => line.confidence !== 'excluded');

  const amounts = PART_ORDER.map((part) => ({
    part,
    amount: sum(
      counted.filter((line) => PART_OF[line.category] === part).map((line) => line.amount),
      cost.currency,
    ),
  })).filter((entry) => entry.amount.amount > 0);

  const total = amounts.reduce((running, entry) => running + entry.amount.amount, 0);
  if (total <= 0) return { shares: [], excluded: cost.excluded };

  // Largest remainder: floor every share, then hand the missing points to the
  // largest fractions, ties to the earlier part so the result is stable.
  const exact = amounts.map((entry) => (entry.amount.amount * 100) / total);
  const floors = exact.map(Math.floor);
  let missing = 100 - floors.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    missing -= 1;
  }

  return {
    shares: amounts.map((entry, index) => ({ ...entry, percent: floors[index] ?? 0 })),
    excluded: cost.excluded,
  };
}
