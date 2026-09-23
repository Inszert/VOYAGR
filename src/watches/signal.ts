import type { PriceTrend } from './trend';

/**
 * Buy or wait, read off what a watch has actually seen.
 *
 * Not a forecast. Nothing here knows what a price will do next; it says what
 * the recorded checks show - that the latest is the lowest yet, or that the
 * last few have been falling, rising or holding - and how many checks that
 * rests on. The page words it as an observation and says it is not a
 * prediction, because an airline fare is not obliged to follow its own trend.
 *
 * Three checks at least: two points are a change, not a direction.
 */

export type BuySignalKind = 'lowest' | 'falling' | 'rising' | 'steady';

export interface BuySignal {
  readonly kind: BuySignalKind;
  /** How many checks the reading rests on. */
  readonly checks: number;
}

/** Checks needed before a direction is worth stating. */
export const MIN_CHECKS_FOR_SIGNAL = 3;

export function buySignal(trend: PriceTrend): BuySignal | null {
  const amounts = trend.points.map((point) => point.lowest.amount);
  if (amounts.length < MIN_CHECKS_FOR_SIGNAL) return null;

  const latest = amounts[amounts.length - 1]!;
  const earlier = amounts.slice(0, -1);
  const [a, b, c] = amounts.slice(-3) as [number, number, number];

  let kind: BuySignalKind;
  if (latest < Math.min(...earlier)) kind = 'lowest';
  else if (a > b && b > c) kind = 'falling';
  else if (a < b && b < c) kind = 'rising';
  else kind = 'steady';

  return { kind, checks: amounts.length };
}
