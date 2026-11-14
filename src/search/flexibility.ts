import { addDays, dayOfWeek, daysBetween } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';

/**
 * Date flexibility presets (1.10.1 section 8).
 *
 * Section 8 is blunt about this: flexible dates are not an advanced option
 * hidden behind a disclosure, they are the feature. Most people asking for a
 * week in the sun do not care which week, and the whole reason this product
 * searches a window rather than a date is that the window is where the money
 * is.
 *
 * What a preset actually is: a pure function from the two dates a person can
 * type into the four fields the planner needs, plus - for the weekend presets
 * - a rule about which days of the week count. Nothing here is a search, a
 * guess or a model call. The same preset and the same dates always produce the
 * same window, which is what lets a Travel Watch re-run a saved "long weekend
 * in June" months later and mean the same thing by it.
 */

export type FlexibilityPreset =
  'exact' | 'plus-minus-1' | 'plus-minus-3' | 'plus-minus-7' | 'weekend' | 'long-weekend' | 'month';

/** The date part of a `SearchProfile`, which is all a preset decides. */
export interface DateFlexibility {
  readonly earliestDeparture: IsoDate;
  readonly latestReturn: IsoDate;
  readonly minNights: number;
  readonly maxNights: number;
  readonly departureDaysOfWeek: readonly number[] | null;
  readonly returnDaysOfWeek: readonly number[] | null;
}

export const FLEXIBILITY_PRESETS = [
  'exact',
  'plus-minus-1',
  'plus-minus-3',
  'plus-minus-7',
  'weekend',
  'long-weekend',
  'month',
] as const satisfies readonly FlexibilityPreset[];

export const FLEXIBILITY_LABELS: Record<FlexibilityPreset, string> = {
  exact: 'Exact dates',
  'plus-minus-1': '± 1 day',
  'plus-minus-3': '± 3 days',
  'plus-minus-7': '± 7 days',
  weekend: 'A weekend',
  'long-weekend': 'A long weekend',
  month: 'Anytime that month',
};

/**
 * What each preset does, in the words shown next to the control.
 *
 * Written out rather than left implicit because "± 3 days" is ambiguous - it
 * could shift the trip, stretch it, or both - and a user who cannot tell which
 * cannot tell whether the answer is the one they asked for.
 */
/**
 * The shortest trip a flexible search will consider unless a minimum was set.
 *
 * A floor under the flexible presets rather than "the trip you typed, less the
 * flexibility": the cheapest trip is very often a shorter one, and a search
 * that could never go below four nights said every "cheapest" was a
 * four-night trip. A minimum typed under "More options" still applies on top.
 */
export const DEFAULT_MIN_NIGHTS = 2;

export const FLEXIBILITY_HINTS: Record<FlexibilityPreset, string> = {
  exact: 'Only these dates.',
  'plus-minus-1':
    'Up to a day either side; the trip can be as short as two nights or a night longer.',
  'plus-minus-3':
    'Up to three days either side; the trip can be as short as two nights or three nights longer.',
  'plus-minus-7':
    'Up to a week either side; the trip can be as short as two nights or a week longer.',
  weekend: 'Friday or Saturday out, Sunday back, over the next six weeks.',
  'long-weekend': 'Thursday or Friday out, Sunday or Monday back, over the next six weeks.',
  month: 'Any dates that month, keeping the same trip length.',
};

/**
 * How far ahead the weekend presets look.
 *
 * Six weeks, because "a weekend" means "one of the next few", and one weekend
 * is not a flexible search. Long enough to be worth comparing, short enough
 * that the weekends on offer are ones a person might actually take.
 */
const WEEKEND_HORIZON_DAYS = 42;

/**
 * How far each shifting preset moves the two dates it was given.
 *
 * A table rather than three cases, because `detectFlexibility` has to undo
 * exactly what `applyFlexibility` did. Two independent copies of "3" would
 * eventually stop agreeing, and the symptom would be a chip that quietly
 * highlights the wrong option.
 */
const SHIFT_DAYS: Partial<Record<FlexibilityPreset, number>> = {
  'plus-minus-1': 1,
  'plus-minus-3': 3,
  'plus-minus-7': 7,
};

const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;

/** Last day of the month containing `date`. */
function endOfMonth(date: IsoDate): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  // Day 0 of the next month is the last day of this one, and rolls the year
  // over on its own for December.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Turn a departure and return date into the window a preset describes.
 *
 * `departureDate` and `returnDate` are what the person typed. The span between
 * them is the trip length they have in mind, and every preset except the
 * weekends preserves it as the centre of whatever it widens to.
 *
 * Pure, and total: a return before the departure yields a one-night span
 * rather than a throw, because this runs on half-typed form input and a
 * validation error belongs to the schema, not here.
 */
export function applyFlexibility(
  preset: FlexibilityPreset,
  departureDate: IsoDate,
  returnDate: IsoDate,
): DateFlexibility {
  const span = Math.max(1, daysBetween(departureDate, returnDate));

  const shifted = (days: number): DateFlexibility => ({
    earliestDeparture: addDays(departureDate, -days),
    latestReturn: addDays(returnDate, days),
    // Both ends move, so the trip may also be shorter or longer. It may go as
    // short as `DEFAULT_MIN_NIGHTS` whatever the span - the cheapest trip is
    // often the shorter one - but never below one night, and never above the
    // span itself: a one-night trip typed in is not made longer by this.
    minNights: Math.min(span, DEFAULT_MIN_NIGHTS),
    maxNights: span + days,
    departureDaysOfWeek: null,
    returnDaysOfWeek: null,
  });

  switch (preset) {
    case 'exact':
      return {
        earliestDeparture: departureDate,
        latestReturn: returnDate,
        minNights: span,
        maxNights: span,
        departureDaysOfWeek: null,
        returnDaysOfWeek: null,
      };

    case 'plus-minus-1':
    case 'plus-minus-3':
    case 'plus-minus-7':
      return shifted(SHIFT_DAYS[preset] as number);

    case 'weekend':
      return {
        earliestDeparture: departureDate,
        latestReturn: addDays(departureDate, WEEKEND_HORIZON_DAYS),
        minNights: 1,
        maxNights: 2,
        // Friday-to-Sunday and Saturday-to-Sunday. Constraining the return day
        // as well as the departure is what keeps Saturday-to-Monday out; two
        // nights from a Saturday is not a weekend, it is a Monday off work.
        departureDaysOfWeek: [FRIDAY, SATURDAY],
        returnDaysOfWeek: [SUNDAY],
      };

    case 'long-weekend':
      return {
        earliestDeparture: departureDate,
        latestReturn: addDays(departureDate, WEEKEND_HORIZON_DAYS),
        minNights: 3,
        maxNights: 4,
        // Thursday-to-Sunday, Thursday-to-Monday, Friday-to-Monday. Friday to
        // Tuesday is excluded by the return day, which is the point of having
        // one: that is a short break, not a long weekend.
        departureDaysOfWeek: [THURSDAY, FRIDAY],
        returnDaysOfWeek: [SUNDAY, MONDAY],
      };

    case 'month':
      return {
        earliestDeparture: startOfMonth(departureDate),
        latestReturn: endOfMonth(departureDate),
        minNights: span,
        maxNights: span,
        departureDaysOfWeek: null,
        returnDaysOfWeek: null,
      };
  }
}

/**
 * Which preset a set of dates already matches, or null for a custom window.
 *
 * The inverse of `applyFlexibility`, used to show the right chip as selected
 * after a reload or on a shared link. It compares the *result* rather than
 * carrying the preset name through the query string, so a window somebody
 * hand-edited into exactly a long weekend is recognised as one - and a preset
 * that stops matching its own output fails a test rather than quietly
 * highlighting the wrong chip.
 */
export function detectFlexibility(dates: DateFlexibility): FlexibilityPreset | null {
  const sameDays = (a: readonly number[] | null, b: readonly number[] | null): boolean => {
    if (a === null || b === null) return a === b;
    return a.length === b.length && a.every((day, index) => day === b[index]);
  };

  for (const preset of FLEXIBILITY_PRESETS) {
    /*
     * Undo the preset to recover the dates it was given, then re-apply it.
     *
     * Reconstructing from the window's own shape would not work: a plus-or-
     * minus preset clamps `minNights` at one, so a seven-night trip with a
     * week either side spans one to fourteen nights and the shift is no longer
     * half the difference. Each preset says how to invert itself instead.
     */
    const shift = SHIFT_DAYS[preset] ?? 0;
    const departure =
      preset === 'month' ? dates.earliestDeparture : addDays(dates.earliestDeparture, shift);
    // The weekends ignore the return date entirely, and the month preset keeps
    // the trip length rather than the window, so for both the return has to
    // come from the length instead of from the window's far edge.
    const back =
      preset === 'weekend' || preset === 'long-weekend'
        ? addDays(departure, 1)
        : preset === 'month'
          ? addDays(departure, dates.minNights)
          : addDays(dates.latestReturn, -shift);

    const candidate = applyFlexibility(preset, departure, back);

    if (
      candidate.earliestDeparture === dates.earliestDeparture &&
      candidate.latestReturn === dates.latestReturn &&
      candidate.minNights === dates.minNights &&
      candidate.maxNights === dates.maxNights &&
      sameDays(candidate.departureDaysOfWeek, dates.departureDaysOfWeek) &&
      sameDays(candidate.returnDaysOfWeek, dates.returnDaysOfWeek)
    ) {
      return preset;
    }
  }

  return null;
}

/** Indexed by `dayOfWeek`, so 0 is Sunday. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** e.g. "Friday" for 2026-06-12. Exported for labelling date options. */
export function dayName(date: IsoDate): string {
  return DAY_NAMES[dayOfWeek(date)] as string;
}
