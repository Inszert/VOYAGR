import { money, multiply, MoneyError, type Money } from './money';

/**
 * A price for one traveller, and the same price for the whole party.
 *
 * Every figure the product shows is for a stated number of travellers, and
 * the two directions between "each" and "all of you" are not symmetric:
 *
 *  - **Each to all** is exact. A cached fare quoted for one adult, times four
 *    adults, is four times the fare to the cent (`forParty`).
 *  - **All to each** generally is not. €100.01 for three people has no exact
 *    third, so `perTraveller` returns the share **rounded down to the minor
 *    unit** and the minor units left over. The share is what a page shows as
 *    "per person"; the party total stays the authoritative figure, and
 *    `share × travellers + remainder` always equals it exactly. Rounding down
 *    rather than to nearest means a per-person figure never promises a share
 *    of more money than the total holds.
 *
 * Pure: no I/O, no clock, no rounding anywhere but the one documented above.
 */

export class PartyError extends MoneyError {
  constructor(message: string) {
    super(message);
    this.name = 'PartyError';
  }
}

function assertTravellers(travellers: number): void {
  if (!Number.isSafeInteger(travellers) || travellers < 1) {
    throw new PartyError(`travellers must be a positive integer, received ${travellers}`);
  }
}

/** A price quoted for one traveller, for `travellers` of them. Exact. */
export function forParty(each: Money, travellers: number): Money {
  assertTravellers(travellers);
  return multiply(each, travellers);
}

export interface PerTravellerShare {
  /** The total divided by the party, rounded down to the minor unit. */
  readonly each: Money;
  /** Minor units the even split could not place: `total - each × travellers`. */
  readonly remainder: Money;
}

/**
 * The party total, per traveller.
 *
 * For a negative amount (a difference, "€12.40 cheaper") the share is rounded
 * toward zero instead, so a saving per person is never overstated either; the
 * remainder then carries the same sign as the total.
 */
export function perTraveller(total: Money, travellers: number): PerTravellerShare {
  assertTravellers(travellers);
  return evenShare(total, travellers);
}

/**
 * The same split for any count of equal parts - nights in a stay, say - with
 * the same rounding: toward zero, to the minor unit, remainder reported.
 */
export function evenShare(total: Money, parts: number): PerTravellerShare {
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new PartyError(`parts must be a positive integer, received ${parts}`);
  }

  const each = Math.trunc(total.amount / parts);
  return {
    each: money(each, total.currency),
    remainder: money(total.amount - each * parts, total.currency),
  };
}

/** "1 traveller", "4 travellers": the basis a block states once. */
export function travellersLabel(travellers: number): string {
  return `${travellers} ${travellers === 1 ? 'traveller' : 'travellers'}`;
}
