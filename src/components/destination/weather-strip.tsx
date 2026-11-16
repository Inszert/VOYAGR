'use client';

import * as React from 'react';
import { Icon, type IconName } from '@/components/ui';
import { dayOfWeek } from '@/core/dates';
import type { WeatherOutlook } from '@/core/trip/types';
import { shortDate } from '@/lib/display-date';
import { cn } from '@/lib/cn';
import { feelFor, type WeatherFeel } from '@/discovery/weather-summary';

/**
 * The days, seven to a row: weekday, a glyph, the high and the low joined by a
 * short vertical bar on one shared scale, and how likely rain is as a row of
 * three drops.
 *
 * A picture of the table beneath it, with more: hover or focus on a day and the
 * line under the strip says it in words, with whether it is a forecast or the
 * climate average ("Typical for these dates"), because those are different
 * claims. Every day is a button so the line is reachable without a mouse, and
 * past seven days the strip pages by week.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const PER_ROW = 7;
const BAR_HEIGHT = 72;

const FEEL_BG: Record<WeatherFeel, string> = {
  hot: 'bg-temp-hot',
  warm: 'bg-temp-warm',
  mild: 'bg-temp-mild',
  cool: 'bg-temp-cool',
  cold: 'bg-temp-cold',
};

function glyphFor(day: WeatherOutlook): { icon: IconName; word: string } {
  if (day.temperatureMaxC <= 0) return { icon: 'snow', word: 'cold and possibly snowy' };
  if (day.precipitationProbability >= 0.5) return { icon: 'rain', word: 'rain likely' };
  if (day.precipitationProbability >= 0.25) return { icon: 'cloud', word: 'some chance of rain' };

  return { icon: 'sun', word: 'mostly dry' };
}

/** How many of three drops to fill: presentation of the provider's chance, not a new figure. */
function drops(probability: number): number {
  return Math.min(3, Math.round(probability * 3));
}

export function WeatherStrip({
  days,
  typicalLabel,
}: {
  days: readonly WeatherOutlook[];
  typicalLabel: string;
}) {
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState(days[0]?.date ?? '');
  const pages = Math.ceil(days.length / PER_ROW);
  const row = days.slice(page * PER_ROW, page * PER_ROW + PER_ROW);

  // One scale for every day of the trip, so two rows can be compared.
  const warmest = Math.max(...days.map((day) => day.temperatureMaxC));
  const coolest = Math.min(...days.map((day) => day.temperatureMinC));
  const span = warmest - coolest || 1;

  const day = days.find((entry) => entry.date === selected) ?? days[0]!;
  const glyph = glyphFor(day);

  const turn = (to: number) => {
    setPage(to);
    setSelected(days[to * PER_ROW]?.date ?? selected);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Daily outlook, one column per day"
        style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))` }}
        className="border-border bg-surface-raised grid gap-0.5 rounded-(--radius-card) border p-2 sm:gap-1 sm:p-3"
      >
        {row.map((entry) => {
          const current = entry.date === selected;
          const symbol = glyphFor(entry);
          const top = ((warmest - entry.temperatureMaxC) / span) * BAR_HEIGHT;
          const height = Math.max(
            6,
            ((entry.temperatureMaxC - entry.temperatureMinC) / span) * BAR_HEIGHT,
          );
          const feel = feelFor(entry.temperatureMaxC);

          return (
            <button
              key={entry.date}
              type="button"
              aria-pressed={current}
              aria-label={`${WEEKDAYS[dayOfWeek(entry.date)]} ${shortDate(entry.date)}: high ${Math.round(entry.temperatureMaxC)}°, low ${Math.round(entry.temperatureMinC)}°, ${symbol.word}`}
              onMouseEnter={() => setSelected(entry.date)}
              onFocus={() => setSelected(entry.date)}
              onClick={() => setSelected(entry.date)}
              className={cn(
                'ease-standard duration-quick flex min-h-11 min-w-0 flex-col items-center gap-1.5 rounded-(--radius-control) px-0.5 py-2 transition-colors',
                current ? 'bg-surface-sunken' : 'hover:bg-surface-sunken/60',
              )}
            >
              <span
                className={cn(
                  'text-[11px] font-medium tabular-nums',
                  current ? 'text-ink' : 'text-ink-muted',
                )}
              >
                {WEEKDAYS[dayOfWeek(entry.date)]}
              </span>
              <Icon name={symbol.icon} size={1.2} className="text-ink-muted" aria-hidden="true" />
              <span className="text-ink text-sm font-semibold tabular-nums">
                {Math.round(entry.temperatureMaxC)}°
              </span>
              <span
                aria-hidden="true"
                className="relative block w-1.5"
                style={{ height: BAR_HEIGHT }}
              >
                <span className="bg-border absolute inset-0 rounded-full" />
                <span
                  className={cn('absolute inset-x-0 rounded-full', FEEL_BG[feel])}
                  style={{ top, height }}
                />
              </span>
              <span className="text-ink-muted text-sm tabular-nums">
                {Math.round(entry.temperatureMinC)}°
              </span>
              <span aria-hidden="true" className="flex gap-0.5">
                {[0, 1, 2].map((slot) => (
                  <Icon
                    key={slot}
                    name="drop"
                    size={0.75}
                    className={
                      slot < drops(entry.precipitationProbability)
                        ? 'text-temp-cool'
                        : 'text-border-strong'
                    }
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <p role="status" className="text-ink-muted min-h-10 text-sm tabular-nums">
        <span className="text-ink font-medium">
          {WEEKDAYS[dayOfWeek(day.date)]} {shortDate(day.date)}
        </span>
        : {Math.round(day.temperatureMaxC)}°C by day, {Math.round(day.temperatureMinC)}°C at night,{' '}
        {glyph.word} ({Math.round(day.precipitationProbability * 100)}% chance of rain).{' '}
        {day.basis === 'forecast' ? 'Forecast.' : `${typicalLabel}.`}
      </p>

      {pages > 1 ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => turn(page - 1)}
            className="border-border text-ink hover:bg-surface-sunken inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="chevron-left" size={0.95} aria-hidden="true" />
            Earlier days
          </button>
          <span className="text-dim text-xs tabular-nums">
            Week {page + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => turn(page + 1)}
            className="border-border text-ink hover:bg-surface-sunken inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            Later days
            <Icon name="chevron-right" size={0.95} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
