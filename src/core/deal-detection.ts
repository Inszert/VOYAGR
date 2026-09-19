import { greaterThan, isNegative, subtract, type Money } from './money';

/**
 * Deal detection (implementation plan 1.8).
 *
 * Decides whether a price change is worth interrupting someone for. Pure and
 * deterministic: the same numbers always give the same verdict, and no model is
 * consulted. A model may later *word* an alert; it never decides that one is
 * warranted, and it never assigns a severity.
 *
 * The judgement has to clear two bars at once, because either alone is wrong:
 *
 *  - A **percentage** bar, or a EUR 40 drop on a EUR 4,000 trip counts as news
 *    when it is a rounding error.
 *  - An **absolute** bar, or a 5% drop on a EUR 60 flight counts as news when
 *    it is three euro.
 *
 * The specification's own example is the test: a EUR 2 drop on EUR 240 is not
 * an alert. It fails both bars.
 */

export type DealSeverity = 'important' | 'interesting' | 'fyi';

export interface DealThresholds {
  /** Smallest drop worth mentioning at all, in minor units. */
  readonly minimumDropMinorUnits: number;
  /** Smallest drop worth mentioning, as a share of the previous best, 0-1. */
  readonly minimumDropShare: number;
  /** At or above this share, the drop is important rather than interesting. */
  readonly importantDropShare: number;
  /** A drop this large is important regardless of share, in minor units. */
  readonly importantDropMinorUnits: number;
}

/**
 * Defaults.
 *
 * Deliberately values rather than magic numbers buried in a comparison, so
 * changing the product's sensitivity is an edit to one object that every test
 * and every explanation reads from.
 */
export const DEFAULT_DEAL_THRESHOLDS: DealThresholds = {
  // EUR 15 on a trip costing hundreds is the smallest drop most people would
  // thank you for being told about mid-afternoon.
  minimumDropMinorUnits: 1_500,
  minimumDropShare: 0.03,
  importantDropShare: 0.1,
  importantDropMinorUnits: 10_000,
};

export interface DealInput {
  /** The total just observed. */
  readonly current: Money;
  /**
   * The cheapest total previously recorded, or null when this is the first
   * observation. A first observation is never a deal: there is nothing it is
   * better than, and "we found a trip" is not the same news as "it got cheaper".
   */
  readonly previousBest: Money | null;
  readonly thresholds?: DealThresholds;
}

export interface DealVerdict {
  /** Whether this change is worth telling the user about. */
  readonly material: boolean;
  readonly severity: DealSeverity;
  /** How much cheaper than the previous best. Zero when not an improvement. */
  readonly drop: Money;
  /** The drop as a share of the previous best, 0-1. */
  readonly dropShare: number;
  /**
   * Why the verdict went the way it did, in a form a UI can show and a test can
   * assert on. Never prose written by a model.
   */
  readonly reason:
    | 'first-observation'
    | 'not-cheaper'
    | 'below-absolute-threshold'
    | 'below-relative-threshold'
    | 'material-drop'
    | 'currency-changed';
}

function verdict(
  material: boolean,
  severity: DealSeverity,
  drop: Money,
  dropShare: number,
  reason: DealVerdict['reason'],
): DealVerdict {
  return { material, severity, drop, dropShare, reason };
}

/**
 * Assign severity to a drop that has already been judged material.
 *
 * Either bar promotes it: a large share of a small trip and a large absolute
 * sum off a big one are both worth more attention than a marginal change.
 */
function severityFor(drop: Money, dropShare: number, thresholds: DealThresholds): DealSeverity {
  if (
    dropShare >= thresholds.importantDropShare ||
    drop.amount >= thresholds.importantDropMinorUnits
  ) {
    return 'important';
  }

  return 'interesting';
}

/**
 * Decide whether an observed total is a deal.
 *
 * @throws never. An unusable comparison is a verdict, not an exception: this
 *   runs inside a background refresh, and a thrown error there is a watch that
 *   silently stops rather than a message nobody needed.
 */
export function detectDeal(input: DealInput): DealVerdict {
  const thresholds = input.thresholds ?? DEFAULT_DEAL_THRESHOLDS;
  const zeroDrop = { amount: 0, currency: input.current.currency };

  if (input.previousBest === null) {
    return verdict(false, 'fyi', zeroDrop, 0, 'first-observation');
  }

  // Comparing across currencies is meaningless rather than favourable, and
  // `subtract` would throw. A changed search currency is not a price drop.
  if (input.previousBest.currency !== input.current.currency) {
    return verdict(false, 'fyi', zeroDrop, 0, 'currency-changed');
  }

  if (!greaterThan(input.previousBest, input.current)) {
    return verdict(false, 'fyi', zeroDrop, 0, 'not-cheaper');
  }

  const drop = subtract(input.previousBest, input.current);
  const dropShare = input.previousBest.amount === 0 ? 0 : drop.amount / input.previousBest.amount;

  if (drop.amount < thresholds.minimumDropMinorUnits) {
    return verdict(false, 'fyi', drop, dropShare, 'below-absolute-threshold');
  }

  if (dropShare < thresholds.minimumDropShare) {
    return verdict(false, 'fyi', drop, dropShare, 'below-relative-threshold');
  }

  return verdict(true, severityFor(drop, dropShare, thresholds), drop, dropShare, 'material-drop');
}

/** True when a verdict should become an alert. Reads better than `.material`. */
export function isAlertWorthy(result: DealVerdict): boolean {
  return result.material && !isNegative(result.drop);
}
