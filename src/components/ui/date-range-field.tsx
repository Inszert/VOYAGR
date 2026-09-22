'use client';

import * as React from 'react';
import { Label } from 'radix-ui';
import { Popover, PopoverAnchor, PopoverPanel, PopoverTrigger } from './popover';
import { Icon } from './icon';
import { cn } from '@/lib/cn';
import type { IsoDate } from '@/core/trip/types';
import { addMonths, isAfter, isBefore, isIsoDate, nightsBetween } from '@/core/dates';
import { CalendarMonth, setNatively } from './calendar-month';

/**
 * Both ends of a trip, chosen in one calendar.
 *
 * Two separate date fields make somebody open a picker, choose, close it,
 * open the second one and then work out for themselves how many nights that
 * came to. A trip is one decision with two ends, so it gets one calendar:
 * the first click sets the departure, the second sets the return, and the
 * nights between are shown while it is open because that is the number the
 * choice is actually about.
 *
 * **Both native inputs are still there and still submitted.** They keep their
 * own names, labels and errors, so the form is unchanged for the server, for
 * a reader using a screen reader field by field, and for anybody with no
 * JavaScript at all. This is one better way to fill in two inputs, not a
 * replacement for them.
 */

export interface DateRangeFieldProps {
  startLabel: string;
  startName: string;
  startValue?: string;
  startError?: string;
  endLabel: string;
  endName: string;
  endValue?: string;
  endError?: string;
  /** Earliest selectable day, as `YYYY-MM-DD`. */
  min?: string;
  /** Latest selectable day. */
  max?: string;
  required?: boolean;
  /** Drop each half's border, for a segmented bar. See `Field`. */
  bare?: boolean;
  className?: string;
}

const iso = (value: string | undefined): IsoDate | null =>
  value && isIsoDate(value) ? (value as IsoDate) : null;

export function DateRangeField({
  startLabel,
  startName,
  startValue,
  startError,
  endLabel,
  endName,
  endValue,
  endError,
  min,
  max,
  required,
  bare = false,
  className,
}: DateRangeFieldProps) {
  const startId = React.useId();
  const endId = React.useId();

  const startRef = React.useRef<HTMLInputElement | null>(null);
  const endRef = React.useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = React.useState(false);

  /**
   * Which end the next click sets.
   *
   * Reset to the start every time the calendar opens, so a second visit is
   * not still halfway through the last one.
   */
  const [picking, setPicking] = React.useState<'start' | 'end'>('start');
  const [month, setMonth] = React.useState<IsoDate | null>(null);

  /*
   * Mirrored from the inputs, never read off them during render.
   *
   * The inputs stay uncontrolled - they are the thing submitted - but the
   * calendar needs to know what they hold, and reaching into a ref while
   * rendering is how a component ends up drawing last render's value. So
   * every change updates this instead, including the ones made here:
   * `setNatively` dispatches the same events typing would, so a day chosen
   * in the calendar arrives back through `onChange` like any other edit.
   */
  const [start, setStart] = React.useState<IsoDate | null>(iso(startValue));
  const [end, setEnd] = React.useState<IsoDate | null>(iso(endValue));

  const floor = iso(min);
  const ceiling = iso(max);

  const anchor = month ?? start ?? floor ?? ('2026-01-01' as IsoDate);

  const disabled = (day: IsoDate) =>
    (floor !== null && isBefore(day, floor)) || (ceiling !== null && isAfter(day, ceiling));

  const choose = (day: IsoDate) => {
    if (picking === 'start' || start === null || isBefore(day, start)) {
      /*
       * A click before the departure starts a new trip rather than making a
       * backwards one. The return is cleared, because a return that is now
       * before its departure is worse than no return at all.
       */
      setNatively(startRef.current, day);
      if (end !== null && !isAfter(end, day)) setNatively(endRef.current, '');

      setPicking('end');
      return;
    }

    setNatively(endRef.current, day);
    setPicking('start');
    setOpen(false);
  };

  const nights = start !== null && end !== null ? nightsBetween(start, end) : null;

  const summary =
    start === null
      ? `Choose ${startLabel.toLowerCase()} and ${endLabel.toLowerCase()}`
      : end === null
        ? `${startLabel} set. Choose ${endLabel.toLowerCase()}.`
        : `${nights} ${nights === 1 ? 'night' : 'nights'}`;

  const half = (
    id: string,
    label: string,
    name: string,
    value: string | undefined,
    error: string | undefined,
    ref: React.MutableRefObject<HTMLInputElement | null>,
    onPick: (value: IsoDate | null) => void,
    rule: boolean,
  ) => (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-0.5',
        bare &&
          rule &&
          'border-hairline border-t pt-2.5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-2.5',
      )}
    >
      <Label.Root
        htmlFor={id}
        className={cn(
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

      <input
        ref={ref}
        id={id}
        type="date"
        name={name}
        defaultValue={value}
        min={min}
        max={max}
        required={required}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onPick(iso(event.target.value))}
        className={cn(
          'voyagr-date text-text w-full min-w-0 text-[16px] sm:text-[14px]',
          bare
            ? 'h-7 truncate border-0 bg-transparent p-0 focus:outline-none'
            : cn(
                'bg-surface-raised h-11 rounded-[--radius-control] border px-3',
                error ? 'border-critical-500' : 'border-border-strong',
              ),
        )}
      />

      <p role="alert" aria-live="polite" className="text-critical-ink text-sm empty:hidden">
        {error}
      </p>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setMonth(start ?? floor ?? null);
          setPicking('start');
        }
        setOpen(next);
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn('relative min-w-0', className)}>
          <div className="grid min-w-0 gap-2.5 pr-7 sm:grid-cols-2">
            {half(
              startId,
              startLabel,
              startName,
              startValue,
              startError,
              startRef,
              setStart,
              false,
            )}
            {half(endId, endLabel, endName, endValue, endError, endRef, setEnd, true)}
          </div>

          {/*
            One button for the pair, because it opens one calendar that sets
            both. Two buttons side by side, each opening the same thing, is
            the arrangement this replaces.
          */}
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'text-dim hover:text-text focus-visible:outline-accent-to absolute top-1/2 right-0 grid -translate-y-1/2 place-items-center rounded-[8px]',
                'size-7 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
                'data-[state=open]:text-text',
              )}
            >
              <Icon name="calendar" className="size-4" />
              <span className="sr-only">
                Choose {startLabel.toLowerCase()} and {endLabel.toLowerCase()} from a calendar
              </span>
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>

      <PopoverPanel align="start" className="w-[19rem] sm:w-[35rem]">
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
            What the calendar is waiting for, and what has been chosen so far.
            Announced, because on a two-click control the state between the
            clicks is the thing a reader most needs told.
          */}
          <p aria-live="polite" className="text-muted text-sm">
            {summary}
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

        {/*
          Two months at once on anything wider than a phone, because a trip
          that crosses the end of a month is the normal case and paging back
          and forth to see both ends of it is the thing that makes a date
          picker tiring.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <CalendarMonth
            anchor={anchor}
            start={start}
            end={end}
            disabled={disabled}
            onChoose={choose}
            label={`${startLabel} and ${endLabel}`}
          />
          <div className="hidden sm:block">
            <CalendarMonth
              anchor={addMonths(anchor, 1)}
              start={start}
              end={end}
              disabled={disabled}
              onChoose={choose}
              label={`${startLabel} and ${endLabel}, following month`}
            />
          </div>
        </div>
      </PopoverPanel>
    </Popover>
  );
}
