'use client';

import * as React from 'react';
import { DateRangeField, type DateRangeFieldProps } from '@/components/ui';
import {
  FlexibilityChips,
  flexibilityChoiceOf,
  flexibilityValueOf,
  type FlexibilityChoice,
} from './flexibility-chips';

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
}

export function FlexibleDateRange({
  flexibility,
  today,
  monthStart,
  ...range
}: FlexibleDateRangeProps) {
  const [choice, setChoice] = React.useState<FlexibilityChoice>(() =>
    flexibilityChoiceOf(flexibility, today, monthStart),
  );
  const inMonth = flexibilityValueOf(choice) === 'month';
  const mirror = React.useRef<HTMLInputElement>(null);

  const choose = (next: FlexibilityChoice) => {
    setChoice(next);
    if (next !== 'this-month') return;
    const field = mirror.current?.form?.elements.namedItem('monthStart');
    if (field instanceof HTMLSelectElement) field.value = today;
  };

  return (
    <>
      <input
        ref={mirror}
        type="radio"
        name="flexibility"
        value={flexibilityValueOf(choice)}
        checked
        readOnly
        hidden
      />
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
            <FlexibilityChips
              name="flexibility-choice"
              label="How flexible are the dates"
              choice={choice}
              onChoiceChange={choose}
            />
          }
        />
      </div>
      {inMonth ? (
        <button
          type="button"
          onClick={() => choose('exact')}
          className="text-ink hover:text-ink focus-visible:outline-accent-ink min-h-11 text-left text-[13px] font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Choose exact dates
        </button>
      ) : null}
    </>
  );
}
