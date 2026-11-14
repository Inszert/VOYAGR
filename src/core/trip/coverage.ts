import type { CostCategory, CostLine } from './types';

/**
 * What a trip total does and does not cover.
 *
 * "All in" is a claim about the whole trip, so it is made here, once, from the
 * cost lines the engine tagged `excluded` - never by a component deciding the
 * phrase sounds right. A total that leaves a stay or a transfer out is still a
 * true number; calling it "all in" is what would make it a false one.
 */

export interface CostCoverage {
  /** True only when no line was left out of the total. */
  readonly allIn: boolean;
  /** The categories left out, each once, in the order they were found. */
  readonly excluded: readonly CostCategory[];
}

const NOT_INCLUDED_NAME: Partial<Record<CostCategory, string>> = {
  hotel: 'stay',
  hotel_fees: 'local taxes and fees',
  transfer: 'airport transfer',
  flight_fees: 'flight fees',
  local_transport: 'local transport',
  car_rental: 'car hire',
};

export function costCoverage(excluded: readonly Pick<CostLine, 'category'>[]): CostCoverage {
  const categories = [...new Set(excluded.map((line) => line.category))];
  return { allIn: categories.length === 0, excluded: categories };
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/**
 * What a total leaves out, in words. Null when it leaves nothing out.
 *
 * A missing stay is the one that changes what the number means - the total is
 * then flights - so it leads: "Flights only — stay not included".
 */
export function describeExclusions(excluded: readonly CostCategory[]): string | null {
  if (excluded.length === 0) return null;

  const names = [
    ...new Set(excluded.map((category) => NOT_INCLUDED_NAME[category] ?? 'some costs')),
  ];

  if (excluded.includes('hotel')) return `Flights only — ${joinWords(names)} not included`;

  const sentence = `${joinWords(names)} not included`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * The sentence that goes under a cheapest total on the map.
 *
 * `all in` appears exactly when nothing was excluded; otherwise the sentence
 * says what is missing from the number instead.
 */
export function cheapestTripStatement(excluded: readonly CostCategory[]): string {
  const missing = describeExclusions(excluded);
  return missing === null
    ? 'Cheapest trip found here, all in.'
    : `Cheapest trip found here. ${missing}.`;
}
