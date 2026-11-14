import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildRankedTrip } from '@/components/search/test-support';
import { dealAgainstTypical } from './deal-score';
import { summariseDestinations } from './destinations';

/**
 * A trip against its destination's typical total.
 *
 * Defended: "typical" is a real trip's total from the same search, the
 * difference is exact, and nothing is said on too little evidence.
 */

const trips = [30_000, 34_000, 40_000, 52_000].map((amount, index) =>
  buildRankedTrip({
    id: `trip-${index}`,
    hotel: { ...buildRankedTrip().candidate.hotel!, totalPrice: money(amount, 'EUR') },
  }),
);

describe('dealAgainstTypical', () => {
  it('measures a trip from the typical total of its destination', () => {
    const summaries = summariseDestinations(trips);
    const typical = summaries[0]!.typicalTotal;

    // Four totals: the lower middle is the second cheapest trip's own total.
    expect(typical).toEqual(trips[1]!.cost.total);

    const deal = dealAgainstTypical(trips[0]!, summaries)!;
    expect(deal.basis).toBe(4);
    expect(deal.difference.amount).toBe(trips[0]!.cost.total.amount - typical.amount);
    expect(deal.difference.amount).toBeLessThan(0);
  });

  it('says nothing with too few trips to have a typical one', () => {
    const few = trips.slice(0, 2);
    expect(dealAgainstTypical(few[0]!, summariseDestinations(few))).toBeNull();
  });
});
