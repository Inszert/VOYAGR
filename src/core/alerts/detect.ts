import type { Baseline } from './baseline';
import { DEDUPE_WINDOW_MS, MAX_PERCENT_OF_MEDIAN, MIN_DROP_MINOR } from './constants';

/**
 * Is a new cheapest price a material drop worth an alert? Pure, integer arithmetic only.
 *
 * Material: at most `maxPercentOfMedian` percent of the median AND at least `minDropMinor` below
 * it. Both are exact at the boundary (the percent test is cross-multiplied, no division).
 */

export interface RecentAlert {
  readonly watchId: string;
  readonly routeKey: string;
  readonly observationId: string;
  /** UTC ISO instant the alert was raised. */
  readonly createdAt: string;
}

export interface DetectInput {
  readonly watchId: string;
  /** Route and month bucket, e.g. `VIE-LIS-2027-03`. */
  readonly routeKey: string;
  readonly observationId: string;
  readonly newMinor: number;
  readonly currency: string;
  readonly baseline: Baseline | null;
  readonly recentAlerts: readonly RecentAlert[];
  /** Current instant, UTC ISO, passed in. */
  readonly now: string;
  readonly maxPercentOfMedian?: number;
  readonly minDropMinor?: number;
  readonly dedupeWindowMs?: number;
}

export interface PriceDropAlert {
  readonly watchId: string;
  readonly routeKey: string;
  readonly observationId: string;
  readonly currency: string;
  readonly newMinor: number;
  readonly medianMinor: number;
  readonly dropMinor: number;
  readonly sampleCount: number;
}

export type DetectReason =
  | 'alert'
  | 'no_baseline'
  | 'invalid_price'
  | 'currency_mismatch'
  | 'not_material'
  | 'duplicate_observation'
  | 'duplicate_window';

export interface DetectResult {
  readonly alert: PriceDropAlert | null;
  readonly reason: DetectReason;
}

const none = (reason: DetectReason): DetectResult => ({ alert: null, reason });

export function detectPriceDrop(input: DetectInput): DetectResult {
  const { baseline } = input;
  if (!baseline) return none('no_baseline');
  if (!Number.isInteger(input.newMinor) || input.newMinor < 0) return none('invalid_price');
  if (baseline.currency !== input.currency) return none('currency_mismatch');

  const maxPercent = input.maxPercentOfMedian ?? MAX_PERCENT_OF_MEDIAN;
  const minDrop = input.minDropMinor ?? MIN_DROP_MINOR;
  const drop = baseline.medianMinor - input.newMinor;

  const withinPercent = input.newMinor * 100 <= baseline.medianMinor * maxPercent;
  if (!withinPercent || drop < minDrop) return none('not_material');

  if (input.recentAlerts.some((a) => a.observationId === input.observationId)) {
    return none('duplicate_observation');
  }
  const nowMs = Date.parse(input.now);
  const windowMs = input.dedupeWindowMs ?? DEDUPE_WINDOW_MS;
  const sameRoute = input.recentAlerts.filter(
    (a) => a.watchId === input.watchId && a.routeKey === input.routeKey,
  );
  if (sameRoute.some((a) => nowMs - Date.parse(a.createdAt) < windowMs)) {
    return none('duplicate_window');
  }

  return {
    reason: 'alert',
    alert: {
      watchId: input.watchId,
      routeKey: input.routeKey,
      observationId: input.observationId,
      currency: input.currency,
      newMinor: input.newMinor,
      medianMinor: baseline.medianMinor,
      dropMinor: drop,
      sampleCount: baseline.sampleCount,
    },
  };
}
