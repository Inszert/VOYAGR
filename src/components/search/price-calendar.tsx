'use client';

import * as React from 'react';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/feedback';
import { monthName, spoken } from '@/components/ui/calendar-month';
import {
  addDays,
  addMonths,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  isAfter,
  isBefore,
  startOfMonth,
} from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import { cn } from '@/lib/cn';
import type { MonthPricesJson } from '@/search/day-prices-json';

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

/**
 * Where to fetch a price for every day the vendor has one.
 *
 * The search prices a handful of date windows; the calendar shows a month, so
 * the rest of its days are read from `/api/price-calendar`, a month at a time,
 * for the months on screen and the one after.
 */
export interface PriceCalendarLoad {
  readonly origin: string;
  /** The places to price: the one asked about, or the ones the search found. */
  readonly destinations: readonly string[];
  readonly currency: string;
  readonly passengers: number;
  readonly minNights: number;
  readonly maxNights: number;
  /** `YYYY-MM-DD`. Days before it cannot be flown, so they are not waited for. */
  readonly today: IsoDate;
  /** A search link with `__DEPARTURE__` and `__RETURN__` where the dates go. */
  readonly hrefTemplate: string;
}

export interface PriceCalendarProps {
  options: readonly PriceCalendarOption[];
  load?: PriceCalendarLoad;
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

const MONTHS_AHEAD_WHEN_LOADING = 12;

/** A month's cells in rows of seven: a `grid` needs `row`s between it and its cells. */
function weeksOf<T>(cells: readonly T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function PriceCalendar({
  options: searchOptions,
  load,
  selected,
  cheapestKey,
  bestValueKey,
  clearHref,
  chips,
}: PriceCalendarProps) {
  const chosen = searchOptions.find((option) => option.key === selected) ?? null;

  const [departure, setDeparture] = React.useState<IsoDate | null>(chosen?.departure ?? null);
  const [offset, setOffset] = React.useState(0);

  // Every month from the first day anyone could leave to the last they could come home.
  const months = React.useMemo(() => {
    if (searchOptions.length === 0 && !load) return [] as IsoDate[];

    const first = startOfMonth(
      searchOptions.length === 0
        ? load!.today
        : searchOptions.reduce(
            (a, o) => (isBefore(o.departure, a) ? o.departure : a),
            searchOptions[0]!.departure,
          ),
    );
    const last = startOfMonth(
      searchOptions.reduce(
        (a, o) => (isAfter(o.returnDate, a) ? o.returnDate : a),
        searchOptions[0]?.returnDate ?? first,
      ),
    );

    // With a vendor to ask, a year of months can be paged to; without one, only
    // the months the search itself priced.
    const most = load ? MONTHS_AHEAD_WHEN_LOADING : 8;

    const list: IsoDate[] = [];
    // At least two, so a desktop never shows half a calendar next to a gap. The
    // second of two is simply a month with nothing priced in it, said as such.
    for (
      let month = first;
      (!isAfter(month, last) || list.length < 2 || load !== undefined) && list.length < most;
      month = addMonths(month, 1)
    ) {
      list.push(month);
    }

    return list;
  }, [searchOptions, load]);

  /*
   * The days the vendor has a flight on, a month at a time.
   *
   * The two visible months are asked for, and the one after them as well, so
   * paging forward finds its prices already there. A month that fails is
   * 'failed' and stays so for the visit: the calendar is still a calendar, with
   * no price on those days, rather than a spinner that never ends.
   */
  const [loaded, setLoaded] = React.useState<Record<string, MonthPricesJson | 'failed'>>({});
  const requested = React.useRef(new Set<string>());

  React.useEffect(() => {
    if (!load) return;

    for (const first of months.slice(offset, offset + 3)) {
      const month = first.slice(0, 7);
      if (requested.current.has(month)) continue;
      requested.current.add(month);

      const params = new URLSearchParams({
        origin: load.origin,
        destinations: load.destinations.join(','),
        month,
        currency: load.currency,
        passengers: String(load.passengers),
        minNights: String(load.minNights),
        maxNights: String(load.maxNights),
      });

      fetch(`/api/price-calendar?${params.toString()}`)
        .then((response) => (response.ok ? (response.json() as Promise<MonthPricesJson>) : null))
        .then(
          (json) => setLoaded((previous) => ({ ...previous, [month]: json ?? 'failed' })),
          () => setLoaded((previous) => ({ ...previous, [month]: 'failed' })),
        );
    }
  }, [load, months, offset]);

  // What the vendor has, as options. Never on a day the search already priced
  // for a trip: that total is the better answer and the two would disagree.
  const { options, monthCheapest } = React.useMemo(() => {
    if (!load) return { options: searchOptions, monthCheapest: new Set<string>() };

    const priced = new Set(searchOptions.map((option) => option.departure));
    const extra: PriceCalendarOption[] = [];
    const cheapest = new Set<string>();

    for (const entry of Object.values(loaded)) {
      if (entry === 'failed') continue;

      let low: PriceCalendarOption | null = null;

      for (const [day, price] of Object.entries(entry.days)) {
        if (priced.has(day)) continue;

        const option: PriceCalendarOption = {
          kind: 'flight',
          key: `flight:${day}..${price.returnDate}`,
          departure: day,
          returnDate: price.returnDate,
          nights: daysBetween(day, price.returnDate),
          exact: price.exact,
          whole: price.whole,
          amount: price.amount,
          delta: null,
          href: load.hrefTemplate
            .replace('__DEPARTURE__', day)
            .replace('__RETURN__', price.returnDate),
        };

        extra.push(option);
        if (!low || option.amount < low.amount) low = option;
      }

      if (low) cheapest.add(low.key);
    }

    return { options: [...searchOptions, ...extra], monthCheapest: cheapest };
  }, [searchOptions, loaded, load]);

  const loading = (day: IsoDate) =>
    load !== undefined && day >= load.today && loaded[day.slice(0, 7)] === undefined;

  const failedMonths = months
    .slice(offset, offset + 2)
    .filter((month) => {
      const entry = loaded[month.slice(0, 7)];
      return entry === 'failed' || (entry !== undefined && entry.reason !== null);
    })
    .map((month) => monthName(month));

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
                {weeksOf(monthCells(month)).map((week, weekIndex) => (
                  <div key={weekIndex} role="row" className="contents">
                    {week.map((day, offset) => {
                      const cell = weekIndex * 7 + offset;
                      if (day === null) {
                        return <span key={`blank-${cell}`} role="gridcell" aria-hidden="true" />;
                      }

                      const option = byDay.get(day);
                      const number = Number(day.slice(8, 10));

                      // A month still on its way: a shimmer where the price will be, so
                      // the cell reads as waiting rather than as having no flight.
                      if (!option && phase === 'leave' && loading(day)) {
                        return (
                          <span
                            key={day}
                            role="gridcell"
                            aria-busy="true"
                            aria-label={`${spoken(day)}, loading price`}
                            className="flex min-h-12 flex-col items-stretch gap-1.5 rounded-(--radius-control) p-1.5 md:min-h-14"
                          >
                            <span aria-hidden="true" className="text-dim text-sm">
                              {number}
                            </span>
                            <Skeleton className="mt-auto h-3 w-3/4" />
                          </span>
                        );
                      }

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
                      const isMonthLow = monthCheapest.has(option.key);
                      const isCheapest = (!flightOnly && option.key === cheapestKey) || isMonthLow;
                      const isBest = !flightOnly && option.key === bestValueKey;

                      const body = (
                        <>
                          <span
                            aria-hidden="true"
                            className="flex w-full items-start justify-between"
                          >
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
                            {isBest
                              ? ', best value'
                              : isMonthLow
                                ? ', cheapest flight this month'
                                : isCheapest
                                  ? ', cheapest'
                                  : ''}
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
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {failedMonths.length > 0 ? (
        <p role="status" className="text-ink-muted text-sm">
          Prices for {failedMonths.join(' and ')} could not be loaded just now. You can still pick a
          day; it searches those dates.
        </p>
      ) : null}

      {/* What the marks mean. Text, so colour is not the only thing saying it. */}
      <ul className="text-ink-muted flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        <li>
          <span aria-hidden="true">▼ </span>Cheapest dates, and the cheapest flight in each month
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
