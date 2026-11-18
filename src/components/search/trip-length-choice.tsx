'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * How long the trip may be, chosen where the days are written.
 *
 * Not set, under X days (a maximum of X nights) or over X days (a minimum of
 * X nights), X from 1 to 30. It is the control that used to live in the
 * form's options; it now sits in the calendar, beside the days that show their
 * nights. Same choices, same parameters: `tripLength` (`any`, `under`, `over`)
 * and `tripDays`, which the server turns into `minNights` / `maxNights`
 * (`withTripLength`). Not set is the default and applies no limit.
 */

export type TripLengthMode = '' | 'any' | 'under' | 'over';

const CHOICES: readonly { value: TripLengthMode; label: string }[] = [
  { value: 'any', label: 'Not set' },
  { value: 'under', label: 'Under X days' },
  { value: 'over', label: 'Over X days' },
];

export function tripLengthModeOf(value: string | undefined): TripLengthMode {
  return value === 'any' || value === 'under' || value === 'over' ? value : '';
}

export function tripDaysOf(value: string | undefined): string {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 30 ? String(days) : '7';
}

export interface TripLengthChoiceProps {
  mode: TripLengthMode;
  days: string;
  onModeChange: (mode: TripLengthMode) => void;
  onDaysChange: (days: string) => void;
  /** Submit as `tripLength` and `tripDays` (a calendar that is itself in the form). */
  named?: boolean;
  error?: string | undefined;
}

export function TripLengthChoice({
  mode,
  days,
  onModeChange,
  onDaysChange,
  named = false,
  error,
}: TripLengthChoiceProps) {
  const id = React.useId();
  const setting = mode === 'under' || mode === 'over';

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-ink mb-1 text-sm font-medium">Trip length</legend>
      <div className="flex flex-wrap items-center gap-2">
        {CHOICES.map((choice) => {
          const on = mode === choice.value;
          return (
            <label
              key={choice.value}
              className={cn(
                'has-[:focus-visible]:outline-accent-to inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-(--radius-pill) border px-4 text-[13px] font-medium whitespace-nowrap has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                on
                  ? 'border-accent-to bg-accent-to/15 text-ink'
                  : 'border-hairline text-ink-muted hover:border-border-strong hover:text-ink',
              )}
            >
              <input
                type="radio"
                {...(named ? { name: 'tripLength' } : {})}
                value={choice.value}
                checked={on}
                onChange={() => onModeChange(choice.value)}
                className="accent-accent-to size-4 shrink-0"
              />
              {choice.label}
              {on ? (
                <span className="inline-flex items-center gap-1 text-xs">
                  <span aria-hidden="true">✓</span>Selected
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-days`} className="text-ink text-sm">
          Number of days (X), 1 to 30
        </label>
        <input
          id={`${id}-days`}
          type="number"
          {...(named ? { name: 'tripDays' } : {})}
          min={1}
          max={30}
          step={1}
          value={days}
          onChange={(event) => onDaysChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          className="bg-surface-raised border-border-strong text-text h-11 w-20 rounded-(--radius-control) border px-3 text-[16px] sm:text-[14px]"
        />
      </div>
      <p id={`${id}-hint`} className="text-muted text-xs">
        {setting
          ? mode === 'under'
            ? 'Under X is at most X nights.'
            : 'Over X is at least X nights.'
          : 'Not set applies no limit. Used by Under and Over.'}
      </p>
      <p role="alert" className="text-critical-ink text-sm empty:hidden">
        {error}
      </p>
    </fieldset>
  );
}
