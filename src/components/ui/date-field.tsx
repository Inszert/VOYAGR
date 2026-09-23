'use client';

import * as React from 'react';
import { Label } from 'radix-ui';
import { Popover, PopoverAnchor, PopoverPanel, PopoverTrigger } from './popover';
import { CalendarMonth, monthName, setNatively } from './calendar-month';
import { Icon } from './icon';
import { cn } from '@/lib/cn';
import type { IsoDate } from '@/core/trip/types';
import { addMonths, isAfter, isBefore, isIsoDate } from '@/core/dates';

/**
 * A date, chosen from a calendar that belongs to this site.
 *
 * **The native input is still the control.** It is in the DOM, it carries the
 * name, and it is what gets submitted - so the form works with no JavaScript
 * and a phone still offers its own wheel picker, which is better than
 * anything drawn here. What is replaced is the desktop browser's calendar:
 * that is browser chrome rendered outside the document, no CSS can reach it,
 * and it is the reason the date field was the one control on the search bar
 * that looked like it came from somewhere else.
 *
 * So the calendar button is an addition, not a substitution. Choosing a day
 * writes into the input and fires the events a listener would expect from
 * typing, which keeps one source of truth for the value.
 *
 * For two dates that are really one decision, reach for `DateRangeField`
 * instead: it opens one calendar that sets both ends and says how many
 * nights that came to.
 */

export interface DateFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  /** Drop the control's own border, for a segmented bar. See `Field`. */
  bare?: boolean;
}

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { label, hint, error, hideLabel = false, bare = false, className, required, ...props },
  ref,
) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState<IsoDate | null>(null);

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const min = typeof props.min === 'string' && isIsoDate(props.min) ? (props.min as IsoDate) : null;
  const max = typeof props.max === 'string' && isIsoDate(props.max) ? (props.max as IsoDate) : null;

  /**
   * The value, read off the input rather than mirrored in state.
   *
   * The input is the source of truth - it can be typed into, reset by the
   * form, or set by the server on a re-render - so the calendar reads it
   * when it opens rather than keeping a second copy that can disagree.
   */
  const current = (): IsoDate | null => {
    const value = inputRef.current?.value ?? '';
    return isIsoDate(value) ? (value as IsoDate) : null;
  };

  const anchor = month ?? current() ?? min ?? ('2026-01-01' as IsoDate);

  const disabled = (day: IsoDate) =>
    (min !== null && isBefore(day, min)) || (max !== null && isAfter(day, max));

  const choose = (day: IsoDate) => {
    setNatively(inputRef.current, day);
    setOpen(false);
    inputRef.current?.focus();
  };

  const selected = open ? current() : null;

  return (
    <div className={cn('flex flex-col', bare ? 'gap-0.5' : 'gap-1.5')}>
      <Label.Root
        htmlFor={id}
        className={cn(
          hideLabel && 'sr-only',
          bare
            ? 'text-dim truncate text-[11px] font-medium tracking-[0.06em] whitespace-nowrap uppercase'
            : 'text-ink text-sm font-medium',
        )}
      >
        {label}
        {required ? (
          <>
            {' '}
            <span aria-hidden="true" className="text-critical-ink">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </Label.Root>

      {/*
        The panel is anchored to the whole field, not to the button.

        Anchored to the button it opened from the button's own edge, which on
        a field near the left of the form threw the calendar out across the
        headline beside it. Anchored here it lines up with the field it sets,
        which is also where the eye already is.
      */}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setMonth(current() ?? min ?? null);
          setOpen(next);
        }}
      >
        <PopoverAnchor asChild>
          <div className="relative flex items-center">
            <input
              ref={(node) => {
                inputRef.current = node;
                if (typeof ref === 'function') ref(node);
                else if (ref) ref.current = node;
              }}
              id={id}
              type="date"
              required={required}
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              className={cn(
                'voyagr-date text-text w-full min-w-0 text-[16px] sm:text-[14px]',
                'disabled:cursor-not-allowed disabled:opacity-70',
                // Room for the button that sits over the right-hand end, so
                // the date is never truncated by it.
                bare
                  ? 'h-7 truncate border-0 bg-transparent p-0 pr-[18px] focus:outline-none'
                  : cn(
                      'bg-surface-raised h-11 rounded-[--radius-control] border pr-10 pl-3',
                      error ? 'border-critical-500' : 'border-border-strong',
                    ),
                className,
              )}
              {...props}
            />

            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'text-dim hover:text-text focus-visible:outline-accent-to absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-[8px]',
                  'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
                  'data-[state=open]:text-text',
                  // The box, not the glyph: it is transparent, so a
                  // larger target costs nothing visually.
                  bare ? 'right-0 size-7' : 'right-1 size-9',
                )}
              >
                <Icon name="calendar" className={bare ? 'size-[14px]' : 'size-4'} />
                <span className="sr-only">Choose {label.toLowerCase()} from a calendar</span>
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>

        <PopoverPanel align="start" className="w-[19rem]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonth(addMonths(anchor, -1))}
              className="voyagr-popover-nav"
            >
              <Icon name="chevron-left" className="size-4" />
              <span className="sr-only">Previous month</span>
            </button>

            {/*
              The month is announced when it changes, so stepping through with
              the buttons says where you have got to rather than silently
              redrawing the grid.
            */}
            <p aria-live="polite" className="text-text text-sm font-medium">
              {monthName(anchor)}
            </p>

            <button
              type="button"
              onClick={() => setMonth(addMonths(anchor, 1))}
              className="voyagr-popover-nav"
            >
              <Icon name="chevron-right" className="size-4" />
              <span className="sr-only">Next month</span>
            </button>
          </div>

          <CalendarMonth
            anchor={anchor}
            start={selected}
            disabled={disabled}
            onChoose={choose}
            label={label}
            heading={false}
          />
        </PopoverPanel>
      </Popover>

      {hint && !bare ? (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      ) : null}
      {hint && bare ? (
        <p id={hintId} className="sr-only">
          {hint}
        </p>
      ) : null}

      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className="text-critical-ink text-sm empty:hidden"
      >
        {error}
      </p>
    </div>
  );
});
