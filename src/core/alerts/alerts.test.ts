import { describe, expect, it } from 'vitest';
import { computeBaseline, medianMinor, type RouteObservation } from './baseline';
import { detectPriceDrop, type DetectInput, type RecentAlert } from './detect';

const NOW = '2027-01-31T12:00:00.000Z';

function obs(i: number, cheapestMinor: number, over: Partial<RouteObservation> = {}) {
  return {
    id: `o${i}`,
    cheapestMinor,
    currency: 'EUR',
    observedAt: `2027-01-${String(10 + i).padStart(2, '0')}T08:00:00.000Z`,
    month: '2027-03',
    ...over,
  } satisfies RouteObservation;
}

describe('computeBaseline', () => {
  it('is the median of five observations', () => {
    const b = computeBaseline(
      [10000, 12000, 9000, 20000, 11000].map((v, i) => obs(i, v)),
      { month: '2027-03', currency: 'EUR', now: NOW },
    );
    expect(b).toEqual({ medianMinor: 11000, sampleCount: 5, currency: 'EUR' });
  });

  it('takes the floor of the mean of the middle two for an even count', () => {
    expect(medianMinor([1, 2, 4, 6])).toBe(3);
    expect(medianMinor([1, 2, 4, 5])).toBe(3);
    expect(medianMinor([])).toBeNull();
  });

  it('has no baseline from four observations', () => {
    const four = [1, 2, 3, 4].map((i) => obs(i, 10000));
    expect(computeBaseline(four, { month: '2027-03', currency: 'EUR', now: NOW })).toBeNull();
  });

  it('ignores other months, other currencies, the future and anything over 30 days old', () => {
    const rows = [
      ...[1, 2, 3, 4].map((i) => obs(i, 10000)),
      obs(5, 1, { month: '2027-04' }),
      obs(6, 1, { currency: 'USD' }),
      obs(7, 1, { observedAt: '2027-02-05T00:00:00.000Z' }),
      obs(8, 1, { observedAt: '2026-12-01T00:00:00.000Z' }),
    ];
    expect(computeBaseline(rows, { month: '2027-03', currency: 'EUR', now: NOW })).toBeNull();
    const fifth = [...rows, obs(9, 10000)];
    expect(computeBaseline(fifth, { month: '2027-03', currency: 'EUR', now: NOW })).toEqual({
      medianMinor: 10000,
      sampleCount: 5,
      currency: 'EUR',
    });
  });
});

const baseline = { medianMinor: 20000, sampleCount: 6, currency: 'EUR' };

function input(over: Partial<DetectInput> = {}): DetectInput {
  return {
    watchId: 'w1',
    routeKey: 'VIE-LIS-2027-03',
    observationId: 'new',
    newMinor: 17000,
    currency: 'EUR',
    baseline,
    recentAlerts: [],
    now: NOW,
    ...over,
  };
}

describe('detectPriceDrop thresholds', () => {
  it('alerts exactly at 85 percent when the drop is large enough', () => {
    // 85 percent of 20000 is 17000, and the drop is 3000 (at least 1500).
    const r = detectPriceDrop(input({ newMinor: 17000 }));
    expect(r.reason).toBe('alert');
    expect(r.alert).toMatchObject({ dropMinor: 3000, medianMinor: 20000 });
  });

  it('does not alert one minor unit above 85 percent', () => {
    expect(detectPriceDrop(input({ newMinor: 17001 })).reason).toBe('not_material');
  });

  it('alerts exactly 1500 below the median when that is also within 85 percent', () => {
    const r = detectPriceDrop(
      input({ baseline: { ...baseline, medianMinor: 9000 }, newMinor: 7500 }),
    );
    // 7500 is 83.3 percent of 9000 and exactly 1500 below it.
    expect(r.reason).toBe('alert');
  });

  it('does not alert at 1499 below even when the percent holds', () => {
    const r = detectPriceDrop(
      input({ baseline: { ...baseline, medianMinor: 9000 }, newMinor: 7501 }),
    );
    expect(r.reason).toBe('not_material');
  });

  it('does not alert on a price that is not a drop', () => {
    expect(detectPriceDrop(input({ newMinor: 25000 })).reason).toBe('not_material');
  });

  it('does not alert without enough data', () => {
    const r = detectPriceDrop(input({ baseline: null }));
    expect(r).toEqual({ alert: null, reason: 'no_baseline' });
  });

  it('refuses a different currency and a non-integer price', () => {
    expect(detectPriceDrop(input({ currency: 'USD' })).reason).toBe('currency_mismatch');
    expect(detectPriceDrop(input({ newMinor: 100.5 })).reason).toBe('invalid_price');
  });
});

describe('detectPriceDrop de-duplication', () => {
  const earlier = (hoursAgo: number, over: Partial<RecentAlert> = {}): RecentAlert => ({
    watchId: 'w1',
    routeKey: 'VIE-LIS-2027-03',
    observationId: 'old',
    createdAt: new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString(),
    ...over,
  });

  it('suppresses a second alert for the same watch and route within 24 hours', () => {
    const r = detectPriceDrop(input({ recentAlerts: [earlier(23.99)] }));
    expect(r.reason).toBe('duplicate_window');
  });

  it('alerts again at exactly 24 hours', () => {
    expect(detectPriceDrop(input({ recentAlerts: [earlier(24)] })).reason).toBe('alert');
  });

  it('is per watch and per route', () => {
    expect(detectPriceDrop(input({ recentAlerts: [earlier(1, { watchId: 'w2' })] })).reason).toBe(
      'alert',
    );
    expect(
      detectPriceDrop(input({ recentAlerts: [earlier(1, { routeKey: 'VIE-ATH-2027-03' })] }))
        .reason,
    ).toBe('alert');
  });

  it('never alerts twice for the same observation, however old', () => {
    const r = detectPriceDrop(input({ recentAlerts: [earlier(500, { observationId: 'new' })] }));
    expect(r.reason).toBe('duplicate_observation');
  });
});
