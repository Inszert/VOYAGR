import { describe, expect, it } from 'vitest';
import {
  addDays,
  clampDate,
  DateRangeError,
  datesBetween,
  daysBetween,
  isIsoDate,
  isLocalDateTime,
  localDate,
  localHour,
  minutesIntoLocalDay,
  nightsBetween,
} from './dates';

describe('isIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isIsoDate('2026-06-10')).toBe(true);
  });

  it('rejects a date that does not exist', () => {
    // A regex would accept this; the round-trip check is what catches it.
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('rejects a timestamp and a malformed string', () => {
    expect(isIsoDate('2026-06-10T09:00:00Z')).toBe(false);
    expect(isIsoDate('10/06/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
  });
});

describe('addDays', () => {
  it('adds and subtracts whole days', () => {
    expect(addDays('2026-06-10', 5)).toBe('2026-06-15');
    expect(addDays('2026-06-10', -10)).toBe('2026-05-31');
  });

  it('crosses a month and a year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('does not drift across a daylight-saving change', () => {
    // Central European summer time starts on 2026-03-29. Local-time arithmetic
    // would land on the 28th or produce a 23-hour day; UTC midnight does not.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('rejects a fractional day count', () => {
    expect(() => addDays('2026-06-10', 1.5)).toThrow(DateRangeError);
  });

  it('rejects an invalid date', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(DateRangeError);
  });
});

describe('daysBetween and nightsBetween', () => {
  it('counts forward and backward', () => {
    expect(daysBetween('2026-06-10', '2026-06-15')).toBe(5);
    expect(daysBetween('2026-06-15', '2026-06-10')).toBe(-5);
    expect(daysBetween('2026-06-10', '2026-06-10')).toBe(0);
  });

  it('counts nights the way a hotel bills them', () => {
    // Check in on the 10th, out on the 15th: five nights, six days present.
    expect(nightsBetween('2026-06-10', '2026-06-15')).toBe(5);
  });
});

describe('datesBetween', () => {
  it('includes both endpoints', () => {
    expect(datesBetween('2026-06-10', '2026-06-13')).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
    ]);
  });

  it('returns a single date for an identical range', () => {
    expect(datesBetween('2026-06-10', '2026-06-10')).toEqual(['2026-06-10']);
  });

  it('returns nothing for an inverted range', () => {
    expect(datesBetween('2026-06-13', '2026-06-10')).toEqual([]);
  });
});

describe('clampDate', () => {
  it('clamps to each bound and passes through a date inside the range', () => {
    expect(clampDate('2026-05-01', '2026-06-01', '2026-06-30')).toBe('2026-06-01');
    expect(clampDate('2026-07-01', '2026-06-01', '2026-06-30')).toBe('2026-06-30');
    expect(clampDate('2026-06-15', '2026-06-01', '2026-06-30')).toBe('2026-06-15');
  });

  it('rejects an empty range rather than inventing an answer', () => {
    expect(() => clampDate('2026-06-15', '2026-06-30', '2026-06-01')).toThrow(DateRangeError);
  });
});

describe('local wall-clock times', () => {
  it('accepts a wall-clock time with and without seconds', () => {
    expect(isLocalDateTime('2026-06-10T23:40:00')).toBe(true);
    expect(isLocalDateTime('2026-06-10T23:40')).toBe(true);
  });

  it('rejects anything claiming to be an instant', () => {
    // The whole point of the type: a flight time is local at its airport, and a
    // `Z` or an offset is the confusion this exists to end.
    expect(isLocalDateTime('2026-06-10T23:40:00Z')).toBe(false);
    expect(isLocalDateTime('2026-06-10T23:40:00+02:00')).toBe(false);
  });

  it('rejects an impossible clock reading or date', () => {
    expect(isLocalDateTime('2026-06-10T24:00:00')).toBe(false);
    expect(isLocalDateTime('2026-06-10T12:60:00')).toBe(false);
    expect(isLocalDateTime('2026-02-30T12:00:00')).toBe(false);
    expect(isLocalDateTime('2026-06-10')).toBe(false);
  });

  it('reads the clock face, not the server clock', () => {
    // Parsing through `Date` would resolve this in whatever zone the process
    // runs in, so a 23:40 arrival in Antalya would read differently in CI.
    expect(minutesIntoLocalDay('2026-06-10T23:40:00')).toBe(23 * 60 + 40);
    expect(minutesIntoLocalDay('2026-06-10T00:00:00')).toBe(0);
    expect(localHour('2026-06-15T05:50:00')).toBe(5);
    expect(localDate('2026-06-15T05:50:00')).toBe('2026-06-15');
  });

  it('refuses to read a time it cannot trust', () => {
    expect(() => minutesIntoLocalDay('2026-06-10T23:40:00Z')).toThrow(DateRangeError);
    expect(() => localHour('not a time')).toThrow(DateRangeError);
    expect(() => localDate('2026-06-10')).toThrow(DateRangeError);
  });
});
