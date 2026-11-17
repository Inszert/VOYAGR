/**
 * How nature-rich and food-rich a destination is, from the things to do it has.
 *
 * Pure: it is handed the counts by kind that the places cache holds and does the
 * division. A share is a number from 0 to 1, or `null` when the data does not
 * exist - no cache entry, or no places with a kind. `null` is never turned into
 * 0, because "we do not know" is not "there is none".
 */

export interface InterestShares {
  /** Outdoors and beaches, as a share of all places with a kind. */
  readonly nature: number | null;
  /** Food, as a share of all places with a kind. */
  readonly food: number | null;
}

export const NATURE_KINDS = ['outdoors', 'beaches'] as const;
export const FOOD_KINDS = ['food'] as const;

export const NO_INTEREST_SHARES: InterestShares = { nature: null, food: null };

export function interestShares(
  counts: Readonly<Record<string, number>> | null | undefined,
): InterestShares {
  if (!counts) return NO_INTEREST_SHARES;

  const valid = (value: number | undefined): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;

  let total = 0;
  for (const value of Object.values(counts)) total += valid(value);
  if (total === 0) return NO_INTEREST_SHARES;

  const share = (kinds: readonly string[]): number => {
    let part = 0;
    for (const kind of kinds) part += valid(counts[kind]);
    return Math.min(1, part / total);
  };

  return { nature: share(NATURE_KINDS), food: share(FOOD_KINDS) };
}
