/**
 * Calendar dates, written for a reader.
 *
 * Four components had grown their own copy of the same month table and the
 * same `shortDate`, and a fifth formatted through `toLocaleDateString`. That
 * last one is the reason this exists: ICU data on one machine writes "Sept"
 * and on another "Sep", so the same trip could say "10 Sep" on a card and
 * "10 Sept" on the date grid above it, and neither was wrong.
 *
 * A fixed table settles it. It also keeps the rule in `CLAUDE.md` intact - a
 * calendar date is a `YYYY-MM-DD` string and is never parsed into a `Date` -
 * because reading two characters out of a string cannot drift a timezone.
 *
 * Presentation only. Nothing here compares or advances a date; that is
 * `src/core/dates.ts`.
 */

import { dayOfWeek } from '@/core/dates';

export const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Indexed by `dayOfWeek`, which counts from Sunday. */
export const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** e.g. `6 Jun`. */
export function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

/**
 * e.g. `Sat 6 Jun`.
 *
 * The weekday comes from `dayOfWeek` in `src/core/dates.ts`, which reads the
 * calendar date in UTC so no server timezone can move it a day.
 */
export function weekdayDate(iso: string): string {
  return `${SHORT_WEEKDAYS[dayOfWeek(iso)]} ${shortDate(iso)}`;
}

/**
 * e.g. `10 – 14 Jun`, dropping the month when both ends share one.
 *
 * "10 Jun – 14 Jun" makes a reader check whether the months differ. Writing
 * the month once says they do not.
 */
export function shortDateRange(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);

  return sameMonth
    ? `${Number(from.slice(8, 10))} – ${shortDate(to)}`
    : `${shortDate(from)} – ${shortDate(to)}`;
}
