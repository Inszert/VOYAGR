import { format, toMajor } from '@/core/money';
import { Card, CardTitle, Tag } from '@/components/ui';
import { dayName } from '@/search/flexibility';
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
 */

export interface DateOptionsProps {
  breakdown: DateBreakdown;
  /** The current query, so a date link keeps the search it narrows. */
  searchValues: Readonly<Record<string, string | undefined>>;
  /** The currently selected window, as `2026-06-10..2026-06-15`. */
  selected: string | null;
}

/** e.g. "Sat 6 Jun". Deliberately not locale-aware: en-GB, like `format`. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);

  return `${dayName(iso).slice(0, 3)} ${date.getUTCDate()} ${date.toLocaleString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  })}`;
}

function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Weather in words.
 *
 * Below half confidence the outlook is climatology rather than a forecast, and
 * says so. Section 13 is explicit that a long-range outlook must not be
 * presented as a forecast, and dates six weeks out are exactly where a
 * flexible-date search spends its time.
 */
function weatherLabel(option: DateOption): string | null {
  if (!option.weather) return null;

  const range = `${Math.round(option.weather.minC)}-${Math.round(option.weather.maxC)}°C`;

  return option.weather.confidence < 0.5 ? `${range}, typical for the season` : range;
}

function href(
  searchValues: Readonly<Record<string, string | undefined>>,
  window: string | null,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (typeof value === 'string' && value !== '' && key !== 'fDates') params.set(key, value);
  }

  if (window) params.set('fDates', window);

  return `/?${params.toString()}`;
}

export function DateOptions({ breakdown, searchValues, selected }: DateOptionsProps) {
  // One set of dates is not a choice, so there is nothing to show.
  if (breakdown.options.length < 2) return null;

  const highlights = pickHighlights(breakdown);
  const dearest = breakdown.dearest?.cheapestTotal ?? null;

  return (
    <Card as="section" aria-labelledby="date-options-heading" elevation="raised">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle id="date-options-heading" level={2}>
          What the dates are worth
        </CardTitle>
        {selected ? (
          <a
            href={href(searchValues, null)}
            className="text-brand-ink text-sm underline underline-offset-4"
          >
            Show every date
          </a>
        ) : null}
      </div>

      <p className="text-ink-muted mt-1 text-sm">
        {breakdown.saving && toMajor(breakdown.saving) > 0 ? (
          <>
            Moving to the cheapest dates we priced saves{' '}
            <strong className="text-ink font-semibold">{format(breakdown.saving)}</strong>.
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

      <ul className="mt-4 flex flex-col gap-2">
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

          return (
            <li key={key}>
              <a
                href={href(searchValues, isSelected ? null : key)}
                aria-current={isSelected ? 'true' : undefined}
                className={[
                  'border-border bg-surface-raised block rounded-[--radius-card] border p-3',
                  'ease-standard duration-quick transition-colors',
                  'hover:bg-surface-sunken',
                  'focus-visible:outline-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2',
                  isSelected ? 'border-brand-500 bg-brand-500/5' : '',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-ink text-sm font-medium">
                    {shortDate(option.window.departureDate)} &ndash;{' '}
                    {shortDate(option.window.returnDate)}
                    <span className="text-ink-muted font-normal">
                      {' '}
                      · {option.window.nights} {option.window.nights === 1 ? 'night' : 'nights'}
                    </span>
                  </span>
                  <span className="text-ink text-sm font-semibold tabular-nums">
                    {/*
                      Nothing found is not a price of zero and not an empty
                      bar. Drawing it as either would invite the user to read
                      "we did not find a trip" as "these dates are cheap".
                    */}
                    {option.cheapestTotal ? format(option.cheapestTotal) : 'Nothing found'}
                  </span>
                </div>

                {width !== null ? (
                  <div
                    className="bg-surface-sunken mt-2 h-1.5 overflow-hidden rounded-[--radius-pill]"
                    aria-hidden="true"
                  >
                    <div
                      className="bg-brand-500 h-full rounded-[--radius-pill]"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {option.destinationName ? (
                    <span className="text-ink-muted">{option.destinationName}</span>
                  ) : null}
                  {weather ? <span className="text-ink-muted">{weather}</span> : null}
                  {option.travelMinutes !== null ? (
                    <span className="text-ink-muted">
                      {hoursAndMinutes(option.travelMinutes)} flying
                    </span>
                  ) : null}
                  {option === highlights.cheapest ? <Tag tone="brand">Cheapest</Tag> : null}
                  {option === highlights.bestValue && option !== highlights.cheapest ? (
                    <Tag tone="accent">Best value</Tag>
                  ) : null}
                  {option === highlights.bestWeather && option !== highlights.cheapest ? (
                    <Tag>Best weather</Tag>
                  ) : null}
                </div>
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
      <p className="text-ink-muted mt-4 text-sm">
        Events, public holidays and live availability are not in this comparison yet - no data
        source behind it carries them.
      </p>
    </Card>
  );
}
