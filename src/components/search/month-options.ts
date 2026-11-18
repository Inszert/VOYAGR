const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * The next twelve months, for choosing "anytime that month".
 *
 * Counted as whole months from today's, so no date is ever built from a `Date`.
 * The current month starts today rather than on the 1st: a month that began
 * last week is not one a person can still leave in.
 */
export function monthOptions(today: string): { value: string; label: string }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;

  return Array.from({ length: 12 }, (_, offset) => {
    const index = month + offset;
    const y = year + Math.floor(index / 12);
    const m = index % 12;

    return {
      value: offset === 0 ? today : `${y}-${String(m + 1).padStart(2, '0')}-01`,
      label: `${MONTH_NAMES[m]} ${y}`,
    };
  });
}
