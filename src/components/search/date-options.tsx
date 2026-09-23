import { format, toMajor } from '@/core/money';
import { cn } from '@/lib/cn';
import { weekdayDate } from '@/lib/display-date';
import {
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
    <section aria-labelledby="date-options-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="date-options-heading" className="font-display text-ink text-xl">
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

      <p className="text-ink-muted text-sm">
        {breakdown.saving && toMajor(breakdown.saving) > 0 ? (
          <>
            Moving to the cheapest dates we priced saves{' '}
            <strong className="text-tint-ink font-semibold">{format(breakdown.saving)}</strong>.
          </>
        ) : (
          'Every set of dates we priced came out about the same.'
        )}{' '}
        {/*
          The sample is stated, not hidden. Eight rows drawn from a hundred and
          sixty-five possible windows is a useful answer; eight rows presented
          as the whole calendar is a chart lying about its own resolution.
        */}
        {breakdown.sampled
          ? `Priced ${breakdown.windowsPriced} of the ${breakdown.windowsAllowed} date combinations your dates allow, spread evenly across them.`
          : `Priced every one of the ${breakdown.windowsAllowed} date combinations your dates allow.`}
      </p>

      <ul className="divide-border border-border flex flex-col divide-y border-y">
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
                  <span className="text-ink text-sm font-semibold tabular-nums">
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
                  {notable ? <span className="text-tint-ink font-semibold">{notable}</span> : null}
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
