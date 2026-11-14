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
}

type Value = FlexibilityPreset | 'custom';

const ORDER: readonly Value[] = [
  'exact',
  'plus-minus-1',
  'plus-minus-3',
  'plus-minus-7',
  'weekend',
  'long-weekend',
  'month',
  'custom',
];

function labelFor(value: Value): string {
  return value === 'custom' ? 'Exact window' : FLEXIBILITY_LABELS[value];
}

function hintFor(value: Value): string {
  return value === 'custom'
    ? 'The window you set under More options, and a trip length inside it.'
    : FLEXIBILITY_HINTS[value];
}

const DEFAULT: Value = 'plus-minus-3';

export function FlexibilityChips({
  name,
  defaultValue,
  label = 'Dates',
  className,
}: FlexibilityChipsProps) {
  const id = React.useId();

  const known = (FLEXIBILITY_PRESETS as readonly string[]).includes(defaultValue ?? '')
    ? (defaultValue as FlexibilityPreset)
    : defaultValue === 'custom'
      ? 'custom'
      : DEFAULT;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span
        id={`${id}-label`}
        className="text-dim text-[11px] font-medium tracking-[0.06em] uppercase"
      >
        {label}
      </span>

      {/* One line you can swipe on a phone, a wrapped row where there is room. */}
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="-mx-0.5 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-0.5 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {ORDER.map((value) => (
          <label key={value} title={hintFor(value)} className="shrink-0">
            <input
              type="radio"
              name={name}
              value={value}
              defaultChecked={known === value}
              className="peer sr-only"
            />
            <span
              className={cn(
                'inline-flex min-h-10 cursor-pointer items-center rounded-(--radius-pill) border px-3.5 text-[13px] font-medium whitespace-nowrap',
                'ease-standard duration-quick transition-colors',
                'border-hairline text-ink-muted hover:border-border-strong hover:text-ink',
                'peer-checked:border-accent-to peer-checked:bg-accent-to/15 peer-checked:text-ink',
                'peer-focus-visible:outline-accent-to peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
              )}
            >
              {labelFor(value)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
