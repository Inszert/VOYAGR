import type { IsoDate, LocalDateTime } from './trip/types';

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

/**
 * Day of the week, 0 (Sunday) to 6 (Saturday).
 *
 * `getUTCDay`, never `getDay`: the local variant would return a different day
 * for the same calendar date depending on which side of midnight the server's
 * timezone happens to fall on, which is how a Friday departure becomes a
 * Thursday one on a machine in Los Angeles.
 */
export function dayOfWeek(isoDate: IsoDate): number {
  return new Date(toUtcMillis(isoDate)).getUTCDay();
}

/** The first day of the month a date falls in. */
export function startOfMonth(isoDate: IsoDate): IsoDate {
  return `${isoDate.slice(0, 7)}-01` as IsoDate;
}

/**
 * How many days a month has, counting February properly.
 *
 * Day zero of the next month is the last day of this one, which is the one
 * piece of calendar arithmetic worth delegating rather than writing out with
 * a leap-year rule.
 */
export function daysInMonth(isoDate: IsoDate): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));

  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The same day-of-month, `months` later or earlier.
 *
 * Clamped to the end of the target month, so a calendar sitting on the 31st
 * of January steps to the 28th of February rather than rolling over into
 * March - which is what `setMonth` does and why it is not used here.
 */
export function addMonths(isoDate: IsoDate, months: number): IsoDate {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));

  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = zeroBased - targetYear * 12 + 1;

  const first =
    `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-01` as IsoDate;

  return `${first.slice(0, 8)}${String(Math.min(day, daysInMonth(first))).padStart(2, '0')}` as IsoDate;
}

// --- Local wall-clock times -------------------------------------------------

const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * True for a `LocalDateTime`: a wall-clock date and time with no zone.
 *
 * A trailing `Z` or an offset is rejected rather than tolerated. A flight time
 * that claims to be UTC is the exact confusion this type exists to end, and
 * accepting it here would let it back in through the door it was shown out of.
 */
export function isLocalDateTime(value: string): boolean {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;

  const [, datePart, hours, minutes, seconds] = match as unknown as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];

  if (!isIsoDate(datePart)) return false;
  if (Number(hours) > 23 || Number(minutes) > 59) return false;
  if (seconds !== undefined && Number(seconds) > 59) return false;

  return true;
}

/**
 * Minutes past local midnight.
 *
 * Reads the clock face out of the string. Deliberately not via `Date`, which
 * would resolve the time in whatever zone the server happens to run in - a
 * 23:40 arrival in Antalya must read as 23:40 whether the process is in Vienna,
 * London or a CI runner set to UTC.
 */
export function minutesIntoLocalDay(value: LocalDateTime): number {
  if (!isLocalDateTime(value)) {
    throw new DateRangeError(`Not a local wall-clock date-time: ${JSON.stringify(value)}`);
  }

  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}

/** Hour of the local day, 0-23. */
export function localHour(value: LocalDateTime): number {
  return Math.floor(minutesIntoLocalDay(value) / 60);
}

/** The calendar date part of a local date-time. */
export function localDate(value: LocalDateTime): IsoDate {
  if (!isLocalDateTime(value)) {
    throw new DateRangeError(`Not a local wall-clock date-time: ${JSON.stringify(value)}`);
  }

  return value.slice(0, 10);
}
