/**
 * Price-drop alert thresholds, in one place. Integer arithmetic only.
 */

/** Fewer observations than this and there is no baseline: no alert, no guess. */
export const MIN_BASELINE_SAMPLES = 5;

/** How far back observations count toward the baseline. */
export const BASELINE_WINDOW_DAYS = 30;

/** A drop is material only when the new price is at most this percent of the median. */
export const MAX_PERCENT_OF_MEDIAN = 85;

/** ...and at least this many minor units (15.00 in a two-decimal currency) below it. */
export const MIN_DROP_MINOR = 1500;

/** The same watch and route is not alerted twice inside this window. */
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
