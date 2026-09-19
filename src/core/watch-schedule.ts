import type { Entitlements } from './entitlements';

/**
 * When a Travel Watch should next run (specification section 17).
 *
 * Deterministic and pure: the same inputs always give the same answer, which is
 * what lets a scheduler be tested without waiting for real time to pass.
 *
 * The cadence is a product decision, not a technical one. Checking a trip every
 * few minutes would burn provider quota to tell a user nothing new, and
 * checking it weekly would miss the fare that was cheap for a day.
 */

export type WatchPriority = 'normal' | 'high';

/**
 * Base cadence per priority, in hours.
 *
 * Section 17's ranges are 6-12 hours normally and 1-3 hours for a high-priority
 * watch. The lower end of each is used as the base and the plan's floor is
 * applied on top, so the range is where policy lives rather than where a
 * surprise does.
 */
const BASE_INTERVAL_HOURS: Record<WatchPriority, number> = {
  normal: 6,
  high: 1,
};

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export interface ScheduleInput {
  readonly priority: WatchPriority;
  readonly entitlements: Entitlements;
  /** Now, as epoch milliseconds. Passed in; this module owns no clock. */
  readonly now: number;
}

/**
 * The interval a watch may actually use.
 *
 * The plan's floor always wins. A free-tier user who marks a watch high
 * priority gets their plan's minimum, not the high-priority base - otherwise
 * the priority flag would be a way around the entitlement, and §24.2 would have
 * nothing left to sell.
 */
export function resolveIntervalHours(input: Omit<ScheduleInput, 'now'>): number {
  return Math.max(BASE_INTERVAL_HOURS[input.priority], input.entitlements.minRefreshIntervalHours);
}

/** The ISO timestamp a watch should next be picked up at. */
export function nextRunAt(input: ScheduleInput): string {
  const hours = resolveIntervalHours(input);
  return new Date(input.now + hours * MILLISECONDS_PER_HOUR).toISOString();
}

/**
 * Whether a watch is due.
 *
 * A separate function rather than a comparison at the call site, so "due" means
 * one thing everywhere: the scheduler, the UI that says "checking soon" and any
 * test all agree.
 */
export function isDue(nextRunAtIso: string, now: number): boolean {
  return Date.parse(nextRunAtIso) <= now;
}

/** Whole minutes until a watch runs. Negative when it is already due. */
export function minutesUntilRun(nextRunAtIso: string, now: number): number {
  return Math.round((Date.parse(nextRunAtIso) - now) / 60_000);
}
