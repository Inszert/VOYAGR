import type { IsoDate } from './trip/types';

/**
 * Calendar-date arithmetic.
 *
 * ISO calendar dates, not instants. Everything here works on `YYYY-MM-DD`
 * strings and UTC midnight, so adding a night never drifts by an hour because
 * a local timezone crossed a daylight-saving boundary.
 *
 * Pure: no clock, no locale, no randomness. The current date is always passed
 * in by a caller that owns a clock.
 */

const MILLISECONDS_PER_DAY = 86_400_000;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class DateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateRangeError';
  }
}

/** True when the string is a well-formed, real calendar date. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;

  // Round-tripping catches the impossible dates a regex happily accepts, such
  // as 2026-02-30, which `Date.UTC` silently rolls forward into March.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toUtcMillis(isoDate: IsoDate): number {
  if (!isIsoDate(isoDate)) {
    throw new DateRangeError(`Invalid ISO calendar date: ${JSON.stringify(isoDate)}`);
  }
  return Date.parse(`${isoDate}T00:00:00Z`);
}

/** Add whole days to an ISO calendar date. Negative counts subtract. */
export function addDays(isoDate: IsoDate, days: number): IsoDate {
  if (!Number.isSafeInteger(days)) {
    throw new DateRangeError(`addDays() requires a whole number of days, received ${days}`);
  }

  return new Date(toUtcMillis(isoDate) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MILLISECONDS_PER_DAY);
}

/**
 * Nights between a check-in and a check-out.
 *
 * Identical arithmetic to `daysBetween`, named separately because a night is
 * the unit hotels price in and the unit the cost engine divides by.
 */
export function nightsBetween(checkIn: IsoDate, checkOut: IsoDate): number {
  return daysBetween(checkIn, checkOut);
}

/** Every date from `start` to `end`, inclusive. Empty when `end` precedes `start`. */
export function datesBetween(start: IsoDate, end: IsoDate): IsoDate[] {
  const span = daysBetween(start, end);
  if (span < 0) return [];

  return Array.from({ length: span + 1 }, (_, offset) => addDays(start, offset));
}

/**
 * ISO dates compare correctly as strings, so these exist for readability at the
 * call site rather than to add behaviour. Using them keeps a date comparison
 * from looking like an accidental string comparison.
 */
export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}

export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return a > b;
}

/** Clamp a date into `[min, max]`. */
export function clampDate(value: IsoDate, min: IsoDate, max: IsoDate): IsoDate {
  if (isAfter(min, max)) {
    throw new DateRangeError(`Empty date range: ${min} is after ${max}`);
  }
  if (isBefore(value, min)) return min;
  if (isAfter(value, max)) return max;
  return value;
}
