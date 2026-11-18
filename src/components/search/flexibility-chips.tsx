'use client';

import * as React from 'react';
import {
  FLEXIBILITY_HINTS,
  FLEXIBILITY_LABELS,
  FLEXIBILITY_PRESETS,
  type FlexibilityPreset,
} from '@/search/flexibility';
import { cn } from '@/lib/cn';

/**
 * How much give there is in the dates, as a row of choices you can see.
 *
 * Every preset the search understands, laid out where the dates are rather than
 * folded into a dropdown: "a weekend" and "anytime that month" are not details,
 * they are the first thing somebody flexible decides. Real radio buttons under
 * the styling, so the form submits `flexibility` with or without JavaScript,
 * the arrow keys move between them, and the `:has()` rule that swaps two dates
 * for a month reads the checked one.
 */

export interface FlexibilityChipsProps {
  /** The form field this submits. */
  name: string;
  defaultValue?: string;
  /** What the row is called, for the group. */
  label?: string;
  className?: string;
  /** Today, so "This month" can tell which month it means. */
  today?: string;
  /** The month chosen, as the form has it, to tell "This month" from "Any date". */
  monthStart?: string;
  /** Set to drive the choice from outside, when the radios are not in the form's own tree. */
  choice?: Choice;
  onChoiceChange?: (choice: Choice) => void;
}

type Value = FlexibilityPreset | 'custom';

/**
 * What can be chosen, as radios of the one `flexibility` field.
 *
 * `this-month` is not a value of its own: it is the `month` preset with the
 * Month field set to the current month, so it submits exactly what "Anytime
 * that month" submits - `flexibility=month` - and only the month differs.
 */
export type FlexibilityChoice = Value | 'this-month';
type Choice = FlexibilityChoice;

/** Every option, once, in this order. */
const OPTIONS: readonly Choice[] = [
  'this-month',
  'exact',
  'plus-minus-1',
  'plus-minus-3',
  'plus-minus-7',
  'weekend',
  'long-weekend',
  'month',
  'custom',
];

/** The value a choice submits. */
export function flexibilityValueOf(choice: Choice): Value {
  return choice === 'this-month' ? 'month' : choice;
}

/** Which choice a submitted value and month stand for. */
export function flexibilityChoiceOf(
  defaultValue: string | undefined,
  today?: string,
  monthStart?: string,
): Choice {
  const known: Value = (FLEXIBILITY_PRESETS as readonly string[]).includes(defaultValue ?? '')
    ? (defaultValue as FlexibilityPreset)
    : defaultValue === 'custom'
      ? 'custom'
      : DEFAULT;
  const onThisMonth =
    known === 'month' && !!today && !!monthStart && monthStart.slice(0, 7) === today.slice(0, 7);
  return onThisMonth ? 'this-month' : known;
}

function labelFor(value: Choice): string {
  switch (value) {
    case 'this-month':
      return 'This month';
    case 'custom':
      return 'Exact window';
    default:
      return FLEXIBILITY_LABELS[value];
  }
}

function hintFor(value: Choice): string {
  switch (value) {
    case 'this-month':
      return 'Any trip that leaves this month, for the trip length set below.';
    case 'custom':
      return 'The window you set under More options, and a trip length inside it.';
    default:
      return FLEXIBILITY_HINTS[value];
  }
}

const DEFAULT: Value = 'plus-minus-3';

export function FlexibilityChips({
  name,
  defaultValue,
  label = 'Dates',
  className,
  today,
  monthStart,
  choice,
  onChoiceChange,
}: FlexibilityChipsProps) {
  const id = React.useId();
  const initial = flexibilityChoiceOf(defaultValue, today, monthStart);
  const controlled = choice !== undefined;

  const chip = (value: Choice) => (
    <label key={value} title={hintFor(value)} className="shrink-0">
      <input
        type="radio"
        name={name}
        value={flexibilityValueOf(value)}
        {...(controlled ? { checked: choice === value } : { defaultChecked: initial === value })}
        onChange={(event) => {
          if (onChoiceChange) onChoiceChange(value);
          else if (value === 'this-month' && today) {
            const field = event.currentTarget.form?.elements.namedItem('monthStart');
            if (field instanceof HTMLSelectElement) field.value = today;
          }
        }}
        className="peer sr-only"
      />
      <span
        className={cn(
          'inline-flex min-h-11 cursor-pointer items-center rounded-(--radius-pill) border px-3.5 text-[13px] font-medium whitespace-nowrap',
          'ease-standard duration-quick transition-colors',
          'border-hairline text-ink-muted hover:border-border-strong hover:text-ink',
          'peer-checked:border-accent-to peer-checked:bg-accent-to/15 peer-checked:text-ink',
          'peer-focus-visible:outline-accent-to peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
        )}
      >
        {labelFor(value)}
      </span>
    </label>
  );

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span
        id={`${id}-label`}
        className="text-dim text-[11px] font-medium tracking-[0.06em] uppercase"
      >
        {label}
      </span>

      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
        {OPTIONS.map(chip)}
      </div>
    </div>
  );
}
