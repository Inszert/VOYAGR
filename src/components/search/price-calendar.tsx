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
import {
  TripLengthChoice,
  tripDaysOf,
  tripLengthModeOf,
  type TripLengthMode,
} from './trip-length-choice';
import { weekdayDate } from '@/lib/display-date';
import {
  MAX_RETURN_OPTIONS,
  type MonthPricesJson,
  type OneWayPriceJson,
} from '@/search/day-prices-json';

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

/** Orders a whole trip before a flight alone; 0 when they are the same kind. */
function tripFirst(a: PriceCalendarOption, b: PriceCalendarOption): number {
  const x = (a.kind ?? 'trip') === 'trip' ? 0 : 1;
  const y = (b.kind ?? 'trip') === 'trip' ? 0 : 1;
  return x - y;
}

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
  /** The same total in whole units. */
  readonly whole: string;
  /** The total per traveller, whole units: what the cell shows. */
  readonly perPerson: string;
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
  /**
   * The trip length the traveller chose ("under X" / "over X" nights): only
   * returns between these, inclusive, are offered. Absent means any length.
   */
  readonly lengthMin?: number;
  readonly lengthMax?: number;
  /** `YYYY-MM-DD`. Days before it cannot be flown, so they are not waited for. */
  readonly today: IsoDate;
  /** A search link with `__DEPARTURE__` and `__RETURN__` where the dates go. */
  readonly hrefTemplate: string;
}

/**
 * The trip length, set where the days are written. A plain form that searches
 * again: the rest of the search rides along as hidden fields, and the length
 * goes as `tripLength` and `tripDays`, exactly as the search form sent it.
 */
export interface PriceCalendarLengthForm {
  readonly action: string;
  /** Every other parameter of the search, carried through unchanged. */
  readonly fields: Readonly<Record<string, string>>;
  readonly tripLength: string;
  readonly tripDays: string;
}

export interface PriceCalendarProps {
  lengthForm?: PriceCalendarLengthForm;
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
  /**
   * The four quick choices ("This month", "± 3 days", "± 7 days", "Any date"),
   * always in view above the calendar, never folded. Each is the same link a
   * flexibility chip is: a search with that `flexibility`.
   */
  shortcuts?: readonly PriceCalendarChip[];
  /** The party every total is for. Cells show per person; the legend says so. */
  travellers?: number;
  /**
   * The dates the search is for, when no pair has been picked here: the ones in
   * the address. Null for either means it was not given.
   */
  datesFromSearch?: { readonly leave: IsoDate | null; readonly back: IsoDate | null };
}

const WEEKDAYS = [
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
  ['Su', 'Sunday'],
] as const;

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
  shortcuts = [],
  travellers,
  datesFromSearch,
  lengthForm,
}: PriceCalendarProps) {
  const partySize = travellers ?? load?.passengers ?? 1;
  const party = `${partySize} ${partySize === 1 ? 'traveller' : 'travellers'}`;
  const chosen = searchOptions.find((option) => option.key === selected) ?? null;

  const [departure, setDeparture] = React.useState<IsoDate | null>(chosen?.departure ?? null);
  const [offset, setOffset] = React.useState(0);
  // The collapsed state only exists on a phone: from `md` up the body is always there.
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  /*
   * One list of date options, each once. The quick choices come first and the
   * presets follow; a label already in the list is not drawn a second time.
   */
  const dateOptions = [...shortcuts, ...chips].filter(
    (option, index, all) => all.findIndex((other) => other.label === option.label) === index,
  );
  const activeShortcut = dateOptions.find((option) => option.active);
  // The day the keyboard is on. One day in the whole grid is a tab stop; arrows move it.
  const [focusDay, setFocusDay] = React.useState<IsoDate | null>(null);
  const pendingFocus = React.useRef(false);
  const gridRoot = React.useRef<HTMLDivElement>(null);
  // Whether two months are on screen, so a key can page to a month that is not hidden.
  const [wide, setWide] = React.useState(true);

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 768px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Focus follows a key press once the month it landed in has rendered.
  React.useEffect(() => {
    if (!pendingFocus.current || !focusDay) return;
    pendingFocus.current = false;
    gridRoot.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  });

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
    const searchPairs = new Set(
      searchOptions.map((option) => `${option.departure}..${option.returnDate}`),
    );
    const extra: PriceCalendarOption[] = [];
    const cheapest = new Set<string>();

    for (const entry of Object.values(loaded)) {
      if (entry === 'failed') continue;

      let low: PriceCalendarOption | null = null;

      for (const [day, price] of Object.entries(entry.days)) {
        // A day the search priced keeps its trip total in the cell; the month's
        // other returns for it are still offered once that departure is chosen.
        const searchPriced = priced.has(day);

        // Every return the month holds for this departure, not only the cheapest.
        for (const ret of price.returns ?? [price]) {
          if (searchPriced && searchPairs.has(`${day}..${ret.returnDate}`)) continue;
          const stay = daysBetween(day, ret.returnDate);
          if (load.lengthMin !== undefined && stay < load.lengthMin) continue;
          if (load.lengthMax !== undefined && stay > load.lengthMax) continue;
          const option: PriceCalendarOption = {
            kind: 'flight',
            key: `flight:${day}..${ret.returnDate}`,
            departure: day,
            returnDate: ret.returnDate,
            nights: daysBetween(day, ret.returnDate),
            exact: ret.exact,
            whole: ret.whole,
            perPerson: ret.perPerson,
            amount: ret.amount,
            delta: null,
            href: load.hrefTemplate
              .replace('__DEPARTURE__', day)
              .replace('__RETURN__', ret.returnDate),
          };

          extra.push(option);
          if (!searchPriced && (!low || option.amount < low.amount)) low = option;
        }
      }

      if (low) cheapest.add(low.key);
    }

    const fits = (option: PriceCalendarOption) =>
      (load.lengthMin === undefined || option.nights >= load.lengthMin) &&
      (load.lengthMax === undefined || option.nights <= load.lengthMax);

    return { options: [...searchOptions.filter(fits), ...extra], monthCheapest: cheapest };
  }, [searchOptions, loaded, load]);

  /*
   * One-way fares out, for days with no return fare at all. Never a return
   * price: the cell says "one way" in its name and carries its own mark, it is
   * not a button, and it never sets the scale or a "cheapest".
   */
  const oneWayByDay = React.useMemo(() => {
    const map = new Map<IsoDate, OneWayPriceJson>();
    for (const entry of Object.values(loaded)) {
      if (entry === 'failed' || !entry.oneWay) continue;
      for (const [day, fare] of Object.entries(entry.oneWay)) map.set(day, fare);
    }
    return map;
  }, [loaded]);

  // Every stored single flight on one day, flights only: out on the day chosen,
  // and back on the day the cheapest return names. Never a trip price.
  const storedFlights = (
    key: 'oneWayOptions' | 'oneWayBack',
    day: IsoDate | null,
  ): readonly OneWayPriceJson[] => {
    if (day === null) return [];
    const entry = loaded[day.slice(0, 7)];
    if (entry === undefined || entry === 'failed') return [];
    return (entry[key]?.[day] ?? []).slice(0, MAX_RETURN_OPTIONS);
  };

  const loading = (day: IsoDate) =>
    load !== undefined && day >= load.today && loaded[day.slice(0, 7)] === undefined;

  const failedMonths = months
    .slice(offset, offset + 2)
    .filter((month) => {
      const entry = loaded[month.slice(0, 7)];
      return entry === 'failed' || (entry !== undefined && entry.reason !== null);
    })
    .map((month) => monthName(month));

  // The returns for the departure chosen: one per return date, cheapest first,
  // Only what the search and the month already hold.
  const returnList = React.useMemo(() => {
    if (departure === null) return [];
    const byReturn = new Map<IsoDate, PriceCalendarOption>();
    for (const option of options) {
      if (option.departure !== departure) continue;
      const seen = byReturn.get(option.returnDate);
      if (
        !seen ||
        tripFirst(option, seen) < 0 ||
        (tripFirst(option, seen) === 0 && option.amount < seen.amount)
      ) {
        byReturn.set(option.returnDate, option);
      }
    }
    // Every later day that is priced as a day to leave is also a day to come
    // back: offered with that day's own price and labels, unless the stored
    // pairs already hold a return for the date. The length filter still applies.
    if (load) {
      const cheapestOut = new Map<IsoDate, PriceCalendarOption>();
      for (const option of options) {
        const seen = cheapestOut.get(option.departure);
        if (
          !seen ||
          tripFirst(option, seen) < 0 ||
          (tripFirst(option, seen) === 0 && option.amount < seen.amount)
        ) {
          cheapestOut.set(option.departure, option);
        }
      }
      const onScreen = new Set(months.slice(offset, offset + 2).map((month) => month.slice(0, 7)));
      for (const [day, priced] of cheapestOut) {
        if (!isAfter(day, departure) || byReturn.has(day)) continue;
        if (!onScreen.has(day.slice(0, 7))) continue;
        const nights = daysBetween(departure, day);
        if (load.lengthMin !== undefined && nights < load.lengthMin) continue;
        if (load.lengthMax !== undefined && nights > load.lengthMax) continue;
        byReturn.set(day, {
          ...priced,
          key: `flight:${departure}..${day}`,
          departure,
          returnDate: day,
          nights,
          delta: null,
          href: load.hrefTemplate.replace('__DEPARTURE__', departure).replace('__RETURN__', day),
        });
      }
    }
    // A whole trip is a different price from a flight alone, so the two are not
    // mixed into one ranking: trips first, then flights, each cheapest first.
    return [...byReturn.values()].sort(
      (a, b) => tripFirst(a, b) || a.amount - b.amount || a.returnDate.localeCompare(b.returnDate),
    );
  }, [options, departure, load, months, offset]);

  // Leaving: the cheapest total on each day somebody could leave. Coming back:
  // each day's cell is the return in `returnList` - the one source the cell and
  // the figure it stands for both come from, so they cannot disagree.
  const byDay = React.useMemo(() => {
    const map = new Map<IsoDate, PriceCalendarOption>();

    if (departure !== null) {
      for (const option of returnList) map.set(option.returnDate, option);
      return map;
    }

    // A whole trip is a better answer than a flight alone on the same day, and
    // among the same kind the cheaper one wins.
    const better = (a: PriceCalendarOption, b: PriceCalendarOption) =>
      (a.kind ?? 'trip') !== (b.kind ?? 'trip')
        ? (a.kind ?? 'trip') === 'trip'
        : a.amount < b.amount;

    for (const option of options) {
      const current = map.get(option.departure);
      if (!current || better(option, current)) map.set(option.departure, option);
    }

    return map;
  }, [options, departure, returnList]);

  const sortedAmounts = React.useMemo(
    // Only whole trips set the scale: a flight alone is not a rival price.
    () =>
      [...byDay.values()]
        .filter((option) => (option.kind ?? 'trip') === 'trip')
        .map((option) => option.amount)
        .sort((a, b) => a - b),
    [byDay],
  );

  // The pair on show: the one being picked, or else the one chosen, or else the
  // one the search itself was asked about.
  const phase = departure === null ? 'leave' : 'return';
  const start = phase === 'return' ? departure : (chosen?.departure ?? null);
  const end = chosen !== null && start === chosen.departure ? chosen.returnDate : null;

  const between = (day: IsoDate) =>
    start !== null && end !== null && isAfter(day, start) && isBefore(day, end);

  const shown = months.slice(offset, offset + 2);
  const visibleCount = wide ? 2 : 1;

  const leaveShown = start ?? datesFromSearch?.leave ?? null;
  const backShown = end ?? (phase === 'leave' ? (datesFromSearch?.back ?? null) : null);
  const nightsShown =
    leaveShown && backShown && isAfter(backShown, leaveShown)
      ? daysBetween(leaveShown, backShown)
      : null;

  const inShown = (day: IsoDate) => shown.some((month) => month.slice(0, 7) === day.slice(0, 7));
  // The return dates priced in the months on screen: what the calendar draws.
  const returnCount = phase === 'return' ? [...byDay.keys()].filter(inShown).length : 0;

  // The one day Tab lands on: where the keyboard last was, else the day leaving,
  // else the first day with a price, else the first of the month.
  const tabStop: IsoDate | null = (() => {
    if (shown.length === 0) return null;
    if (focusDay && inShown(focusDay)) return focusDay;
    if (start && inShown(start)) return start;
    const priced = [...byDay.keys()].filter(inShown).sort()[0];
    return priced ?? shown[0]!;
  })();

  const cellKeys = (day: IsoDate) => ({
    'data-day': day,
    tabIndex: day === tabStop ? 0 : -1,
  });

  function moveTo(next: IsoDate) {
    const index = months.findIndex((month) => month.slice(0, 7) === next.slice(0, 7));
    if (index === -1) return;

    if (index < offset) setOffset(index);
    else if (index >= offset + visibleCount) setOffset(index - visibleCount + 1);

    pendingFocus.current = true;
    setFocusDay(next);
  }

  function onGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-day]');
    const day = target?.getAttribute('data-day') as IsoDate | null | undefined;
    if (!day || event.altKey || event.ctrlKey || event.metaKey) return;

    const next =
      event.key === 'ArrowLeft'
        ? addDays(day, -1)
        : event.key === 'ArrowRight'
          ? addDays(day, 1)
          : event.key === 'ArrowUp'
            ? addDays(day, -7)
            : event.key === 'ArrowDown'
              ? addDays(day, 7)
              : event.key === 'Home'
                ? addDays(day, -column(day))
                : event.key === 'End'
                  ? addDays(day, 6 - column(day))
                  : event.key === 'PageUp'
                    ? addMonths(day, event.shiftKey ? -12 : -1)
                    : event.key === 'PageDown'
                      ? addMonths(day, event.shiftKey ? 12 : 1)
                      : null;

    if (!next) return;
    event.preventDefault();
    moveTo(next);
  }

  return (
    <div role="group" aria-label="Calendar" className="flex flex-col gap-4">
      {/*
        Shortcuts for how many dates to look at. Above the calendar and outside
        the part that folds on a phone, so they are there before anything is
        opened. The chosen one is said in words and marked with a tick.
      */}
      {dateOptions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-sm font-medium">
            Date options
            {activeShortcut ? (
              <span className="text-ink-muted font-normal">
                {' '}
                &middot; showing {activeShortcut.label}
              </span>
            ) : null}
          </p>
          <div role="group" aria-label="Date options" className="flex flex-wrap gap-2">
            {dateOptions.map((shortcut) => (
              <a
                key={shortcut.label}
                href={shortcut.href}
                aria-current={shortcut.active ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-(--radius-pill) border px-4 text-[13px] font-medium whitespace-nowrap',
                  'ease-standard duration-quick transition-colors',
                  'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
                  shortcut.active
                    ? 'border-accent-to bg-accent-to/15 text-ink'
                    : 'border-hairline text-ink-muted hover:border-border-strong hover:text-ink',
                )}
              >
                {shortcut.active ? <span aria-hidden="true">✓</span> : null}
                {shortcut.label}
                {shortcut.active ? <span className="sr-only">(selected)</span> : null}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {lengthForm ? <CalendarLengthForm form={lengthForm} /> : null}

      {/*
        The dates, said once and always on screen: what leaving and coming back
        are right now. On a phone the calendar folds away behind the button and
        this line is all that is left of it.
      */}
      <div className="border-hairline flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-(--radius-card) border p-3">
        <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
          <div className="min-w-0">
            <dt className="text-dim text-[11px] font-semibold tracking-[0.1em] uppercase">Leave</dt>
            <dd className="text-ink text-sm font-medium tabular-nums">
              {leaveShown ? weekdayDate(leaveShown) : 'Not chosen'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-dim text-[11px] font-semibold tracking-[0.1em] uppercase">
              Come back
            </dt>
            <dd className="text-ink text-sm font-medium tabular-nums">
              {backShown ? weekdayDate(backShown) : 'Not chosen'}
              {nightsShown !== null ? (
                <span className="text-ink-muted font-normal">
                  {' '}
                  · {nightsShown} {nightsShown === 1 ? 'night' : 'nights'}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-x-4">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              'border-hairline text-ink inline-flex min-h-11 items-center gap-2 rounded-(--radius-control) border px-4 text-sm font-medium md:hidden',
              'ease-standard duration-quick hover:border-border-strong transition-colors',
              'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
            )}
          >
            {open ? 'Hide the calendar' : 'Change dates'}
            <Icon
              name={open ? 'chevron-up' : 'chevron-down'}
              size={0.9}
              aria-hidden="true"
              className="text-dim"
            />
          </button>
          {clearHref && chosen ? (
            <a
              href={clearHref}
              className="text-ink-muted focus-visible:outline-accent-to inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Show every date
            </a>
          ) : null}
        </div>
      </div>

      <div id={bodyId} className={cn('flex flex-col gap-4', !open && 'max-md:hidden')}>
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
                className="text-tint-ink focus-visible:outline-accent-to inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Change the day you leave
              </button>
            ) : null}
          </div>
        </div>

        {phase === 'return' ? (
          <p role="status" className="text-ink-muted text-sm">
            {returnCount > 0
              ? `${returnCount} return ${returnCount === 1 ? 'date' : 'dates'} priced after ${shortDay(departure!)}, shown in the calendar below.`
              : 'No return priced for this departure yet.'}
          </p>
        ) : null}

        {phase === 'return'
          ? (
              [
                ['oneWayOptions', 'out', departure, 'Flights out'],
                ['oneWayBack', 'back', returnList[0]?.returnDate ?? null, 'Flights back'],
              ] as const
            ).map(([key, id, day, title]) => {
              const list = storedFlights(key, day);
              if (day === null || list.length === 0) return null;
              return (
                <ul
                  key={id}
                  aria-label={`${title} on ${shortDay(day)}, flights only, cheapest first`}
                  className="flex flex-col gap-2"
                >
                  {list.map((fare, index) => (
                    <li
                      key={`${fare.amount}-${index}`}
                      className="border-hairline text-ink-muted flex min-h-11 flex-wrap items-center justify-between gap-x-4 rounded-(--radius-control) border border-dotted px-3 py-2 text-sm"
                    >
                      <span>
                        {title} {spoken(day)}
                        <span> - flights only</span>
                      </span>
                      <span className="tabular-nums">{fare.exact}</span>
                      <span className="sr-only"> for {party}</span>
                    </li>
                  ))}
                </ul>
              );
            })
          : null}

        <div ref={gridRoot} onKeyDown={onGridKeyDown} className="flex flex-col gap-3">
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
                      className="voyagr-popover-nav size-11!"
                    >
                      <Icon name="chevron-left" size={1} />
                      <span className="sr-only">Previous month</span>
                    </button>
                  ) : (
                    <span aria-hidden="true" className="size-11" />
                  )}

                  {/*
                    The month the chosen day is in says so: a filled pill with
                    a tick and the word "Selected", so it is never only colour.
                  */}
                  {start !== null && startOfMonth(start) === startOfMonth(month) ? (
                    <h3 className="bg-accent-to inline-flex items-center gap-2 rounded-(--radius-pill) px-4 py-1.5 text-base font-semibold text-white">
                      <span aria-hidden="true">✓</span>
                      <span className="font-display">{monthName(month)}</span>
                      <span className="text-xs font-medium">Selected</span>
                    </h3>
                  ) : (
                    <h3 className="font-display text-ink text-lg">{monthName(month)}</h3>
                  )}

                  {/* Forward from the last month on show: the second on a desktop, the only one on a phone. */}
                  <button
                    type="button"
                    onClick={() => setOffset((value) => Math.min(months.length - 1, value + 1))}
                    disabled={offset >= months.length - 1}
                    className={cn(
                      'voyagr-popover-nav size-11!',
                      index === 0 && shown.length > 1 && 'md:invisible',
                    )}
                  >
                    <Icon name="chevron-right" size={1} />
                    <span className="sr-only">Next month</span>
                  </button>
                </div>

                <div role="grid" aria-label={monthName(month)} className="grid grid-cols-7 gap-1">
                  <div role="row" className="contents">
                    {WEEKDAYS.map(([short, full]) => (
                      <span
                        key={full}
                        role="columnheader"
                        aria-label={full}
                        className="text-dim grid h-7 place-items-center text-[11px]"
                      >
                        <span aria-hidden="true">{short}</span>
                      </span>
                    ))}
                  </div>

                  {weeksOf(monthCells(month)).map((week, weekIndex) => (
                    <div key={weekIndex} role="row" className="contents">
                      {week.map((day, offset) => {
                        const cell = weekIndex * 7 + offset;
                        if (day === null) {
                          return <span key={`blank-${cell}`} role="gridcell" aria-hidden="true" />;
                        }

                        const option = byDay.get(day);
                        const number = Number(day.slice(8, 10));
                        const past = load !== undefined && isBefore(day, load.today);
                        const isStart = start !== null && day === start;
                        const isEnd = end !== null && day === end;

                        // A day already gone: there is nothing to choose, and it says so.
                        if (past && !option) {
                          return (
                            <span
                              key={day}
                              role="gridcell"
                              aria-disabled="true"
                              aria-label={`${spoken(day)}, in the past`}
                              {...cellKeys(day)}
                              className="text-dim/60 focus-visible:outline-accent-to grid min-h-12 place-items-start rounded-(--radius-control) p-1.5 text-sm focus-visible:outline-2 md:min-h-14"
                            >
                              <span aria-hidden="true">{number}</span>
                            </span>
                          );
                        }

                        // A month still on its way: a shimmer where the price will be, so
                        // the cell reads as waiting rather than as having no flight.
                        if (!option && phase === 'leave' && loading(day)) {
                          return (
                            <span
                              key={day}
                              role="gridcell"
                              aria-busy="true"
                              aria-disabled="true"
                              aria-label={`${spoken(day)}, loading price`}
                              {...cellKeys(day)}
                              className="focus-visible:outline-accent-to flex min-h-12 flex-col items-stretch gap-1.5 rounded-(--radius-control) p-1.5 focus-visible:outline-2 md:min-h-14"
                            >
                              <span aria-hidden="true" className="text-dim text-sm">
                                {number}
                              </span>
                              <Skeleton className="mt-auto h-3 w-3/4" />
                            </span>
                          );
                        }

                        // Only a one-way fare out: said as such, and not a choice.
                        const oneWay = phase === 'leave' ? oneWayByDay.get(day) : undefined;
                        if (!option && oneWay) {
                          return (
                            <span
                              key={day}
                              role="gridcell"
                              aria-disabled="true"
                              aria-label={`${spoken(day)}, no return fare seen; one way from ${oneWay.perPerson} per person`}
                              {...cellKeys(day)}
                              className={cn(
                                'text-ink-muted border-hairline focus-visible:outline-accent-to flex min-h-14 flex-col items-stretch rounded-(--radius-control) border border-dotted p-1.5 focus-visible:outline-2 md:min-h-16',
                                between(day) && 'bg-accent-to/10',
                              )}
                            >
                              <span aria-hidden="true" className="text-sm">
                                {number}
                              </span>
                              <span
                                aria-hidden="true"
                                className="mt-auto text-[10px] leading-tight tabular-nums md:text-[11px]"
                              >
                                <span className="mr-0.5">→</span>
                                {oneWay.perPerson}
                              </span>
                            </span>
                          );
                        }

                        // A day with nothing priced: a number and a dash, not a button.
                        if (!option) {
                          const edge = isStart || isEnd;
                          return (
                            <span
                              key={day}
                              role="gridcell"
                              aria-disabled="true"
                              aria-label={
                                isStart && phase === 'return'
                                  ? `${spoken(day)}, your departure, selected`
                                  : `${spoken(day)}, ${
                                      isStart
                                        ? 'your departure, selected, '
                                        : isEnd
                                          ? 'your return, '
                                          : ''
                                    }no price yet`
                              }
                              {...cellKeys(day)}
                              className={cn(
                                'focus-visible:outline-accent-to flex min-h-12 flex-col items-stretch rounded-(--radius-control) p-1.5 text-sm focus-visible:outline-2 md:min-h-14',
                                edge
                                  ? 'bg-accent-to border border-transparent text-white'
                                  : cn('text-dim', between(day) && 'bg-accent-to/10'),
                              )}
                            >
                              <span
                                aria-hidden="true"
                                className="flex w-full items-start justify-between"
                              >
                                <span>{number}</span>
                                <span className="text-[10px] leading-none">
                                  {isStart ? '✓' : isEnd ? 'Back' : ''}
                                </span>
                              </span>
                              {isStart && phase === 'return' ? (
                                <span
                                  aria-hidden="true"
                                  className="mt-auto text-[10px] leading-none font-medium"
                                >
                                  Leaving
                                </span>
                              ) : null}
                              {edge ? null : (
                                <span
                                  aria-hidden="true"
                                  className="mt-auto text-[11px] leading-none"
                                >
                                  &ndash;
                                </span>
                              )}
                            </span>
                          );
                        }

                        const flightOnly = option.kind === 'flight';
                        const tier = flightOnly ? 'mid' : tierOf(option.amount, sortedAmounts);
                        const isDeparture = isStart;
                        const isReturn =
                          chosen !== null && day === chosen.returnDate && phase === 'return';
                        const isLeaveEnd = isEnd && !isReturn;
                        const isMonthLow = monthCheapest.has(option.key);
                        const isCheapest =
                          (!flightOnly && option.key === cheapestKey) || isMonthLow;
                        const isBest = !flightOnly && option.key === bestValueKey;

                        const body = (
                          <>
                            <span
                              aria-hidden="true"
                              className="flex w-full items-start justify-between"
                            >
                              <span className="text-sm font-medium">{number}</span>
                              <span className="text-[10px] leading-none">
                                {isDeparture
                                  ? '✓'
                                  : isReturn || isLeaveEnd
                                    ? 'Back'
                                    : isBest
                                      ? '★'
                                      : isCheapest
                                        ? '▼'
                                        : ''}
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
                              {option.perPerson}
                            </span>
                            {phase === 'return' ? (
                              <span
                                aria-hidden="true"
                                className={cn(
                                  'text-[10px] leading-tight tabular-nums',
                                  isDeparture || isReturn ? 'text-white/85' : 'text-ink-muted',
                                )}
                              >
                                <span className="md:hidden">{option.nights}n</span>
                                <span className="whitespace-nowrap max-md:hidden">
                                  {option.nights} {option.nights === 1 ? 'night' : 'nights'}
                                </span>
                              </span>
                            ) : null}
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
                                  'text-[10px] leading-none tabular-nums max-md:hidden',
                                  isDeparture || isReturn ? 'text-white/75' : 'text-ink-muted',
                                )}
                              >
                                {option.delta}
                              </span>
                            ) : null}
                            <span className="sr-only">
                              {spoken(day)},{' '}
                              {flightOnly
                                ? `flights only ${option.perPerson} per person, ${option.exact} for ${party}, indicative - choosing it searches these dates for the whole trip`
                                : `whole trip ${option.perPerson} per person, ${option.exact} for ${party}`}
                              {phase === 'leave' && !flightOnly
                                ? ' at the cheapest'
                                : `, ${option.nights} ${option.nights === 1 ? 'night' : 'nights'}`}
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
                              {isDeparture ? ', your departure, selected' : ''}
                              {isReturn || isLeaveEnd ? ', your return' : ''}
                            </span>
                          </>
                        );

                        const cellClass = cn(
                          'flex min-h-14 flex-col items-stretch rounded-(--radius-control) border p-1.5 text-left md:min-h-16',
                          'ease-standard duration-quick transition-colors',
                          'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-1',
                          isDeparture || isReturn
                            ? 'border-accent-to bg-accent-to text-white'
                            : isLeaveEnd
                              ? 'border-accent-to text-ink border-2'
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
                            {...cellKeys(day)}
                            className={cellClass}
                          >
                            {body}
                          </button>
                        ) : (
                          <a
                            key={day}
                            role="gridcell"
                            href={option.href}
                            {...cellKeys(day)}
                            className={cellClass}
                          >
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
            Prices for {failedMonths.join(' and ')} could not be loaded just now. You can still pick
            a day; it searches those dates.
          </p>
        ) : null}

        {/* What the marks mean. Text, so colour is not the only thing saying it. */}
        <ul className="text-ink-muted flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          <li className="text-ink">Prices per person, for {party}</li>
          {phase === 'return' ? (
            <>
              <li>
                <span aria-hidden="true">✓ </span>Leaving: the day you leave, the filled cell
              </li>
              <li>Under each price: the nights away (3n is 3 nights)</li>
            </>
          ) : null}
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
          <li>
            <span aria-hidden="true">→ </span>One way from - no return fare seen for that day yet
          </li>
          <li>
            <span aria-hidden="true">&ndash; </span>No price yet - it is not cheap, and it cannot be
            chosen
          </li>
          <li>Arrow keys move by day, Page Up and Page Down by month</li>
        </ul>
      </div>
    </div>
  );
}

function CalendarLengthForm({ form }: { form: PriceCalendarLengthForm }) {
  const [mode, setMode] = React.useState<TripLengthMode>(() => tripLengthModeOf(form.tripLength));
  const [days, setDays] = React.useState(() => tripDaysOf(form.tripDays));
  const set = mode === 'under' || mode === 'over';

  return (
    <form
      method="get"
      action={form.action}
      aria-label="Trip length"
      className="flex flex-col gap-2"
    >
      {Object.entries(form.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {mode !== '' ? <input type="hidden" name="tripLength" value={mode} /> : null}
      {set ? <input type="hidden" name="tripDays" value={days} /> : null}
      <TripLengthChoice mode={mode} days={days} onModeChange={setMode} onDaysChange={setDays} />
      <button
        type="submit"
        className="border-hairline text-ink hover:border-border-strong focus-visible:outline-accent-to inline-flex min-h-11 items-center self-start rounded-(--radius-control) border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Apply trip length
      </button>
    </form>
  );
}
