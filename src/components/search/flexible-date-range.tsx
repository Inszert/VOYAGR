'use client';

import * as React from 'react';
import { DateRangeField, type DateRangeFieldProps } from '@/components/ui';
import { cn } from '@/lib/cn';
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

  // The calendar is open: in month mode the dates stay mounted while it is, so it has somewhere to sit.
  const [calendarOpen, setCalendarOpen] = React.useState(false);

  const choose = (next: FlexibilityChoice) => {
    setChoice(next);
    if (next === 'this-month') setMonth(today);
  };
  const chooseMonth = (value: string) => {
    setMonth(value);
    setChoice(value === today ? 'this-month' : 'month');
    setCalendarOpen(false);
  };
  const months = monthOptions(today);

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
      <div hidden={inMonth && !calendarOpen}>
        <DateRangeField
          {...range}
          open={calendarOpen}
          onOpenChange={setCalendarOpen}
          monthPicker={
            inMonth ? (
              <MonthTiles months={months} selected={month} onSelect={chooseMonth} />
            ) : undefined
          }
          showNights={lengthMode === 'under' || lengthMode === 'over'}
          required={inMonth ? false : range.required}
          footer={
            <div className="flex flex-col gap-4">
              <FlexibilityChips
                name="flexibility-choice"
                label="How flexible are the dates"
                choice={choice}
                onChoiceChange={choose}
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
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            data-testid="month-pill"
            className="text-ink focus-visible:outline-accent-ink block min-h-11 text-left text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {months.find((o) => o.value === month)?.label ?? 'Pick a month'}
            <span className="sr-only"> - change the month</span>
          </button>
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

/**
 * "Anytime that month" turns the calendar into a month picker: the next twelve
 * months as tiles. Choosing one sets `monthStart`. A price is shown only when
 * the caller knows one - it arrives formatted, and is never worked out here.
 */
function MonthTiles({
  months,
  selected,
  onSelect,
  prices,
}: {
  months: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
  prices?: Readonly<Record<string, string>>;
}) {
  return (
    <div role="group" aria-label="Month" className="flex flex-col gap-2">
      <p aria-live="polite" className="text-muted text-sm">
        {selected === '' ? 'Choose the month you want to travel in.' : 'Month chosen.'}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {months.map((month) => {
          const on = month.value === selected;
          const price = prices?.[month.value];
          return (
            <button
              key={month.value}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(month.value)}
              className={cn(
                'flex min-h-14 flex-col items-start justify-center rounded-(--radius-control) border px-3 py-2 text-left text-sm',
                'ease-standard duration-quick transition-colors',
                'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
                on
                  ? 'border-accent-to bg-accent-to font-semibold text-white'
                  : 'border-hairline text-ink hover:border-border-strong',
              )}
            >
              <span>
                {on ? <span aria-hidden="true">{'✓ '}</span> : null}
                {month.label}
                {on ? <span className="sr-only"> (selected)</span> : null}
              </span>
              {price ? <span className="text-xs tabular-nums">from {price}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
