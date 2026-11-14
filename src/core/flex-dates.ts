import { addDays, daysBetween } from './dates';
import { DEFAULT_DEAL_THRESHOLDS, detectDeal, type DealThresholds } from './deal-detection';
import { ageOf, DEFAULT_FRESHNESS, freshnessOf, type Freshness } from './freshness';
import { subtract, type Money } from './money';
import type { IsoDate, IsoDateTime } from './trip/types';

/**
 * Flying a few days earlier or later (finish plan D7).
 *
 * Given the dates somebody chose and the cheapest flight observed on each
 * nearby day, says what moving the whole trip - same number of nights - would
 * cost or save. Pure: the clock arrives as `now`, and nothing is read from a
 * provider here.
 *
 * **A day nobody priced is `unknown`, and stays so.** It is never the average
 * of its neighbours and never zero. A difference exists only when both prices
 * are known and in one currency; two currencies need a dated rate this module
 * does not have, so the difference is unknown rather than guessed.
 */

/** The widest window the product offers. Mirrors the `FLEX_DAYS` bound in env. */
export const MAX_FLEX_DAYS = 7;

/** A price somebody observed for leaving on one day. */
export interface FlexDayPrice {
  readonly price: Money;
  readonly observedAt: IsoDateTime | null;
}

export interface FlexOption {
  /** Days from the chosen departure. Negative is earlier. Zero is the chosen day. */
  readonly offset: number;
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  /** Null is `unknown`: nothing was observed for this day. */
  readonly price: Money | null;
  readonly observedAt: IsoDateTime | null;
  /**
   * What the chosen dates cost minus what these cost: positive saves, negative
   * costs more. Null unless both prices are known and in the same currency.
   */
  readonly saving: Money | null;
  /** `unknown` for a day with no price, as well as for one nobody dated. */
  readonly freshness: Freshness;
}

export interface FlexInput {
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  /** Days either side, 0 to `MAX_FLEX_DAYS`. */
  readonly windowDays: number;
  readonly prices: ReadonlyMap<IsoDate, FlexDayPrice>;
  readonly now: number;
}

export class FlexDatesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlexDatesError';
  }
}

export function flexOptions(input: FlexInput): FlexOption[] {
  const { windowDays } = input;

  if (!Number.isSafeInteger(windowDays) || windowDays < 0 || windowDays > MAX_FLEX_DAYS) {
    throw new FlexDatesError(
      `Flex window must be a whole number of days from 0 to ${MAX_FLEX_DAYS}, received ${windowDays}`,
    );
  }

  const nights = daysBetween(input.departureDate, input.returnDate);
  if (nights < 0) {
    throw new FlexDatesError(
      `Return ${input.returnDate} is before departure ${input.departureDate}`,
    );
  }

  const chosen = input.prices.get(input.departureDate)?.price ?? null;
  const options: FlexOption[] = [];

  for (let offset = -windowDays; offset <= windowDays; offset += 1) {
    const departureDate = addDays(input.departureDate, offset);
    const found = input.prices.get(departureDate) ?? null;
    const price = found?.price ?? null;

    options.push({
      offset,
      departureDate,
      // The same number of nights: this is the whole trip moving, not a longer
      // or shorter one.
      returnDate: addDays(departureDate, nights),
      price,
      observedAt: price ? (found?.observedAt ?? null) : null,
      saving:
        price && chosen && price.currency === chosen.currency ? subtract(chosen, price) : null,
      freshness: price
        ? freshnessOf(found?.observedAt, input.now, DEFAULT_FRESHNESS.flights)
        : 'unknown',
    });
  }

  return options;
}

export interface FlexSaving {
  readonly option: FlexOption;
  /** Always positive. */
  readonly saving: Money;
}

/**
 * The largest saving that is worth saying out loud, or null.
 *
 * "Worth saying" is `detectDeal`'s own bar - the absolute and the relative
 * threshold together - rather than a second definition of materiality: a
 * saving is news on this strip exactly when it would be news in an alert.
 * Ties go to the day nearest the chosen one, then to the earlier day, because
 * a smaller change to somebody's plans is the better of two equal prices.
 */
export function bestSaving(
  options: readonly FlexOption[],
  thresholds: DealThresholds = DEFAULT_DEAL_THRESHOLDS,
): FlexSaving | null {
  const chosen = options.find((option) => option.offset === 0)?.price ?? null;
  if (!chosen) return null;

  let best: FlexSaving | null = null;

  for (const option of options) {
    if (option.offset === 0 || !option.price || !option.saving) continue;

    const verdict = detectDeal({ current: option.price, previousBest: chosen, thresholds });
    if (!verdict.material) continue;

    const better =
      best === null ||
      option.saving.amount > best.saving.amount ||
      (option.saving.amount === best.saving.amount &&
        (Math.abs(option.offset) < Math.abs(best.option.offset) ||
          (Math.abs(option.offset) === Math.abs(best.option.offset) &&
            option.offset < best.option.offset)));

    if (better) best = { option, saving: option.saving };
  }

  return best;
}

/**
 * How old the oldest price behind a strip is, or null when any is undated.
 *
 * Only prices that are shown count; an unpriced day has no age. One undated
 * price makes the whole age unknown rather than quietly ignoring it.
 */
export function oldestAgeMs(options: readonly FlexOption[], now: number): number | null {
  let oldest: number | null = null;

  for (const option of options) {
    if (!option.price) continue;

    const age = ageOf(option.observedAt, now);
    if (age === null) return null;
    if (oldest === null || age > oldest) oldest = age;
  }

  return oldest;
}
