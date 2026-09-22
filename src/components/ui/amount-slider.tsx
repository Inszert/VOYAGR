'use client';

import * as React from 'react';
import { Label, Slider } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * A number chosen by dragging, for amounts of money.
 *
 * A spinner is the wrong control for a budget. Its arrows move by one, which
 * is meaningless against a number in the hundreds, and it gives no sense of
 * where the value sits in the range of sensible answers - the thing somebody
 * setting a budget actually wants to know.
 *
 * What it keeps from `Field`, because a slider is not an excuse to drop any
 * of it: a real `<label>` tied to the control, hint and error text linked
 * through `aria-describedby`, `aria-invalid` on failure, and the error in a
 * live region so it is announced rather than merely displayed.
 *
 * **The number is never only a position.** It is written out beside the
 * label, in the same text the field would have shown, so the value is
 * readable without interpreting a pixel offset - which is also what keeps
 * this usable for anyone who cannot see the track.
 */

export interface AmountSliderProps {
  label: string;
  /** Submitted under this name. Radix emits a hidden input for it. */
  name: string;
  /** The current value, as the form holds it: a string of an integer. */
  defaultValue: string;
  /** Supporting text shown under the control. */
  hint?: string;
  /** Validation message. Its presence marks the control invalid. */
  error?: string;
  required?: boolean;
  min?: number;
  /**
   * The top of the track.
   *
   * A slider can only express what its range covers, so this is a floor for
   * the ceiling rather than the ceiling itself: see `roomFor`. A range that
   * could not reach the value it was given would silently submit a different
   * number than the one that was asked for, and numbers on this site are not
   * allowed to change by themselves.
   */
  max?: number;
  step?: number;
  /** Written before the number, e.g. a currency code. */
  unit?: string;
}

/**
 * A top of range that can express the value it is given.
 *
 * Rounded up to the next whole `grain` above the value, never below the
 * suggested ceiling. Somebody who arrived with a fifteen thousand euro budget
 * in the URL keeps it; everybody else gets a track scaled to the usual range
 * rather than to that one person's trip.
 */
export function roomFor(value: number, suggested: number, grain = 500): number {
  if (!Number.isFinite(value) || value <= suggested) return suggested;

  return Math.ceil(value / grain) * grain;
}

export function AmountSlider({
  label,
  name,
  defaultValue,
  hint,
  error,
  required,
  min = 0,
  max = 5000,
  step = 10,
  unit,
}: AmountSliderProps) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const labelId = `${id}-label`;

  const initial = Number.parseInt(defaultValue, 10);
  const start = Number.isFinite(initial) ? initial : min;

  const [value, setValue] = React.useState(start);

  const ceiling = roomFor(start, max);

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label.Root id={labelId} htmlFor={id} className="text-ink text-sm font-medium">
          {label}
          {required ? (
            <>
              {' '}
              <span aria-hidden="true" className="text-critical-500">
                *
              </span>
              <span className="sr-only">(required)</span>
            </>
          ) : null}
        </Label.Root>

        {/*
          The value in words as well as in position.

          `aria-hidden` because the thumb already carries the same number as
          `aria-valuenow`, and a screen reader announcing it twice on every
          arrow key is worse than not announcing it at all.
        */}
        <output
          aria-hidden="true"
          htmlFor={id}
          className="text-text text-sm font-medium tabular-nums"
        >
          {unit ? <span className="text-dim">{unit} </span> : null}
          {value.toLocaleString('en-GB')}
        </output>
      </div>

      <Slider.Root
        name={name}
        value={[value]}
        onValueChange={([next]) => setValue(next ?? min)}
        min={min}
        max={ceiling}
        step={step}
        className="relative flex h-6 w-full touch-none items-center select-none"
      >
        <Slider.Track className="bg-surface-raised border-border-strong relative h-1.5 w-full grow overflow-hidden rounded-full border">
          <Slider.Range className="absolute h-full bg-[linear-gradient(90deg,var(--color-accent-from),var(--color-accent-to))]" />
        </Slider.Track>

        {/*
          The naming goes on the thumb, because the thumb is the slider:
          Radix puts `role="slider"` and the value attributes there, and a
          label on the root names a group nothing is looking for.

          It also carries a real focus ring, and sits in a track 24 high so
          the hit area is bigger than the 16px dot a finger is aiming at.
        */}
        <Slider.Thumb
          id={id}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            'border-accent-to bg-text block size-4 rounded-full border-2 shadow-sm',
            'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
            'motion-safe:transition-transform motion-safe:hover:scale-110',
            error && 'border-critical-500',
          )}
        />
      </Slider.Root>

      {hint ? (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      ) : null}

      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className="text-critical-500 text-sm empty:hidden"
      >
        {error}
      </p>
    </div>
  );
}
