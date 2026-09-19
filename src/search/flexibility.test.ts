import { describe, expect, it } from 'vitest';
import { dayOfWeek } from '@/core/dates';
import {
  applyFlexibility,
  detectFlexibility,
  FLEXIBILITY_HINTS,
  FLEXIBILITY_LABELS,
  FLEXIBILITY_PRESETS,
  type FlexibilityPreset,
} from './flexibility';
import { enumerateDateWindows } from './plan';
import { buildProfile } from '@/core/trip/test-support';

/** 2026-06-06 is a Saturday; 2026-06-13 the Saturday after it. */
const DEPARTURE = '2026-06-06';
const RETURN = '2026-06-13';

describe('flexibility presets', () => {
  it('leaves exact dates exactly alone', () => {
    const dates = applyFlexibility('exact', DEPARTURE, RETURN);

    expect(dates).toEqual({
      earliestDeparture: DEPARTURE,
      latestReturn: RETURN,
      minNights: 7,
      maxNights: 7,
      departureDaysOfWeek: null,
      returnDaysOfWeek: null,
    });
  });

  it('moves both ends and both lengths for a plus-or-minus preset', () => {
    // Both ends move independently, so a 7-night trip may become 4 or 10.
    // Saying so in the hint is the whole reason the hint exists.
    expect(applyFlexibility('plus-minus-3', DEPARTURE, RETURN)).toEqual({
      earliestDeparture: '2026-06-03',
      latestReturn: '2026-06-16',
      minNights: 4,
      maxNights: 10,
      departureDaysOfWeek: null,
      returnDaysOfWeek: null,
    });
  });

  it('never proposes a trip of nought nights', () => {
    const dates = applyFlexibility('plus-minus-7', DEPARTURE, '2026-06-08');

    expect(dates.minNights).toBe(1);
  });

  it('treats an inverted range as a single night rather than throwing', () => {
    // Runs on half-typed form input; rejecting it belongs to the schema.
    expect(applyFlexibility('exact', RETURN, DEPARTURE).minNights).toBe(1);
  });

  it('keeps the month and the trip length for the month preset', () => {
    const dates = applyFlexibility('month', '2026-06-10', '2026-06-15');

    expect(dates.earliestDeparture).toBe('2026-06-01');
    expect(dates.latestReturn).toBe('2026-06-30');
    expect(dates.minNights).toBe(5);
    expect(dates.maxNights).toBe(5);
  });

  it('finds the last day of a February and of a December', () => {
    expect(applyFlexibility('month', '2028-02-10', '2028-02-15').latestReturn).toBe('2028-02-29');
    expect(applyFlexibility('month', '2026-12-10', '2026-12-15').latestReturn).toBe('2026-12-31');
  });
});

describe('the weekend presets', () => {
  const windowsFor = (preset: FlexibilityPreset) => {
    const dates = applyFlexibility(preset, DEPARTURE, RETURN);
    return enumerateDateWindows(buildProfile(dates));
  };

  it('offers only real weekends', () => {
    const windows = windowsFor('weekend');
    expect(windows.length).toBeGreaterThan(3);

    for (const window of windows) {
      const departs = dayOfWeek(window.departureDate);
      const returns = dayOfWeek(window.returnDate);

      // Friday or Saturday out, Sunday back. Saturday to Monday is two nights
      // from a Saturday, which is a day off work rather than a weekend, and is
      // exactly what the return-day rule exists to exclude.
      expect([5, 6]).toContain(departs);
      expect(returns).toBe(0);
    }
  });

  it('offers only real long weekends', () => {
    const windows = windowsFor('long-weekend');
    expect(windows.length).toBeGreaterThan(3);

    for (const window of windows) {
      expect([4, 5]).toContain(dayOfWeek(window.departureDate));
      expect([0, 1]).toContain(dayOfWeek(window.returnDate));
      expect(window.nights).toBeGreaterThanOrEqual(3);
      expect(window.nights).toBeLessThanOrEqual(4);
    }
  });

  it('spans several weekends rather than one', () => {
    const departures = new Set(windowsFor('weekend').map((window) => window.departureDate));

    // One weekend is not a flexible search; there would be nothing to compare.
    expect(departures.size).toBeGreaterThan(4);
  });

  it('starts from the date given, not from an arbitrary point', () => {
    expect(applyFlexibility('weekend', DEPARTURE, RETURN).earliestDeparture).toBe(DEPARTURE);
  });
});

describe('recognising a preset again', () => {
  it.each(FLEXIBILITY_PRESETS)('round-trips %s', (preset) => {
    // Powers the selected chip after a reload. A preset that stops matching
    // its own output would silently highlight the wrong one, which no type
    // would catch.
    expect(detectFlexibility(applyFlexibility(preset, DEPARTURE, RETURN))).toBe(preset);
  });

  it('returns null for a window no preset describes', () => {
    expect(
      detectFlexibility({
        earliestDeparture: '2026-06-01',
        latestReturn: '2026-06-30',
        minNights: 4,
        maxNights: 7,
        departureDaysOfWeek: null,
        returnDaysOfWeek: null,
      }),
    ).toBeNull();
  });
});

describe('preset copy', () => {
  it('labels and explains every preset', () => {
    // A preset added without a label would render an empty chip.
    for (const preset of FLEXIBILITY_PRESETS) {
      expect(FLEXIBILITY_LABELS[preset]).toBeTruthy();
      expect(FLEXIBILITY_HINTS[preset]).toBeTruthy();
    }
  });
});
