import { describe, expect, it } from 'vitest';
import { resolveEntitlements } from './entitlements';
import { isDue, minutesUntilRun, nextRunAt, resolveIntervalHours } from './watch-schedule';

const free = resolveEntitlements('free');
const NOW = Date.parse('2026-09-19T12:00:00.000Z');

describe('resolveIntervalHours', () => {
  it('uses the normal cadence when the plan allows it', () => {
    expect(resolveIntervalHours({ priority: 'normal', entitlements: free })).toBe(
      Math.max(6, free.minRefreshIntervalHours),
    );
  });

  it('never lets priority beat the plan floor', () => {
    // Otherwise the priority flag is a way around the entitlement, and section
    // 24.2 has nothing left to sell.
    const interval = resolveIntervalHours({ priority: 'high', entitlements: free });
    expect(interval).toBeGreaterThanOrEqual(free.minRefreshIntervalHours);
  });

  it('lets a more generous plan actually be faster', () => {
    const generous = { ...free, minRefreshIntervalHours: 1 };
    expect(resolveIntervalHours({ priority: 'high', entitlements: generous })).toBe(1);
    expect(resolveIntervalHours({ priority: 'normal', entitlements: generous })).toBe(6);
  });
});

describe('nextRunAt', () => {
  it('schedules the interval ahead of now', () => {
    const scheduled = nextRunAt({ priority: 'normal', entitlements: free, now: NOW });
    const hours = resolveIntervalHours({ priority: 'normal', entitlements: free });

    expect(Date.parse(scheduled) - NOW).toBe(hours * 3_600_000);
  });

  it('is deterministic', () => {
    const input = { priority: 'normal', entitlements: free, now: NOW } as const;
    expect(nextRunAt(input)).toBe(nextRunAt(input));
  });
});

describe('isDue and minutesUntilRun', () => {
  it('treats the deadline itself as due', () => {
    const at = new Date(NOW).toISOString();
    expect(isDue(at, NOW)).toBe(true);
    expect(isDue(at, NOW + 1)).toBe(true);
    expect(isDue(at, NOW - 1)).toBe(false);
  });

  it('counts minutes forward and backward', () => {
    const inTwoHours = new Date(NOW + 2 * 3_600_000).toISOString();
    expect(minutesUntilRun(inTwoHours, NOW)).toBe(120);

    const anHourAgo = new Date(NOW - 3_600_000).toISOString();
    expect(minutesUntilRun(anHourAgo, NOW)).toBe(-60);
  });
});
