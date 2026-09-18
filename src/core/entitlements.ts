/**
 * Plans and entitlements (specification sections 24.2 and 24.3).
 *
 * Exactly one plan ships today, and that is fine. What is not fine is any
 * feature reading a constant instead of asking a plan what it allows: a watch
 * limit written as `if (watches.length >= 10)` makes a paid tier a rewrite,
 * while the same limit read from here makes it a new row in this table.
 *
 * Deterministic and pure, like everything else in `src/core/`. Nothing here
 * knows about money, billing or a payment provider - those arrive with §24.2
 * itself. This answers one question: given a plan, what is allowed?
 */

export const PLAN_IDS = ['free'] as const;

export type PlanId = (typeof PLAN_IDS)[number];

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** Named so a feature gate reads as a question about capability, not about tier. */
export interface Entitlements {
  readonly planId: PlanId;
  readonly planName: string;
  /** Watches allowed to be `active` at once. */
  readonly maxActiveWatches: number;
  /** Floor on how often a watch may be refreshed, in hours (section 17). */
  readonly minRefreshIntervalHours: number;
  /** Ceiling the search planner applies on top of its own bounds. */
  readonly maxDestinationsPerSearch: number;
  readonly maxSavedSearches: number;
  /** Whether a watch may ask for the faster refresh cadence. */
  readonly canPrioritiseWatches: boolean;
  /** Whether AI-written explanations are offered (§24.5 premium AI). */
  readonly canUseAiExplanations: boolean;
}

/**
 * The plan table.
 *
 * A second plan is a second entry here plus a column on `users` that already
 * exists. Deliberately written out in full rather than as a base plus overrides:
 * a reader should be able to see everything a plan allows without resolving an
 * inheritance chain in their head.
 */
const PLANS: Record<PlanId, Entitlements> = {
  free: {
    planId: 'free',
    planName: 'Free',
    maxActiveWatches: 3,
    minRefreshIntervalHours: 6,
    maxDestinationsPerSearch: 6,
    maxSavedSearches: 10,
    canPrioritiseWatches: false,
    canUseAiExplanations: true,
  },
};

/** The plan a user gets when none is recorded. */
export const DEFAULT_PLAN_ID: PlanId = 'free';

/**
 * Resolve what a plan allows.
 *
 * An unrecognised plan falls back to the default rather than throwing. A row
 * carrying a plan id this build does not know about - a downgrade, a rollback,
 * a half-finished migration - must not lock a user out of their own account;
 * it must give them the free tier and let someone notice.
 */
export function resolveEntitlements(planId: string = DEFAULT_PLAN_ID): Entitlements {
  return PLANS[isPlanId(planId) ? planId : DEFAULT_PLAN_ID];
}

/**
 * Apply an entitlement ceiling to a requested value.
 *
 * The caller says what it wants, the plan says what it may have, and the lower
 * of the two wins. Exists so call sites read `capToEntitlement(requested,
 * entitlements.maxDestinationsPerSearch)` rather than reimplementing `Math.min`
 * with a hard-coded number beside it.
 */
export function capToEntitlement(requested: number, allowed: number): number {
  return Math.min(requested, allowed);
}

/** Whether another active watch may be created. */
export function canCreateWatch(activeWatches: number, entitlements: Entitlements): boolean {
  return activeWatches < entitlements.maxActiveWatches;
}

/** The refresh interval a watch may actually use, given what the plan allows. */
export function refreshIntervalHours(requestedHours: number, entitlements: Entitlements): number {
  return Math.max(requestedHours, entitlements.minRefreshIntervalHours);
}
