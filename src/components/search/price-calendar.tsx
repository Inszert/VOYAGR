'use client';

import * as React from 'react';
import { Icon } from '@/components/ui/icon';
import { monthName, spoken } from '@/components/ui/calendar-month';
import {
  addDays,
  addMonths,
  dayOfWeek,
  daysInMonth,
  isAfter,
  isBefore,
  startOfMonth,
} from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import { cn } from '@/lib/cn';

/**
 * The dates as a calendar, with what each one costs written in it.
 *
 * Two months side by side where there is room and one where there is not, with
 * the whole-trip price in every day the search priced. Picking is two taps -
 * the day you leave, then the day you come back - and the second tap is a link,
 * because choosing dates here narrows trips the search already priced and does
 * not search again.
 *
 * **Every figure arrives formatted.** The server turns each total into a
 * string and hands over a number only to order days by cost; nothing here adds,
 * converts or estimates a price. A day the search did not price shows no price
 * and cannot be chosen - it is unanswered, which is not the same as cheap.
 *
 * **Price is never shown by colour alone.** The cheaper third is heavier and
 * brighter *and* carries a mark, the best value dates carry another, and the
 * legend says what each means.
 */

export interface PriceCalendarOption {
  /**
   * A whole trip (the default), or only the flights.
   *
   * A flight-only day has a flight and no trip built for it. It is shown apart
   * - dashed, muted, marked with a plane - is never shaded as cheap or counted
   * in a saving, and choosing it searches those exact dates for the whole trip.
   */
  readonly kind?: 'trip' | 'flight';
  readonly key: string;
  readonly departure: IsoDate;
  readonly returnDate: IsoDate;
  readonly nights: number;
  /** The whole-trip total, to the cent, for the day's accessible name. */
  readonly exact: string;
  /** The same total in whole units, for the cell. */
  readonly whole: string;
  /** Only for ordering days by cost. Never added to anything. */
  readonly amount: number;
  /**
   * What this return costs against the cheapest return for the same
   * departure, already formatted - e.g. `+€38` - or null when this is that
   * cheapest return. Computed once, server side, from real `Money`; nothing
   * here subtracts a price from another.
   */
  readonly delta: string | null;
  /** Where choosing this pair of dates goes. */
  readonly href: string;
}

export interface PriceCalendarChip {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}

export interface PriceCalendarProps {
  options: readonly PriceCalendarOption[];
  /** The chosen pair, as `2026-06-10..2026-06-15`, or null. */
  selected: string | null;
  cheapestKey: string | null;
  bestValueKey: string | null;
  /** Leaves the chosen dates. */
  clearHref: string | null;
  /** The flexibility presets, each a link that searches again with it. */
  chips: readonly PriceCalendarChip[];
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** Monday-first column of a date, 0 to 6. */
function column(day: IsoDate): number {
  return (dayOfWeek(day) + 6) % 7;
}

function monthCells(anchor: IsoDate): (IsoDate | null)[] {
  const first = startOfMonth(anchor);
  const cells: (IsoDate | null)[] = Array.from({ length: column(first) }, () => null);

  for (let day = 0; day < daysInMonth(first); day += 1) cells.push(addDays(first, day));

  return cells;
}

type Tier = 'low' | 'mid' | 'high';

/** The cheaper third, the middle third and the dearer third of what is on screen. */
function tierOf(amount: number, sorted: readonly number[]): Tier {
  if (sorted.length < 3) return 'mid';

  const low = sorted[Math.floor((sorted.length - 1) / 3)]!;
  const high = sorted[Math.ceil(((sorted.length - 1) * 2) / 3)]!;

  return amount <= low ? 'low' : amount >= high ? 'high' : 'mid';
}

function shortDay(day: IsoDate): string {
  return spoken(day).replace(/ \d{4}$/, '');
}

export function PriceCalendar({
  options,
  selected,
  cheapestKey,
  bestValueKey,
  clearHref,
  chips,
}: PriceCalendarProps) {
  const chosen = options.find((option) => option.key === selected) ?? null;

  const [departure, setDeparture] = React.useState<IsoDate | null>(chosen?.departure ?? null);
  const [offset, setOffset] = React.useState(0);

  // Every month from the first day anyone could leave to the last they could come home.
  const months = React.useMemo(() => {
    if (options.length === 0) return [] as IsoDate[];

    const first = startOfMonth(
      options.reduce((a, o) => (isBefore(o.departure, a) ? o.departure : a), options[0]!.departure),
    );
    const last = startOfMonth(
      options.reduce(
        (a, o) => (isAfter(o.returnDate, a) ? o.returnDate : a),
        options[0]!.returnDate,
      ),
    );

    const list: IsoDate[] = [];
    // At least two, so a desktop never shows half a calendar next to a gap. The
    // second of two is simply a month with nothing priced in it, said as such.
    for (
      let month = first;
      (!isAfter(month, last) || list.length < 2) && list.length < 8;
      month = addMonths(month, 1)
    ) {
      list.push(month);
    }

    return list;
  }, [options]);

  // Leaving: the cheapest total on each day somebody could leave. Coming back:
  // the total for each return that goes with the day already chosen.
  const byDay = React.useMemo(() => {
    const map = new Map<IsoDate, PriceCalendarOption>();

    // A whole trip is a better answer than a flight alone on the same day, and
    // among the same kind the cheaper one wins.
    const better = (a: PriceCalendarOption, b: PriceCalendarOption) =>
      (a.kind ?? 'trip') !== (b.kind ?? 'trip')
        ? (a.kind ?? 'trip') === 'trip'
        : a.amount < b.amount;

    for (const option of options) {
      if (departure !== null && option.departure !== departure) continue;

      const day = departure === null ? option.departure : option.returnDate;
      const current = map.get(day);
      if (!current || better(option, current)) map.set(day, option);
    }

    return map;
  }, [options, departure]);

  const sortedAmounts = React.useMemo(
    // Only whole trips set the scale: a flight alone is not a rival price.
    () =>
      [...byDay.values()]
        .filter((option) => (option.kind ?? 'trip') === 'trip')
        .map((option) => option.amount)
        .sort((a, b) => a - b),
    [byDay],
  );

  const between = (day: IsoDate) =>
    chosen !== null && isAfter(day, chosen.departure) && isBefore(day, chosen.returnDate);

  const shown = months.slice(offset, offset + 2);
  const phase = departure === null ? 'leave' : 'return';

  return (
    <div className="flex flex-col gap-4">
      {/* Flexibility, as chips: each is a new search with that much give in the dates. */}
      {chips.length > 0 ? (
        <div
          role="group"
          aria-label="How flexible are your dates"
          className="flex flex-wrap gap-1.5"
        >
          {chips.map((chip) => (
            <a
              key={chip.label}
              href={chip.href}
              aria-current={chip.active ? 'true' : undefined}
              className={cn(
                'rounded-(--radius-pill) border px-3.5 py-2 text-[13px] font-medium whitespace-nowrap',
                'ease-standard duration-quick transition-colors',
                'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
                chip.active
                  ? 'border-accent-to bg-accent-to/15 text-ink'
                  : 'border-hairline text-ink-muted hover:border-border-strong hover:text-ink',
              )}
            >
              {chip.label}
            </a>
          ))}
        </div>
      ) : null}

      {/* What step this is, and what is chosen so far. */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        aria-live="polite"
      >
        <p className="text-ink text-sm font-medium">
          {phase === 'leave'
            ? 'Choose the day you leave'
            : `Leaving ${shortDay(departure!)} - now choose the day you come back`}
        </p>

        <div className="flex items-center gap-3">
          {phase === 'return' ? (
            <button
              type="button"
              onClick={() => setDeparture(null)}
              className="text-tint-ink text-sm underline underline-offset-4"
            >
              Change the day you leave
            </button>
          ) : null}
          {clearHref && chosen ? (
            <a href={clearHref} className="text-ink-muted text-sm underline underline-offset-4">
              Show every date
            </a>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {shown.map((month, index) => (
            <section
              key={month}
              aria-label={monthName(month)}
              // Only the first month on a phone: one month the size of the
              // screen beats two the size of a postage stamp.
              className={cn('min-w-0', index === 1 && 'hidden md:block')}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                {/* Back from the first month shown; a spacer elsewhere keeps the title centred. */}
                {index === 0 ? (
                  <button
                    type="button"
                    onClick={() => setOffset((value) => Math.max(0, value - 1))}
                    disabled={offset === 0}
                    className="voyagr-popover-nav size-10!"
                  >
                    <Icon name="chevron-left" size={1} />
                    <span className="sr-only">Previous month</span>
                  </button>
                ) : (
                  <span aria-hidden="true" className="size-10" />
                )}

                <h3 className="font-display text-ink text-lg">{monthName(month)}</h3>

                {/* Forward from the last month on show: the second on a desktop, the only one on a phone. */}
                <button
                  type="button"
                  onClick={() => setOffset((value) => Math.min(months.length - 1, value + 1))}
                  disabled={offset >= months.length - 1}
                  className={cn(
                    'voyagr-popover-nav size-10!',
                    index === 0 && shown.length > 1 && 'md:invisible',
                  )}
                >
                  <Icon name="chevron-right" size={1} />
                  <span className="sr-only">Next month</span>
                </button>
              </div>

              <div aria-hidden="true" className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day) => (
                  <span key={day} className="text-dim grid h-7 place-items-center text-[11px]">
                    {day}
                  </span>
                ))}
              </div>

              <div role="grid" aria-label={monthName(month)} className="grid grid-cols-7 gap-1">
                {monthCells(month).map((day, cell) => {
                  if (day === null) return <span key={`blank-${cell}`} />;

                  const option = byDay.get(day);
                  const number = Number(day.slice(8, 10));

                  // A day with nothing priced: a number, no price, not a button.
                  if (!option) {
                    return (
                      <span
                        key={day}
                        role="gridcell"
                        aria-label={`${spoken(day)}, no price`}
                        className={cn(
                          'text-dim grid min-h-12 place-items-start rounded-(--radius-control) p-1.5 text-sm md:min-h-14',
                          between(day) && 'bg-accent-to/10',
                        )}
                      >
                        <span aria-hidden="true">{number}</span>
                      </span>
                    );
                  }

                  const flightOnly = option.kind === 'flight';
                  const tier = flightOnly ? 'mid' : tierOf(option.amount, sortedAmounts);
                  const isDeparture =
                    (chosen !== null && day === chosen.departure) ||
                    (phase === 'return' && day === departure);
                  const isReturn =
                    chosen !== null && day === chosen.returnDate && phase === 'return';
                  const isCheapest = !flightOnly && option.key === cheapestKey;
                  const isBest = !flightOnly && option.key === bestValueKey;

                  const body = (
                    <>
                      <span aria-hidden="true" className="flex w-full items-start justify-between">
                        <span className="text-sm font-medium">{number}</span>
                        <span className="text-[10px] leading-none">
                          {isBest ? '★' : isCheapest ? '▼' : ''}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-auto text-[11px] tabular-nums md:text-xs',
                          tier === 'low' && 'font-bold',
                          tier === 'high' && 'font-normal opacity-70',
                        )}
                      >
                        {flightOnly ? <span className="mr-0.5">✈</span> : null}
                        {option.whole}
                      </span>
                      {/*
                        Once a departure is chosen, each return is read
                        against the cheapest return for that same day - a
                        smaller "+€38" beside the total, the way Kiwi shows
                        what a night more or fewer actually costs, rather than
                        a second total to compare by eye.
                      */}
                      {phase === 'return' && option.delta ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            'text-[10px] leading-none tabular-nums',
                            isDeparture || isReturn ? 'text-white/75' : 'text-ink-muted',
                          )}
                        >
                          {option.delta}
                        </span>
                      ) : null}
                      <span className="sr-only">
                        {spoken(day)},{' '}
                        {flightOnly
                          ? `flights only ${option.exact}, indicative - choosing it searches these dates for the whole trip`
                          : `whole trip ${option.exact}`}
                        {phase === 'leave' && !flightOnly
                          ? ' at the cheapest'
                          : `, ${option.nights} nights`}
                        {phase === 'return' && option.delta
                          ? `, ${option.delta} against the cheapest return for this departure`
                          : ''}
                        {isBest ? ', best value' : isCheapest ? ', cheapest' : ''}
                      </span>
                    </>
                  );

                  const cellClass = cn(
                    'flex min-h-14 flex-col items-stretch rounded-(--radius-control) border p-1.5 text-left md:min-h-16',
                    'ease-standard duration-quick transition-colors',
                    'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-1',
                    isDeparture || isReturn
                      ? 'border-accent-to bg-accent-to text-white'
                      : flightOnly
                        ? 'border-hairline text-ink-muted hover:border-border-strong border-dashed'
                        : between(day)
                          ? 'border-accent-to/30 bg-accent-to/15 text-ink'
                          : tier === 'low'
                            ? 'border-positive-500/40 bg-positive-500/10 text-positive-ink hover:border-positive-500'
                            : 'border-hairline text-ink hover:border-border-strong',
                  );

                  // Leaving is a choice made here; coming back is the link.
                  return phase === 'leave' ? (
                    <button
                      key={day}
                      type="button"
                      role="gridcell"
                      onClick={() => setDeparture(day)}
                      className={cellClass}
                    >
                      {body}
                    </button>
                  ) : (
                    <a key={day} role="gridcell" href={option.href} className={cellClass}>
                      {body}
                    </a>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* What the marks mean. Text, so colour is not the only thing saying it. */}
      <ul className="text-ink-muted flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        <li>
          <span aria-hidden="true">▼ </span>Cheapest dates
        </li>
        <li>
          <span aria-hidden="true">★ </span>Best value
        </li>
        <li>
          <span className="text-positive-ink font-bold">Bold green</span> the cheaper third
        </li>
        <li>
          <span aria-hidden="true">✈ </span>Flights only - no whole trip priced yet; choosing it
          searches those dates
        </li>
        <li>A day with no price was not priced - it is not cheap, and it cannot be chosen</li>
      </ul>
    </div>
  );
}
