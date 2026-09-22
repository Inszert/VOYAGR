'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';
import type { IsoDate } from '@/core/trip/types';
import { addDays, dayOfWeek, daysInMonth, isAfter, isBefore, startOfMonth } from '@/core/dates';

/**
 * One month of days, drawn the same way wherever a calendar appears.
 *
 * Shared by the single date field and the range field so there is one grid,
 * one set of day states and one month header to restyle rather than two that
 * drift apart.
 *
 * Every date here is a `YYYY-MM-DD` string advanced with `src/core/dates.ts`.
 * Nothing is parsed into a `Date` for arithmetic - that is what reintroduces
 * the timezone drift those helpers exist to avoid.
 */

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** Monday-first column for a date, 0 to 6. `dayOfWeek` is Sunday-first. */
function column(isoDate: IsoDate): number {
  return (dayOfWeek(isoDate) + 6) % 7;
}

/** How a day reads when announced: "22 September 2026". */
export function spoken(isoDate: IsoDate): string {
  return `${Number(isoDate.slice(8, 10))} ${MONTHS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}`;
}

/** The month and year, written out. */
export function monthName(isoDate: IsoDate): string {
  return `${MONTHS[Number(isoDate.slice(5, 7)) - 1]} ${isoDate.slice(0, 4)}`;
}

/** Every day of the month, with leading blanks so the first lands in its column. */
function monthGrid(anchor: IsoDate): (IsoDate | null)[] {
  const first = startOfMonth(anchor);
  const cells: (IsoDate | null)[] = Array.from({ length: column(first) }, () => null);

  for (let day = 0; day < daysInMonth(first); day += 1) {
    cells.push(addDays(first, day));
  }

  return cells;
}

/**
 * Write a value into an input from outside, so every listener sees it.
 *
 * Assigning to `input.value` directly is invisible to React, which tracks the
 * last value it wrote and treats the change as a no-op. Going through the
 * prototype's setter and then dispatching the events typing would have fired
 * is the standard way to drive an input from outside and have React, the form
 * and any other listener all agree about what it now holds.
 */
export function setNatively(input: HTMLInputElement | null, value: string): void {
  if (!input) return;

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export interface CalendarMonthProps {
  /** Any day in the month to draw. */
  anchor: IsoDate;
  /** The chosen day, or the first of a chosen range. */
  start: IsoDate | null;
  /** The last day of a chosen range. Omitted for a single date. */
  end?: IsoDate | null;
  disabled: (day: IsoDate) => boolean;
  onChoose: (day: IsoDate) => void;
  /** Names the grid for assistive technology. */
  label: string;
  /** Show the month's name above the grid. The range field prints its own. */
  heading?: boolean;
}

export function CalendarMonth({
  anchor,
  start,
  end = null,
  disabled,
  onChoose,
  label,
  heading = true,
}: CalendarMonthProps) {
  const within = (day: IsoDate) =>
    start !== null && end !== null && isAfter(day, start) && isBefore(day, end);

  return (
    <div>
      {heading ? (
        <p className="text-text mb-1 text-center text-sm font-medium">{monthName(anchor)}</p>
      ) : null}

      <div aria-hidden="true" className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((day) => (
          <span key={day} className="text-dim grid h-6 place-items-center text-[11px]">
            {day}
          </span>
        ))}
      </div>

      <div role="grid" aria-label={label} className="grid grid-cols-7 gap-0.5">
        {monthGrid(anchor).map((day, index) =>
          day === null ? (
            <span key={`blank-${index}`} />
          ) : (
            <button
              key={day}
              type="button"
              role="gridcell"
              disabled={disabled(day)}
              aria-current={day === start || day === end ? 'date' : undefined}
              onClick={() => onChoose(day)}
              className={cn(
                'voyagr-day',
                within(day) && 'voyagr-day-between',
                (day === start || day === end) && 'voyagr-day-on',
              )}
            >
              <span aria-hidden="true">{Number(day.slice(8, 10))}</span>
              <span className="sr-only">
                {spoken(day)}
                {day === start && end !== null ? ', first night' : ''}
                {day === end ? ', last day' : ''}
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
