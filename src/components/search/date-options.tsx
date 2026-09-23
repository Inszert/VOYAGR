import { format, toMajor } from '@/core/money';
import { cn } from '@/lib/cn';
import { weekdayDate } from '@/lib/display-date';
import {
  dateGrid,
  dateWindowKey,
  pickHighlights,
  type DateBreakdown,
  type DateOption,
} from '@/search/date-options';

/**
 * What the dates are worth (1.10.1 section 8).
 *
 * Section 37 asks whether flexible dates *visibly* save money. This is the
 * answer: one row per set of dates the search actually priced, the cheapest
 * total on each, and a bar whose length is that total relative to the dearest
 * - so the saving is something to point at rather than something to work out.
 *
 * Every figure comes from the search. Picking a date does not re-run it: the
 * link sets a filter over trips already priced, so the number on the row is
 * the number on the cards it reveals. Re-searching would show a different set
 * of trips from the one the user just clicked.
 *
 * **Rows, not boxes.** It sits in the results' side column now, beside the
 * trips it narrows, so it reads as an instrument rather than as a second list
 * of results: a line per window, a bar in the place's tint, and the three
 * notable windows named in words rather than wrapped in pills.
 */

export interface DateOptionsProps {
  breakdown: DateBreakdown;
  /** The current query, so a date link keeps the search it narrows. */
  searchValues: Readonly<Record<string, string | undefined>>;
  /** The currently selected window, as `2026-06-10..2026-06-15`. */
  selected: string | null;
  /** The page the results are on. */
  basePath?: string;
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

/** The same search, narrowed to one window - or widened back to all of them. */
function href(
  basePath: string,
  searchValues: Readonly<Record<string, string | undefined>>,
  window: string | null,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (typeof value === 'string' && value !== '' && key !== 'fDates') params.set(key, value);
  }

  if (window) params.set('fDates', window);

  return `${basePath}?${params.toString()}`;
}

export function DateOptions({
  breakdown,
  searchValues,
  selected,
  basePath = '/explore',
}: DateOptionsProps) {
  // One set of dates is not a choice, so there is nothing to show.
  if (breakdown.options.length < 2) return null;

  const highlights = pickHighlights(breakdown);
  const dearest = breakdown.dearest?.cheapestTotal ?? null;

  return (
    /*
      Framed, lit faintly in the place's tint from the top: an instrument
      worth consulting, not a list to scroll past. The saving is the headline,
      set in the display face, because it is the one figure here that answers
      "should I move my dates?".
    */
    <section
      aria-labelledby="date-options-heading"
      className="border-tint/25 from-tint/[0.09] flex flex-col gap-5 rounded-(--radius-surface) border bg-gradient-to-b via-transparent to-transparent p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="date-options-heading" className="font-display text-ink text-2xl">
          What the dates are worth
        </h2>
        {selected ? (
          <a
            href={href(basePath, searchValues, null)}
            className="text-tint-ink text-sm underline underline-offset-4"
          >
            Show every date
          </a>
        ) : null}
      </div>

      <div className="border-tint/20 flex flex-col gap-1.5 border-b pb-5">
        <p className="text-ink-muted text-sm">
          {breakdown.saving && toMajor(breakdown.saving) > 0 ? (
            <>
              Moving to the cheapest dates we priced saves
              <strong className="font-display text-tint-ink mt-1 block text-4xl font-normal tabular-nums">
                {format(breakdown.saving)}
              </strong>
            </>
          ) : (
            'Every set of dates we priced came out about the same.'
          )}
        </p>
        <p className="text-dim text-xs">
          {/*
          The sample is stated, not hidden. Eight rows drawn from a hundred and
          sixty-five possible windows is a useful answer; eight rows presented
          as the whole calendar is a chart lying about its own resolution.
        */}
          {breakdown.sampled
            ? `Priced ${breakdown.windowsPriced} of the ${breakdown.windowsAllowed} date combinations your dates allow, spread evenly across them.`
            : `Priced every one of the ${breakdown.windowsAllowed} date combinations your dates allow.`}
        </p>
      </div>

      <DateHeatmap
        breakdown={breakdown}
        selected={selected}
        hrefFor={(key) => href(basePath, searchValues, key)}
      />

      <ul className="divide-tint/15 flex flex-col divide-y">
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

      {/*
        What section 8 also asks for, and what this cannot yet answer. Saying
        so beats a control that silently matches everything: a person who reads
        "events" on a date picker and plans around it has been misled by an
        empty feature.
      */}
      <p className="text-dim text-xs">
        Events, public holidays and live availability are not in this comparison yet.
      </p>
    </section>
  );
}

/** Cheapest to dearest, as the tint growing fainter. Always beside the figure. */
const HEAT = ['bg-tint/50', 'bg-tint/35', 'bg-tint/22', 'bg-tint/12', 'bg-surface-sunken'] as const;

/**
 * Every priced window as a grid: departure day across, length of stay down.
 *
 * A table, because it is one - a screen reader gets the day and the length
 * for every cell. An empty cell is a window the search did not price, said as
 * a dash, never shaded as if it were cheap. Each price links to that window,
 * with its dates as the start of the link's name.
 */
function DateHeatmap({
  breakdown,
  selected,
  hrefFor,
}: {
  breakdown: DateBreakdown;
  selected: string | null;
  hrefFor: (key: string) => string;
}) {
  const grid = dateGrid(breakdown);
  if (grid.departures.length < 2) return null;

  const totals = breakdown.options.flatMap((option) =>
    option.cheapestTotal ? [toMajor(option.cheapestTotal)] : [],
  );
  const low = Math.min(...totals);
  const high = Math.max(...totals);

  const heat = (total: number) =>
    HEAT[
      high === low
        ? 0
        : Math.min(HEAT.length - 2, Math.floor(((total - low) / (high - low)) * (HEAT.length - 1)))
    ]!;

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-separate border-spacing-1 text-xs tabular-nums">
        <caption className="sr-only">Cheapest trip by departure day and length of stay</caption>
        <thead>
          <tr>
            <th scope="col" className="text-dim px-1 py-1 text-left font-medium">
              Nights
            </th>
            {grid.departures.map((departure) => (
              <th
                key={departure}
                scope="col"
                className="text-dim px-1 py-1 font-medium whitespace-nowrap"
              >
                {weekdayDate(departure)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.nights.map((stay, row) => (
            <tr key={stay}>
              <th scope="row" className="text-ink-muted px-1 py-1 text-left font-medium">
                {stay}
              </th>
              {grid.cells[row]!.map((option, column) => {
                if (!option || !option.cheapestTotal) {
                  return (
                    <td
                      key={column}
                      className="text-dim rounded-(--radius-control) px-2 py-2.5 text-center"
                    >
                      <span aria-hidden="true">-</span>
                      <span className="sr-only">Not priced</span>
                    </td>
                  );
                }
                const key = dateWindowKey(option.window);
                const isSelected = selected === key;
                return (
                  <td key={column} className="p-0">
                    <a
                      href={hrefFor(isSelected ? '' : key)}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'text-ink block rounded-(--radius-control) px-2 py-2.5 text-center whitespace-nowrap',
                        'ease-standard duration-quick hover:ring-tint-ink/60 transition-shadow hover:ring-1',
                        'focus-visible:outline-brand-500 focus-visible:outline-2 focus-visible:outline-offset-1',
                        heat(toMajor(option.cheapestTotal)),
                        isSelected && 'ring-tint-ink ring-2',
                        option === breakdown.cheapest && 'font-semibold',
                      )}
                    >
                      <span className="sr-only">
                        {weekdayDate(option.window.departureDate)} &ndash;{' '}
                        {weekdayDate(option.window.returnDate)},{' '}
                      </span>
                      {format(option.cheapestTotal)}
                    </a>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
