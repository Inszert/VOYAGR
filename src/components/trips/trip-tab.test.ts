import { describe, expect, it } from 'vitest';
import { isTripTab, TRIP_TABS } from './trip-tab';

describe('isTripTab', () => {
  it('accepts each of the three tabs', () => {
    for (const tab of TRIP_TABS) expect(isTripTab(tab)).toBe(true);
    expect(TRIP_TABS).toEqual(['plan', 'money', 'emergency']);
  });

  it('refuses anything else an address might carry', () => {
    // `?tab=` can arrive as nothing, as a repeated parameter, or as anything typed.
    for (const value of [undefined, '', 'Money', 'booking', ['money'], 7, null]) {
      expect(isTripTab(value)).toBe(false);
    }
  });
});
