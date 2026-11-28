import { BASELINE_WINDOW_DAYS, MIN_BASELINE_SAMPLES } from './constants';

/**
 * Price baseline for one route and month bucket. Pure: "now" is passed in, never read.
 *
 * The baseline is the median of the cheapest-price observations of the last 30 days. With
 * fewer than `MIN_BASELINE_SAMPLES` of them there is no baseline (null), never a guess.
 */

export interface RouteObservation {
  readonly id: string;
  /** Cheapest price of that lookup, minor units. */
  readonly cheapestMinor: number;
  readonly currency: string;
  /** Real instant, UTC ISO. */
  readonly observedAt: string;
  /** Month of departure, `YYYY-MM`. */
  readonly month: string;
}

export interface Baseline {
  readonly medianMinor: number;
  readonly sampleCount: number;
  readonly currency: string;
}

export interface BaselineQuery {
  readonly month: string;
  readonly currency: string;
  /** The current instant, UTC ISO, passed in by the caller. */
  readonly now: string;
  readonly windowDays?: number;
  readonly minSamples?: number;
}

/** Median of integers; an even count takes the floor of the mean of the middle two. */
export function medianMinor(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.floor(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

export function computeBaseline(
  observations: readonly RouteObservation[],
  query: BaselineQuery,
): Baseline | null {
  const nowMs = Date.parse(query.now);
  if (Number.isNaN(nowMs)) return null;
  const windowMs = (query.windowDays ?? BASELINE_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const minSamples = query.minSamples ?? MIN_BASELINE_SAMPLES;

  const values: number[] = [];
  for (const o of observations) {
    if (o.month !== query.month || o.currency !== query.currency) continue;
    if (!Number.isInteger(o.cheapestMinor) || o.cheapestMinor < 0) continue;
    const at = Date.parse(o.observedAt);
    // An observation from the future is not believed; one older than the window is stale.
    if (Number.isNaN(at) || at > nowMs || nowMs - at > windowMs) continue;
    values.push(o.cheapestMinor);
  }

  if (values.length < minSamples) return null;
  const median = medianMinor(values);
  return median === null
    ? null
    : { medianMinor: median, sampleCount: values.length, currency: query.currency };
}
