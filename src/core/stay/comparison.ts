import { compare, ratio, subtract, type Money } from '../money';
import type { CanonicalStay } from './identity';
import type { StayRate } from './types';

/**
 * Comparing one provider's price against another's, honestly.
 *
 * The arithmetic is the easy half. The hard half is that **two prices are
 * only comparable when they buy the same thing**, and a metasearch that
 * ignores that is not cheaper, it is misleading: a non-refundable room
 * without breakfast at 480 against a fully refundable room with breakfast at
 * 520 is not "40 cheaper", and presenting it that way sells somebody a worse
 * trip while telling them they won.
 *
 * So every comparison carries what differs alongside what it costs, and the
 * UI is expected to show both. Nothing here decides that a difference is
 * unimportant.
 */

/** A condition on which two rates differ materially. */
export type RateDifference =
  'cancellation' | 'board' | 'payment_timing' | 'room_type' | 'occupancy' | 'rooms';

/** A word for each, for a caption. Neutral: never "worse" or "better". */
export const DIFFERENCE_LABEL: Record<RateDifference, string> = {
  cancellation: 'different cancellation terms',
  board: 'different meals included',
  payment_timing: 'paid at a different time',
  room_type: 'a different room',
  occupancy: 'a different number of guests',
  rooms: 'a different number of rooms',
};

/**
 * What differs between two rates, beyond the price.
 *
 * An unknown on either side counts as a difference rather than a match. Two
 * rates where neither provider stated a cancellation policy are not
 * *known* to be equivalent, and saying so would be inventing agreement.
 */
export function differencesBetween(a: StayRate, b: StayRate): RateDifference[] {
  const differences: RateDifference[] = [];

  if (
    a.cancellation.refundable === null ||
    b.cancellation.refundable === null ||
    a.cancellation.refundable !== b.cancellation.refundable
  ) {
    differences.push('cancellation');
  }

  if (a.board === null || b.board === null || a.board !== b.board) differences.push('board');

  if (a.paymentTiming !== null && b.paymentTiming !== null && a.paymentTiming !== b.paymentTiming) {
    differences.push('payment_timing');
  }

  if (a.roomName && b.roomName && a.roomName !== b.roomName) differences.push('room_type');

  if (a.occupancy.adults !== b.occupancy.adults || a.occupancy.children !== b.occupancy.children) {
    differences.push('occupancy');
  }

  if (a.occupancy.rooms !== b.occupancy.rooms) differences.push('rooms');

  return differences;
}

/** True when two rates buy the same thing, so their prices may be compared flatly. */
export function isComparable(a: StayRate, b: StayRate): boolean {
  return differencesBetween(a, b).length === 0;
}

export interface PriceComparison {
  readonly rate: StayRate;
  /**
   * Total minus the reference's total. Negative is cheaper.
   *
   * `null` when the two are quoted in different currencies: converting here
   * would need a rate, and inventing one is forbidden. The caller converts
   * first through `core/fx.ts` if it wants a cross-currency comparison.
   */
  readonly difference: Money | null;
  /** The same as a fraction of the reference, e.g. `-0.042` for 4.2% cheaper. */
  readonly fraction: number | null;
  readonly perNightDifference: Money | null;
  readonly cheaper: boolean;
  /** True when this rate *is* the reference. */
  readonly isReference: boolean;
  /**
   * Conditions that differ from the reference.
   *
   * Non-empty means the headline number is not the whole story, and the UI
   * must say so rather than showing the difference alone.
   */
  readonly differences: readonly RateDifference[];
}

/**
 * Every rate measured against one the user chose.
 *
 * The reference is whichever rate was selected, not the cheapest: the
 * question being answered is "is there something better than the one I am
 * looking at", and that only makes sense measured from where they are.
 */
export function compareAgainst(reference: StayRate, rates: readonly StayRate[]): PriceComparison[] {
  return rates.map((rate) => {
    const sameCurrency = rate.total.currency === reference.total.currency;
    const isReference = rate.id === reference.id;

    const difference = sameCurrency ? subtract(rate.total, reference.total) : null;

    return {
      rate,
      difference,
      /*
       * A ratio against the reference, not against the cheaper of the two.
       * "4.2% cheaper than the one you picked" is a sentence somebody can
       * act on; "4.2% apart" is not.
       */
      fraction: sameCurrency ? ratio(subtract(rate.total, reference.total), reference.total) : null,
      perNightDifference: sameCurrency ? subtract(rate.perNight, reference.perNight) : null,
      cheaper: sameCurrency && compare(rate.total, reference.total) < 0,
      isReference,
      differences: isReference ? [] : differencesBetween(rate, reference),
    };
  });
}

/** Every rate across every provider for one property, flattened. */
export function ratesOf(stay: CanonicalStay): StayRate[] {
  return stay.offers.flatMap((offer) => offer.rates);
}

/**
 * The cheapest rate, and only among rates that are actually comparable.
 *
 * Taking the lowest number regardless of conditions is how a headline price
 * ends up being a non-refundable room nobody wanted. `among` lets a caller
 * restrict to, say, refundable rates first.
 */
export function cheapestRate(
  rates: readonly StayRate[],
  among: (rate: StayRate) => boolean = () => true,
): StayRate | null {
  const eligible = rates.filter(among);
  if (eligible.length === 0) return null;

  return eligible.reduce((best, rate) => {
    // Different currencies cannot be ranked without a rate, so the first
    // currency seen wins and the rest are left out of the contest.
    if (rate.total.currency !== best.total.currency) return best;

    return compare(rate.total, best.total) < 0 ? rate : best;
  });
}

/**
 * The cheapest price for a property, and who is offering it.
 *
 * What a hotel card leads with, and the reason the card can be rendered
 * without the UI knowing how many providers answered.
 */
export function bestRateFor(stay: CanonicalStay): StayRate | null {
  return cheapestRate(ratesOf(stay));
}
