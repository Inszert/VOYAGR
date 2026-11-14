import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import type { AlertPreferencesRecord } from '@/db/repository';
import { filterAlert, type AlertCandidate } from './alert-filter';

const PREFS: AlertPreferencesRecord = {
  userId: 'u1',
  homeAirport: 'LHR',
  destinations: [],
  budget: null,
  earliestDeparture: null,
  latestDeparture: null,
  priceDropAlerts: true,
  updatedAt: '2026-11-14T00:00:00.000Z',
};

const TRIP: AlertCandidate = {
  destination: 'LIS',
  departureDate: '2026-12-10',
  total: money(50_000, 'EUR'),
};

const run = (overrides: Partial<AlertPreferencesRecord>, trip = TRIP) =>
  filterAlert({ ...PREFS, ...overrides }, trip);

describe('filterAlert', () => {
  it('lets everything through when the user never saved settings', () => {
    expect(filterAlert(null, TRIP)).toEqual({ allowed: true });
  });

  it('lets everything through when nothing is narrowed', () => {
    expect(run({})).toEqual({ allowed: true });
  });

  it('blocks everything when alerts are off', () => {
    expect(run({ priceDropAlerts: false })).toEqual({ allowed: false, reason: 'alerts-off' });
  });

  it('keeps a listed destination and drops an unlisted one', () => {
    expect(run({ destinations: ['LIS', 'FAO'] }).allowed).toBe(true);
    expect(run({ destinations: ['FAO'] })).toEqual({ allowed: false, reason: 'destination' });
  });

  it('allows a total exactly on the budget and drops one a minor unit over', () => {
    expect(run({ budget: money(50_000, 'EUR') }).allowed).toBe(true);
    expect(run({ budget: money(49_999, 'EUR') })).toEqual({
      allowed: false,
      reason: 'over-budget',
    });
  });

  it('does not guess a rate: a budget in another currency does not filter', () => {
    expect(run({ budget: money(1, 'USD') }).allowed).toBe(true);
  });

  it('treats both ends of the departure window as inclusive', () => {
    const window = { earliestDeparture: '2026-12-10', latestDeparture: '2026-12-10' };

    expect(run(window).allowed).toBe(true);
    expect(run(window, { ...TRIP, departureDate: '2026-12-09' })).toEqual({
      allowed: false,
      reason: 'before-window',
    });
    expect(run(window, { ...TRIP, departureDate: '2026-12-11' })).toEqual({
      allowed: false,
      reason: 'after-window',
    });
  });

  it('accepts a window open at either end', () => {
    expect(run({ earliestDeparture: '2026-12-01' }).allowed).toBe(true);
    expect(run({ latestDeparture: '2026-12-31' }).allowed).toBe(true);
  });
});
