import { Icon } from '@/components/ui';
import { shortDate } from '@/lib/display-date';
import type { WeatherOutlook } from '@/core/trip/types';
import {
  feelFor,
  summariseWeather,
  TYPICAL_LABEL,
  type WeatherFeel,
  type WeatherPeriod,
} from '@/discovery/weather-summary';

/**
 * "While you are there": the outlook for the trip's dates.
 *
 * Every figure is the weather provider's. The headline says how it feels and
 * whether it rains, the weeks follow, then the days drawn, then every day in a
 * table - with its **Basis** column, because a forecast and a climate average
 * are different claims and the table is where a reader checks which is which.
 * A long-range outlook is never dressed as a forecast.
 */

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

function rainWord(period: WeatherPeriod): string {
  const share = period.rainyDays / period.days;
  if (share < 0.15) return 'mostly dry';
  if (share < 0.4) return 'some rain';
  return 'often wet';
}

export function WeatherSection({ days }: { days: readonly WeatherOutlook[] }) {
  const summary = summariseWeather(days);
  if (!summary) return null;

  const warmest = Math.max(...days.map((day) => day.temperatureMaxC));
  const coolest = Math.min(...days.map((day) => day.temperatureMinC));
  const span = warmest - coolest || 1;
  // Every seventh day is labelled on the chart; the table has all of them.
  const labelEvery = days.length > 14 ? 7 : days.length > 7 ? 2 : 1;

  return (
    <section aria-labelledby="weather-heading" className="voyagr-reveal flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 id="weather-heading" className="font-display text-display-sm text-ink">
          While you are there
        </h2>
        <p className="font-display text-ink text-2xl sm:text-3xl">
          <span className={FEEL_TEXT[summary.overall.feel]}>{FEEL_WORD[summary.overall.feel]}</span>
          , {rainWord(summary.overall)}.
        </p>
        <p className="text-ink-muted max-w-2xl">
          Around{' '}
          <span className={`${FEEL_TEXT[summary.overall.feel]} font-semibold tabular-nums`}>
            {summary.overall.highC}°C
          </span>{' '}
          by day and{' '}
          <span className="text-ink font-semibold tabular-nums">{summary.overall.lowC}°C</span> at
          night. Rain is likely on{' '}
          <span className="text-ink font-semibold tabular-nums">
            {summary.overall.rainyDays} of the {summary.overall.days}
          </span>{' '}
          days
          {summary.overall.seaC !== null ? (
            <>
              , and the sea is around{' '}
              <span className="text-ink font-semibold tabular-nums">{summary.overall.seaC}°C</span>
            </>
          ) : null}
          .
        </p>
        <p className="text-ink-muted text-sm">
          {summary.forecastDays === 0
            ? `${TYPICAL_LABEL}. These dates are too far ahead for a forecast, so this is the climate average, not a prediction.`
            : summary.forecastDays === summary.overall.days
              ? 'A forecast for every day.'
              : `The first ${summary.forecastDays} days are a forecast. After that: ${TYPICAL_LABEL.toLowerCase()}, which is the climate average and not a prediction.`}{' '}
          Days range from {Math.round(coolest)}°C at the coldest to {Math.round(warmest)}°C at the
          hottest.
        </p>
      </div>

      <ol className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
        {summary.weeks.map((week) => (
          <li
            key={week.startDate}
            className="border-border bg-surface-raised flex flex-col gap-1 rounded-(--radius-card) border p-4"
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
              <Icon name="drop" size={0.9} className="text-temp-cool" aria-hidden="true" />
              {week.rainyDays === 0
                ? 'No rainy days'
                : `Rain likely ${week.rainyDays} of ${week.days} days`}
            </span>
          </li>
        ))}
      </ol>

      {/*
        Every day, drawn: each bar runs from the night's low to the day's high
        on one shared scale; the dot under it is the chance of rain. A picture
        of the table below, so hidden from assistive technology.
      */}
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="relative flex h-36 items-stretch gap-[2px] pl-9">
          <span className="text-dim absolute top-0 left-0 text-[11px] tabular-nums">
            {Math.round(warmest)}°
          </span>
          <span className="text-dim absolute bottom-0 left-0 text-[11px] tabular-nums">
            {Math.round(coolest)}°
          </span>
          {days.map((day) => {
            const top = ((warmest - day.temperatureMaxC) / span) * 100;
            const bottom = ((day.temperatureMinC - coolest) / span) * 100;
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

      <details className="border-border group rounded-(--radius-card) border">
        <summary className="text-ink hover:bg-surface-sunken flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-(--radius-card) px-4 text-sm font-medium select-none">
          Every day, in numbers
          <span
            aria-hidden="true"
            className="text-ink-muted transition-transform group-open:rotate-90"
          >
            &rsaquo;
          </span>
        </summary>
        <div className="border-border max-h-96 overflow-auto border-t">
          <table className="w-full min-w-[30rem] text-sm tabular-nums">
            <caption className="sr-only">Daily outlook</caption>
            <thead className="bg-surface-raised text-ink-muted sticky top-0 text-left text-xs">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Day
                </th>
                <th scope="col" className="py-2.5 font-medium">
                  Low
                </th>
                <th scope="col" className="py-2.5 font-medium">
                  High
                </th>
                <th scope="col" className="py-2.5 font-medium">
                  Chance of rain
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Basis
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row" className="text-ink px-4 py-2 text-left font-normal">
                    {shortDate(day.date)}
                  </th>
                  <td className="text-ink-muted py-2">{Math.round(day.temperatureMinC)}°C</td>
                  <td className={`${FEEL_TEXT[feelFor(day.temperatureMaxC)]} py-2`}>
                    {Math.round(day.temperatureMaxC)}°C
                  </td>
                  <td className="text-ink-muted py-2">
                    {Math.round(day.precipitationProbability * 100)}%
                  </td>
                  <td className="text-ink-muted px-4 py-2">
                    {day.basis === 'forecast' ? 'Forecast' : TYPICAL_LABEL}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
