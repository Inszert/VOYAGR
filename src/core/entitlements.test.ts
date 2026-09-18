import { describe, expect, it } from 'vitest';
import {
  canCreateWatch,
  capToEntitlement,
  DEFAULT_PLAN_ID,
  isPlanId,
  PLAN_IDS,
  refreshIntervalHours,
  resolveEntitlements,
} from './entitlements';

describe('resolveEntitlements', () => {
  it('answers for every plan it claims to support', () => {
    for (const planId of PLAN_IDS) {
      const entitlements = resolveEntitlements(planId);
      expect(entitlements.planId).toBe(planId);
      expect(entitlements.maxActiveWatches).toBeGreaterThan(0);
      expect(entitlements.minRefreshIntervalHours).toBeGreaterThan(0);
    }
  });

  it('falls back to the default rather than throwing on an unknown plan', () => {
    // A row carrying a plan this build does not know - a rollback, a
    // half-finished migration - must not lock a user out of their account.
    expect(resolveEntitlements('enterprise-platinum').planId).toBe(DEFAULT_PLAN_ID);
    expect(resolveEntitlements(undefined).planId).toBe(DEFAULT_PLAN_ID);
    expect(resolveEntitlements('').planId).toBe(DEFAULT_PLAN_ID);
  });

  it('recognises only real plan ids', () => {
    expect(isPlanId('free')).toBe(true);
    expect(isPlanId('Free')).toBe(false);
    expect(isPlanId('pro')).toBe(false);
  });
});

describe('entitlement ceilings', () => {
  const free = resolveEntitlements('free');

  it('lets the lower of requested and allowed win', () => {
    expect(capToEntitlement(20, free.maxDestinationsPerSearch)).toBe(free.maxDestinationsPerSearch);
    expect(capToEntitlement(2, free.maxDestinationsPerSearch)).toBe(2);
  });

  it('allows watches up to the limit and not past it', () => {
    expect(canCreateWatch(free.maxActiveWatches - 1, free)).toBe(true);
    expect(canCreateWatch(free.maxActiveWatches, free)).toBe(false);
    expect(canCreateWatch(free.maxActiveWatches + 5, free)).toBe(false);
  });

  it('never refreshes faster than the plan floor', () => {
    // A user asking for hourly polling on a free plan gets the floor, not the ask.
    expect(refreshIntervalHours(1, free)).toBe(free.minRefreshIntervalHours);
    expect(refreshIntervalHours(24, free)).toBe(24);
  });
});
