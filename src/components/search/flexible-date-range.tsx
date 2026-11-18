'use client';

import * as React from 'react';
import { DateRangeField, Select, type DateRangeFieldProps } from '@/components/ui';
import { monthOptions } from './search-fields';
import {
  FlexibilityChips,
  flexibilityChoiceOf,
  flexibilityValueOf,
  type FlexibilityChoice,
} from './flexibility-chips';
import {
  TripLengthChoice,
  tripDaysOf,
  tripLengthModeOf,
  type TripLengthMode,
} from './trip-length-choice';

/**
 * The dates and how flexible they are: one control.
 *
 * The options sit inside the calendar, under its months. The calendar is a
 * popover, so its contents are not in the form and are gone while it is shut -
 * and `flexibility` has to submit either way. So the choice is held here and
 * mirrored by one real, checked radio that stays in the form; the form's own
 * `:has(input[name=flexibility][value=month]:checked)` rule that swaps two
 * dates for a month reads that radio exactly as it read the visible ones.
 */

export interface FlexibleDateRangeProps extends DateRangeFieldProps {
  /** The form's `flexibility`, as it was submitted. */
  flexibility?: string;
  today: string;
  monthStart?: string;
  /** The form's `tripLength` and `tripDays`, as submitted. Empty means not set. */
  tripLength?: string;
  tripDays?: string;
  tripLengthError?: string | undefined;
}

export function FlexibleDateRange({
  flexibility,
  today,
  monthStart,
  tripLength,
  tripDays,
  tripLengthError,
  ...range
}: FlexibleDateRangeProps) {
  const [choice, setChoice] = React.useState<FlexibilityChoice>(() =>
    flexibilityChoiceOf(flexibility, today, monthStart),
  );
  const [lengthMode, setLengthMode] = React.useState<TripLengthMode>(() =>
    tripLengthModeOf(tripLength),
  );
  const [lengthDays, setLengthDays] = React.useState(() => tripDaysOf(tripDays));
  // The month is chosen in the calendar, beside the days, and mirrored by a hidden
  // `monthStart` in the form: the calendar is a popover outside it.
  const [month, setMonth] = React.useState(monthStart ?? '');
  const inMonth = flexibilityValueOf(choice) === 'month';

  const choose = (next: FlexibilityChoice) => {
    setChoice(next);
    if (next === 'this-month') setMonth(today);
  };
  const chooseMonth = (value: string) => {
    setMonth(value);
    if (value !== '' && flexibilityValueOf(choice) !== 'month') {
      setChoice(value === today ? 'this-month' : 'month');
    }
  };

  return (
    <>
      <input type="hidden" name="monthStart" value={month} />
      <input
        type="radio"
        name="flexibility"
        value={flexibilityValueOf(choice)}
        checked
        readOnly
        hidden
      />
      {/*
        The trip length is chosen in the calendar, which is a popover outside
        the form, so the choice is mirrored here. Not set submits nothing.
      */}
      {lengthMode !== '' ? <input type="hidden" name="tripLength" value={lengthMode} /> : null}
      {lengthMode === 'under' || lengthMode === 'over' ? (
        <input type="hidden" name="tripDays" value={lengthDays} />
      ) : null}
      {/*
        In month mode the two dates give way to the Month and Trip length
        fields, and the calendar with its chips goes with them. This control
        is the way back: it stays in view and chooses the same `exact` value
        the "Exact dates" chip does.
      */}
      <div hidden={inMonth}>
        <DateRangeField
          {...range}
          required={inMonth ? false : range.required}
          footer={
            <div className="flex flex-col gap-4">
              <FlexibilityChips
                name="flexibility-choice"
                label="How flexible are the dates"
                choice={choice}
                onChoiceChange={choose}
              />
              <Select
                label="Month"
                value={month}
                onChange={(event) => chooseMonth(event.target.value)}
                options={[{ value: '', label: 'Not set' }, ...monthOptions(today)]}
              />
              <TripLengthChoice
                mode={lengthMode}
                days={lengthDays}
                onModeChange={setLengthMode}
                onDaysChange={setLengthDays}
                error={tripLengthError}
              />
            </div>
          }
        />
      </div>
      {inMonth ? (
        <>
          <span className="text-ink text-[13px] font-medium" data-testid="month-pill">
            {monthOptions(today).find((o) => o.value === month)?.label ?? 'Pick a month'}
          </span>
          <button
            type="button"
            onClick={() => choose('exact')}
            className="text-ink hover:text-ink focus-visible:outline-accent-ink min-h-11 text-left text-[13px] font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Choose exact dates
          </button>
        </>
      ) : null}
    </>
  );
}
