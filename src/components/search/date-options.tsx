import { abs, format, subtract, toMajor, type Money } from '@/core/money';
import { startOfMonth } from '@/core/dates';
import { SourceStrip } from '@/components/ui';
import type { SourceAttribution } from '@/core/trip/provenance';
import { cn } from '@/lib/cn';
import { weekdayDate } from '@/lib/display-date';
import { FLEXIBILITY_LABELS, FLEXIBILITY_PRESETS } from '@/search/flexibility';
import {
  dateWindowKey,
  pickHighlights,
  type DateBreakdown,
  type DateOption,
} from '@/search/date-options';
import { PriceCalendar, type PriceCalendarChip, type PriceCalendarOption } from './price-calendar';

/**
 * Choosing the dates, and what they are worth (1.10.1 section 8).
 *
 * The calendar comes first: the thing to do here is pick a day, and the price
 * of every day is written in it, so which dates are cheaper is something to
 * look at rather than something to work out from a table. What the dates are
 * worth - the saving, how many combinations were priced, the best-value and
 * cheapest picks and each set of dates in full - sits underneath, for somebody
 * who wants to know why.
 *
 * Every figure comes from the search. Picking a date does not re-run it: the
 * link sets a filter over trips already priced, so the number on a day is the
 * number on the cards it reveals. The flexibility chips are the one thing here
 * that does search again, because widening the dates widens what is priced -
 * and they say so by being links, not by pretending to filter.
 */

export interface DateOptionsProps {
  breakdown: DateBreakdown;
  /** The current query, so a date link keeps the search it narrows. */
  searchValues: Readonly<Record<string, string | undefined>>;
  /** The currently selected window, as `2026-06-10..2026-06-15`. */
  selected: string | null;
  /** The page the results are on. */
  basePath?: string;
  /** Where each part of these prices came from, named under the calendar. */
  sources?: readonly SourceAttribution[];
}

function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The outlook as a range, and said to be climatology when that is what it is. */
function weatherLabel(option: DateOption): string | null {
  if (!option.weather) return null;

  const range = `${Math.round(option.weather.minC)}-${Math.round(option.weather.maxC)}°C`;

  return option.weather.confidence < 0.5 ? `${range}, typical` : range;
}

/** A total in whole units for a cell that has room for four or five characters. */
function whole(total: Money): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: total.currency,
    maximumFractionDigits: 0,
  }).format(toMajor(total));
}

/**
 * What a day costs against the cheapest day for the same departure.
 *
 * Kiwi calls this out explicitly once you have picked the day you leave:
 * every return date is a small "+€38" rather than a fresh total to compare by
 * eye. Null for whichever return is cheapest, since a delta of zero against
 * itself says nothing a reader needs.
 */
function deltaFromCheapest(total: Money, cheapest: Money): string | null {
  const delta = subtract(total, cheapest);
  if (delta.amount === 0) return null;
  return `${delta.amount > 0 ? '+' : '−'}${whole(abs(delta))}`;
}

/** The same search, with some keys replaced, and any date narrowing dropped. */
function linkWith(
  basePath: string,
  searchValues: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Record<string, string>>,
  dropDates = true,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (typeof value !== 'string' || value === '' || key in overrides) continue;
    if (dropDates && key === 'fDates') continue;
    params.set(key, value);
  }

  for (const [key, value] of Object.entries(overrides)) params.set(key, value);

  return `${basePath}?${params.toString()}`;
}

/** The same search, narrowed to one window - or widened back to all of them. */
function href(
  basePath: string,
  searchValues: Readonly<Record<string, string | undefined>>,
  window: string | null,
): string {
  return linkWith(basePath, searchValues, window ? { fDates: window } : {}, true);
}

export function DateOptions({
  breakdown,
  searchValues,
  selected,
  basePath = '/explore',
  sources = [],
}: DateOptionsProps) {
  // Always shown once anything was priced. One set of dates is not a choice
  // between dates, but the calendar and its flexibility chips are how somebody
  // with a narrow search widens it - hiding them is hiding the way out.
  if (breakdown.options.length === 0) return null;

  const highlights = pickHighlights(breakdown);
  const dearest = breakdown.dearest?.cheapestTotal ?? null;

  const priced = breakdown.options.filter(
    (option): option is DateOption & { cheapestTotal: Money } => option.cheapestTotal !== null,
  );

  /*
   * The cheapest return for each day someone could leave.
   *
   * Once a departure is chosen, every candidate return is read against this
   * rather than against the whole trip's own total - so "+€38" means "€38
   * more than the best return for the day you just picked", not an arbitrary
   * figure nobody asked for.
   */
  const cheapestByDeparture = new Map<string, Money>();
  for (const option of priced) {
    const current = cheapestByDeparture.get(option.window.departureDate);
    if (!current || option.cheapestTotal.amount < current.amount) {
      cheapestByDeparture.set(option.window.departureDate, option.cheapestTotal);
    }
  }

  const calendarOptions: PriceCalendarOption[] = priced.map((option) => {
    const key = dateWindowKey(option.window);
    const cheapestForDeparture = cheapestByDeparture.get(option.window.departureDate)!;

    return {
      key,
      departure: option.window.departureDate,
      returnDate: option.window.returnDate,
      nights: option.window.nights,
      exact: format(option.cheapestTotal),
      whole: whole(option.cheapestTotal),
      amount: toMajor(option.cheapestTotal),
      delta: deltaFromCheapest(option.cheapestTotal, cheapestForDeparture),
      href: href(basePath, searchValues, key),
    };
  });

  /*
   * The days the vendor has a flight on but no whole trip was built for.
   *
   * Shown apart from the trips - flights only, indicative, never in a saving -
   * and a link that searches those exact dates, so the hotel and the transfer
   * get priced and the day becomes a whole trip. Nothing here is a total.
   */
  const flightOnlyOptions: PriceCalendarOption[] = breakdown.flightOnly.map((flight) => ({
    kind: 'flight',
    key: `flight:${flight.departureDate}..${flight.returnDate}`,
    departure: flight.departureDate,
    returnDate: flight.returnDate,
    nights: flight.nights,
    exact: format(flight.price),
    whole: whole(flight.price),
    amount: toMajor(flight.price),
    delta: null,
    href: linkWith(basePath, searchValues, {
      flexibility: 'exact',
      departureDate: flight.departureDate,
      returnDate: flight.returnDate,
    }),
  }));

  /*
   * Every way of widening the dates, as the search already understands them.
   *
   * "Anytime that month" needs a month and a length, which the form has when
   * somebody chose it there; otherwise they are taken from the dates on
   * screen, so the chip means "this month, this many nights" rather than
   * nothing at all.
   */
  const first = breakdown.options[0]!.window;
  const current = searchValues.flexibility ?? 'plus-minus-3';

  const chips: PriceCalendarChip[] = [
    ...FLEXIBILITY_PRESETS.map((preset) => ({
      label: FLEXIBILITY_LABELS[preset],
      href: linkWith(
        basePath,
        searchValues,
        preset === 'month'
          ? {
              flexibility: preset,
              monthStart: searchValues.monthStart ?? startOfMonth(first.departureDate),
              tripNights: searchValues.tripNights ?? String(first.nights),
            }
          : { flexibility: preset },
      ),
      active: current === preset,
    })),
    {
      label: 'Exact window',
      href: linkWith(basePath, searchValues, { flexibility: 'custom' }),
      active: current === 'custom',
    },
  ];

  const cheapestKey = highlights.cheapest ? dateWindowKey(highlights.cheapest.window) : null;
  const bestValueKey = highlights.bestValue ? dateWindowKey(highlights.bestValue.window) : null;

  return (
    <section
      aria-labelledby="date-options-heading"
      className="border-tint/25 from-tint/[0.09] flex flex-col gap-6 rounded-(--radius-surface) border bg-gradient-to-b via-transparent to-transparent p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h2 id="date-options-heading" className="font-display text-ink text-2xl">
            Pick your dates
          </h2>
          <p className="text-ink-muted text-sm">
            Each day shows the whole trip - flights, hotel and transfer - for the cheapest trip we
            priced on it.
          </p>
        </div>

        {breakdown.saving && toMajor(breakdown.saving) > 0 ? (
          <p className="text-ink-muted text-sm">
            Cheapest dates save{' '}
            <strong className="font-display text-tint-ink text-2xl font-normal tabular-nums">
              {format(breakdown.saving)}
            </strong>
          </p>
        ) : null}
      </div>

      <PriceCalendar
        options={[...calendarOptions, ...flightOnlyOptions]}
        selected={selected}
        cheapestKey={cheapestKey}
        bestValueKey={bestValueKey}
        clearHref={selected ? href(basePath, searchValues, null) : null}
        chips={chips}
      />

      {/*
        Where the prices come from. Named here, on the calendar, because a
        figure written in a day is the one most easily read as a promise.
      */}
      <div className="border-tint/20 flex flex-col gap-2 border-t pt-4">
        <SourceStrip sources={sources} />
        <p className="text-dim text-xs">
          {breakdown.sampled
            ? `Priced ${breakdown.windowsPriced} of the ${breakdown.windowsAllowed} date combinations your dates allow, spread evenly across them - so some days have no price.`
            : `Priced every one of the ${breakdown.windowsAllowed} date combinations your dates allow.`}{' '}
          Prices are indicative and can have moved; none is a confirmed offer. Events, public
          holidays and live availability are not included.
        </p>
      </div>

      {/* The picks, in words, before the full list. */}
      <dl className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['Cheapest', highlights.cheapest],
            ['Best value', highlights.bestValue],
            ['Best weather', highlights.bestWeather],
          ] as const
        ).map(([name, option]) =>
          option ? (
            <div key={name} className="border-tint/20 rounded-(--radius-card) border p-3">
              <dt className="text-tint-ink text-[11px] font-semibold tracking-[0.1em] uppercase">
                {name}
              </dt>
              <dd className="mt-1 flex flex-col gap-0.5">
                <a
                  href={href(basePath, searchValues, dateWindowKey(option.window))}
                  className="text-ink text-sm font-medium underline-offset-4 hover:underline"
                >
                  {weekdayDate(option.window.departureDate)} &ndash;{' '}
                  {weekdayDate(option.window.returnDate)}
                </a>
                <span className="text-ink-muted text-xs">
                  {option.cheapestTotal ? format(option.cheapestTotal) : 'Nothing found'} ·{' '}
                  {option.window.nights} {option.window.nights === 1 ? 'night' : 'nights'}
                  {option.destinationName ? ` · ${option.destinationName}` : ''}
                  {option.travelMinutes !== null
                    ? ` · ${hoursAndMinutes(option.travelMinutes)} flying`
                    : ''}
                </span>
              </dd>
            </div>
          ) : null,
        )}
      </dl>

      {/*
        Every set of dates, as a list: the same figures as the calendar, with
        the length of the stay, the place, the weather and the flying time that
        a cell has no room for. Folded, because the calendar is the answer and
        this is the working.
      */}
      <details className="group border-tint/20 rounded-(--radius-card) border">
        <summary className="text-ink hover:bg-surface-sunken focus-visible:outline-brand-500 flex cursor-pointer list-none items-center justify-between gap-3 rounded-(--radius-card) px-4 py-3 text-sm font-medium focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
          Every date we priced ({breakdown.options.length})
          <span aria-hidden="true" className="text-dim transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>

        <ul className="divide-tint/15 flex flex-col divide-y px-4 pb-2">
          {breakdown.options.map((option) => {
            const key = dateWindowKey(option.window);
            const isSelected = selected === key;
            const weather = weatherLabel(option);

            // Bar length is the total against the dearest priced dates, so the
            // shortest bar is the cheapest. Only drawn when there is something
            // to compare against; a single price has no scale.
            const width =
              option.cheapestTotal && dearest && toMajor(dearest) > 0
                ? Math.max(6, Math.round((toMajor(option.cheapestTotal) / toMajor(dearest)) * 100))
                : null;

            const notable =
              option === highlights.cheapest
                ? 'Cheapest'
                : option === highlights.bestValue
                  ? 'Best value'
                  : option === highlights.bestWeather
                    ? 'Best weather'
                    : null;

            return (
              <li key={key}>
                <a
                  href={href(basePath, searchValues, isSelected ? null : key)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(
                    '-mx-2 block rounded-(--radius-control) px-2 py-2.5',
                    'ease-standard duration-quick transition-colors',
                    'focus-visible:outline-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2',
                    isSelected ? 'bg-tint/15' : 'hover:bg-surface-sunken',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-ink text-sm font-medium tabular-nums">
                      {weekdayDate(option.window.departureDate)} &ndash;{' '}
                      {weekdayDate(option.window.returnDate)}
                    </span>
                    <span
                      className={
                        option.cheapestTotal
                          ? 'font-display text-ink text-lg tabular-nums'
                          : 'text-ink-muted text-sm'
                      }
                    >
                      {/*
                        Nothing found is not a price of zero and not an empty
                        bar. Drawing it as either would invite the user to read
                        "we did not find a trip" as "these dates are cheap".
                      */}
                      {option.cheapestTotal ? format(option.cheapestTotal) : 'Nothing found'}
                    </span>
                  </span>

                  {width !== null ? (
                    <span
                      aria-hidden="true"
                      className="bg-surface-sunken mt-1.5 block h-1 overflow-hidden rounded-(--radius-pill)"
                    >
                      <span
                        className={cn(
                          'block h-full rounded-(--radius-pill)',
                          isSelected || option === highlights.cheapest ? 'bg-tint-ink' : 'bg-tint',
                        )}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                  ) : null}

                  <span className="text-ink-muted mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
                    <span>
                      {option.window.nights} {option.window.nights === 1 ? 'night' : 'nights'}
                    </span>
                    {option.destinationName ? <span>{option.destinationName}</span> : null}
                    {weather ? <span>{weather}</span> : null}
                    {option.travelMinutes !== null ? (
                      <span>{hoursAndMinutes(option.travelMinutes)} flying</span>
                    ) : null}
                    {notable ? (
                      <span className="border-tint/50 text-tint-ink rounded-(--radius-pill) border px-2 py-px text-[10px] font-semibold tracking-[0.1em] uppercase">
                        {notable}
                      </span>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
