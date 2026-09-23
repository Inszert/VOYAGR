import { Icon, type IconName } from '@/components/ui';
import { groupPlaces, type DestinationDetail } from '@/discovery/destination-detail';
import { shortDate } from '@/lib/display-date';
import type { Tint } from '@/lib/tint';
import {
  feelFor,
  summariseWeather,
  type WeatherFeel,
  type WeatherPeriod,
} from '@/discovery/weather-summary';

/**
 * What a destination is like: its weather, and what there is to do.
 *
 * Every figure is a provider's - the temperatures, the chance of rain, the
 * ratings, the distances. Nothing here scores or ranks a place, and anything a
 * provider did not state is left out rather than filled in.
 *
 * **Drawn, not listed.** Sixty days of weather was sixty lines of text, and
 * six kinds of place were six boxes of boxes. The weather is one chart a
 * person can read at a glance, with every day still in a table for anyone who
 * wants the numbers; the places are columns under a heading and a mark, with
 * rules between them rather than a border round each.
 */

export interface DestinationDetailViewProps {
  detail: DestinationDetail;
}

const PRICE_LEVEL = ['', 'Inexpensive', 'Moderate', 'Pricey', 'Expensive'] as const;

const CATEGORY_ICON: Record<string, IconName> = {
  beach: 'sun',
  attraction: 'map',
  restaurant: 'utensils',
  cafe: 'coffee',
  activity: 'sparkle',
  nightlife: 'star',
};

/**
 * Each kind of place in its own colour from the palette, so six columns read
 * as six different things at a glance. Decoration: every column is also
 * named, and every figure is still written out.
 */
const CATEGORY_TINT: Record<string, Tint> = {
  beach: 'sand',
  attraction: 'harbour',
  restaurant: 'clay',
  cafe: 'leather',
  activity: 'sage',
  nightlife: 'harbour',
};

const FEEL_WORD: Record<WeatherFeel, string> = {
  hot: 'Hot',
  warm: 'Warm',
  mild: 'Mild',
  cool: 'Cool',
  cold: 'Cold',
};

/** How warm, as colour - always beside the word and the figure, never alone. */
const FEEL_TEXT: Record<WeatherFeel, string> = {
  hot: 'text-temp-hot',
  warm: 'text-temp-warm',
  mild: 'text-temp-mild',
  cool: 'text-temp-cool',
  cold: 'text-temp-cold',
};

const FEEL_BG: Record<WeatherFeel, string> = {
  hot: 'bg-temp-hot',
  warm: 'bg-temp-warm',
  mild: 'bg-temp-mild',
  cool: 'bg-temp-cool',
  cold: 'bg-temp-cold',
};

/** Whether it rains, in words, from the share of days likely to be wet. */
function rainWord(period: WeatherPeriod): string {
  const share = period.rainyDays / period.days;
  if (share < 0.15) return 'mostly dry';
  if (share < 0.4) return 'some rain';
  return 'often wet';
}

function walkingMinutes(metres: number): number {
  // 80 metres a minute, which is an unhurried walk. Rounded up, because
  // rounding a walk down is how people miss things.
  return Math.max(1, Math.ceil(metres / 80));
}

export function DestinationDetailView({ detail }: DestinationDetailViewProps) {
  const sections = groupPlaces(detail.places);

  const warmest = detail.weather.reduce<number | null>(
    (highest, day) =>
      highest === null ? day.temperatureMaxC : Math.max(highest, day.temperatureMaxC),
    null,
  );
  const coolest = detail.weather.reduce<number | null>(
    (lowest, day) =>
      lowest === null ? day.temperatureMinC : Math.min(lowest, day.temperatureMinC),
    null,
  );

  const days = detail.weather;
  const summary = summariseWeather(days);
  // Every seventh day is labelled on the chart; the table has all of them.
  const labelEvery = days.length > 14 ? 7 : days.length > 7 ? 2 : 1;

  return (
    <>
      {/*
        The place is named by the stage header above this, which is where the
        page's one `h1` lives. Repeating it here would be two answers to
        "where am I?" on one page, and a second `h1` in the outline.
      */}
      {detail.unavailable.length > 0 ? (
        <div
          role="status"
          className="border-caution-500/30 bg-caution-500/10 rounded-(--radius-card) border p-4"
        >
          <p className="text-ink text-sm">
            Some of this page is missing: {detail.unavailable.join(', ')} did not answer. What is
            below is incomplete rather than complete.
          </p>
        </div>
      ) : null}

      {summary ? (
        <section aria-labelledby="weather-heading" className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h2 id="weather-heading" className="font-display text-display-sm text-ink">
              While you are there
            </h2>

            {/*
              The answer first, in words: how it feels and whether it rains.
              Then the typical day and night, then how sure any of it is.
            */}
            <p className="font-display text-ink text-2xl sm:text-3xl">
              <span className={FEEL_TEXT[summary.overall.feel]}>
                {FEEL_WORD[summary.overall.feel]}
              </span>
              , {rainWord(summary.overall)}.
            </p>
            <p className="text-ink-muted max-w-2xl">
              Around{' '}
              <span className={`${FEEL_TEXT[summary.overall.feel]} font-semibold`}>
                {summary.overall.highC}°C
              </span>{' '}
              by day and <span className="text-ink font-semibold">{summary.overall.lowC}°C</span> at
              night. Rain is likely on{' '}
              <span className="text-ink font-semibold">
                {summary.overall.rainyDays} of the {summary.overall.days}
              </span>{' '}
              days
              {summary.overall.seaC !== null ? (
                <>
                  , and the sea is around{' '}
                  <span className="text-ink font-semibold">{summary.overall.seaC}°C</span>
                </>
              ) : null}
              .
            </p>
            {/*
              Section 13: a long-range outlook is climatology and must not be
              dressed as a forecast. How much of this is which is said plainly.
            */}
            <p className="text-dim text-sm">
              {summary.forecastDays === 0
                ? 'These dates are too far ahead for a forecast, so this is the typical weather for the season, not a prediction.'
                : summary.forecastDays === summary.overall.days
                  ? 'A forecast for every day.'
                  : `The first ${summary.forecastDays} days are a forecast; after that it is the typical weather for the season.`}{' '}
              Days range from {Math.round(coolest!)}°C at the coldest to {Math.round(warmest!)}°C at
              the hottest.
            </p>
          </div>

          {/*
            Week by week, because the second half of October is not the first
            half of November. As many to a row as fit, wrapping rather than
            scrolling, so every week is on screen.
          */}
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
            {summary.weeks.map((week) => (
              <li
                key={week.startDate}
                className="border-border bg-surface-raised flex flex-col gap-1 rounded-(--radius-card) border p-3"
              >
                <span className="text-ink-muted text-xs tabular-nums">
                  {shortDate(week.startDate)} – {shortDate(week.endDate)}
                </span>
                <span className={`${FEEL_TEXT[week.feel]} text-3xl font-semibold tabular-nums`}>
                  {week.highC}°
                </span>
                <span className="text-ink-muted text-xs">
                  {FEEL_WORD[week.feel]} · night {week.lowC}°
                </span>
                <span className="text-ink mt-1 flex items-center gap-1.5 text-xs">
                  <Icon name="drop" size={0.9} className="text-temp-cool" />
                  {week.rainyDays === 0
                    ? 'No rainy days'
                    : `Rain likely ${week.rainyDays} of ${week.days} days`}
                </span>
              </li>
            ))}
          </ol>

          {/*
            Every day, drawn. Each bar runs from the night's low to the day's
            high on one shared scale, coloured by how warm the afternoon is;
            the dot under it is the chance of rain, darker for wetter. A
            picture of the table below, so hidden from assistive technology.
          */}
          <div aria-hidden="true" className="flex flex-col gap-2">
            <div className="relative flex h-40 items-stretch gap-[2px] pl-9">
              <span className="text-dim absolute top-0 left-0 text-[11px] tabular-nums">
                {Math.round(warmest!)}°
              </span>
              <span className="text-dim absolute bottom-0 left-0 text-[11px] tabular-nums">
                {Math.round(coolest!)}°
              </span>
              {days.map((day) => {
                const span = warmest! - coolest! || 1;
                const top = ((warmest! - day.temperatureMaxC) / span) * 100;
                const bottom = ((day.temperatureMinC - coolest!) / span) * 100;
                return (
                  <div key={day.date} className="relative min-w-0 flex-1">
                    <div
                      className={`${FEEL_BG[feelFor(day.temperatureMaxC)]} absolute inset-x-[15%] rounded-full`}
                      style={{ top: `${top}%`, bottom: `${bottom}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-[2px] pl-9">
              {days.map((day) => (
                <div key={day.date} className="flex min-w-0 flex-1 justify-center">
                  <span
                    className="bg-temp-cool block size-1.5 rounded-full"
                    style={{ opacity: 0.12 + day.precipitationProbability * 0.88 }}
                  />
                </div>
              ))}
            </div>
            <div className="text-dim flex gap-[2px] pl-9 text-[11px]">
              {days.map((day, index) => (
                <div key={day.date} className="relative min-w-0 flex-1">
                  {index % labelEvery === 0 ? (
                    <span className="absolute left-0 whitespace-nowrap tabular-nums">
                      {shortDate(day.date)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="text-dim mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              {(['cold', 'cool', 'mild', 'warm', 'hot'] as const).map((feel) => (
                <span key={feel} className="flex items-center gap-1.5">
                  <span className={`${FEEL_BG[feel]} inline-block h-3 w-1.5 rounded-full`} />
                  {FEEL_WORD[feel]}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="bg-temp-cool inline-block size-1.5 rounded-full" />
                Darker dot, likelier rain
              </span>
            </p>
          </div>

          <details className="group">
            <summary className="text-tint-ink w-fit cursor-pointer text-sm underline-offset-4 hover:underline">
              Every day, in numbers
            </summary>
            <div className="mt-3 max-h-80 overflow-y-auto">
              <table className="w-full text-sm tabular-nums">
                <caption className="sr-only">Daily outlook</caption>
                <thead className="text-dim text-left text-xs">
                  <tr>
                    <th scope="col" className="py-1.5 font-medium">
                      Day
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Low
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      High
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Chance of rain
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {days.map((day) => (
                    <tr key={day.date}>
                      <th scope="row" className="text-ink py-1.5 text-left font-normal">
                        {shortDate(day.date)}
                      </th>
                      <td className="text-ink-muted py-1.5">{Math.round(day.temperatureMinC)}°C</td>
                      <td className={`${FEEL_TEXT[feelFor(day.temperatureMaxC)]} py-1.5`}>
                        {Math.round(day.temperatureMaxC)}°C
                      </td>
                      <td className="text-ink-muted py-1.5">
                        {Math.round(day.precipitationProbability * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ) : null}

      {sections.length > 0 ? (
        <section aria-labelledby="places-heading" className="flex flex-col gap-6">
          <h2 id="places-heading" className="font-display text-display-sm text-ink">
            What is there
          </h2>

          <div className="grid gap-x-10 gap-y-10 md:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => (
              <section
                key={section.category}
                aria-labelledby={`places-${section.category}`}
                data-tint={CATEGORY_TINT[section.category] ?? 'leather'}
                className="border-tint/60 flex flex-col gap-3 border-t-2 pt-4"
              >
                <h3
                  id={`places-${section.category}`}
                  className="text-ink flex items-center gap-2.5 text-base font-semibold"
                >
                  <span
                    aria-hidden="true"
                    className="bg-tint/25 text-tint-ink grid size-9 place-items-center rounded-full"
                  >
                    <Icon name={CATEGORY_ICON[section.category] ?? 'pin'} size={1.1} />
                  </span>
                  {section.heading}
                </h3>

                <ul className="divide-border divide-y">
                  {section.places.map((place) => (
                    <li key={place.id} className="flex items-baseline justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-ink text-sm font-medium">{place.name}</p>
                        <p className="text-ink-muted mt-0.5 text-xs">
                          {/*
                            Unrated is not "nought out of five". Each fact
                            appears only when the provider actually supplied it.
                          */}
                          {place.distanceFromCentreMetres !== null
                            ? `${walkingMinutes(place.distanceFromCentreMetres)} min walk from the centre`
                            : 'Distance not stated'}
                          {place.priceLevel !== null ? (
                            <>
                              {' · '}
                              <span className="text-tint-ink">
                                {'€'.repeat(Math.max(1, place.priceLevel))}
                              </span>{' '}
                              {PRICE_LEVEL[place.priceLevel]}
                            </>
                          ) : null}
                        </p>
                      </div>
                      <p className="text-ink-muted shrink-0 text-right text-xs tabular-nums">
                        {place.rating !== null ? (
                          <>
                            <span className="text-ink inline-flex items-center gap-1 text-sm font-semibold">
                              <Icon
                                name="star"
                                size={0.85}
                                className="fill-tint-ink text-tint-ink"
                              />
                              {place.rating.toFixed(1)}
                            </span>
                            <br />
                            {place.ratingCount} reviews
                          </>
                        ) : (
                          'Not rated'
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
