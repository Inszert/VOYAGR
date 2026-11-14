'use client';

import * as React from 'react';
import { Slider } from 'radix-ui';
import { cn } from '@/lib/cn';

/**
 * A time-of-day range, as two handles on one track.
 *
 * Built for "when does this flight leave": a start and an end hour, a name for
 * which flight it is, and the part of the day in words, because "06:00 -
 * 14:00" is a range and "morning" is what somebody means by it.
 *
 * **Still a plain form.** It writes two hidden inputs, so the filters form
 * submits as a GET with or without JavaScript running and the narrowed view is
 * a URL. A handle at its end of the track writes nothing - an empty value is
 * "no limit", which is what the filter reads it as, and a range that is the
 * whole day is not a filter that should appear in the address bar.
 *
 * Hours, not minutes: the filters compare whole local hours, so a finer
 * control would promise a precision the filter does not have.
 */

export interface TimeRangeFieldProps {
  /** What is being chosen: "Outbound flight". */
  label: string;
  /** Where that flight leaves from, so the two ranges cannot be confused. */
  place: string;
  /** Names of the two inputs this submits: the earliest and the latest hour. */
  nameFrom: string;
  nameTo: string;
  defaultFrom?: number | null;
  defaultTo?: number | null;
}

const DAY_START = 0;
const DAY_END = 24;

/** Parts of the day, as the hours they cover. Night is the small hours. */
const PARTS = [
  { label: 'Night', from: 0, to: 5 },
  { label: 'Morning', from: 5, to: 12 },
  { label: 'Afternoon', from: 12, to: 18 },
  { label: 'Evening', from: 18, to: 24 },
] as const;

/** The presets people reach for, so the common answer is one tap. */
const PRESETS = [
  { label: 'Any time', from: DAY_START, to: DAY_END },
  { label: 'Morning only', from: 5, to: 12 },
  { label: 'Afternoon only', from: 12, to: 18 },
  { label: 'Evening only', from: 18, to: DAY_END },
] as const;

function clock(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function TimeRangeField({
  label,
  place,
  nameFrom,
  nameTo,
  defaultFrom = null,
  defaultTo = null,
}: TimeRangeFieldProps) {
  const id = React.useId();
  const labelId = `${id}-label`;

  const [range, setRange] = React.useState<[number, number]>([
    defaultFrom ?? DAY_START,
    defaultTo ?? DAY_END,
  ]);
  const [from, to] = range;

  const wholeDay = from === DAY_START && to === DAY_END;

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p id={labelId} className="text-ink text-sm font-medium">
          {label}
          <span className="text-ink-muted font-normal"> · leaves {place}</span>
        </p>

        {/* The same figures the handles carry, so `aria-hidden` rather than read twice. */}
        <output
          aria-hidden="true"
          className={cn(
            'text-sm font-semibold tabular-nums',
            wholeDay ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {wholeDay ? 'Any time' : `${clock(from)} – ${clock(to)}`}
        </output>
      </div>

      {/* The values this field submits. Empty at an end of the track: no limit. */}
      <input type="hidden" name={nameFrom} value={from > DAY_START ? String(from) : ''} />
      <input type="hidden" name={nameTo} value={to < DAY_END ? String(to) : ''} />

      <Slider.Root
        value={range}
        onValueChange={(next) => {
          const [low, high] = next;
          if (low !== undefined && high !== undefined) setRange([low, high]);
        }}
        min={DAY_START}
        max={DAY_END}
        step={1}
        minStepsBetweenThumbs={1}
        className="relative flex h-8 w-full touch-none items-center select-none"
      >
        <Slider.Track className="bg-surface-raised border-border-strong relative h-2 w-full grow overflow-hidden rounded-full border">
          <Slider.Range className="absolute h-full bg-[linear-gradient(90deg,var(--color-accent-from),var(--color-accent-to))]" />
        </Slider.Track>

        {(['Earliest', 'Latest'] as const).map((which, index) => (
          <Slider.Thumb
            key={which}
            aria-label={`${which} departure, ${label.toLowerCase()}`}
            aria-valuetext={clock(index === 0 ? from : to)}
            className={cn(
              // 28px to hold, a 16px dot to look at: a thumb is a finger's target.
              'border-accent-to bg-text block size-5 rounded-full border-2 shadow-sm',
              'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
              'motion-safe:transition-transform motion-safe:hover:scale-110',
            )}
          />
        ))}
      </Slider.Root>

      {/*
        The day in words, under the track and drawn to its scale: each part is
        as wide as the hours it covers, and the ones the range touches are the
        ones in full ink. Decoration for sighted readers - the figures above and
        the handles' values carry the same range - so it is `aria-hidden`.
      */}
      <div aria-hidden="true" className="flex w-full text-[11px]">
        {PARTS.map((part) => {
          const touched = from < part.to && to > part.from;

          return (
            <span
              key={part.label}
              style={{ width: `${((part.to - part.from) / (DAY_END - DAY_START)) * 100}%` }}
              className={cn('truncate text-center', touched ? 'text-ink font-medium' : 'text-dim')}
            >
              {part.label}
            </span>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => {
          const active = from === preset.from && to === preset.to;

          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={active}
              onClick={() => setRange([preset.from, preset.to])}
              className={cn(
                'rounded-(--radius-pill) border px-3 py-1.5 text-xs font-medium',
                'ease-standard duration-quick transition-colors',
                'focus-visible:outline-accent-to focus-visible:outline-2 focus-visible:outline-offset-2',
                active
                  ? 'border-accent-to bg-accent-to/15 text-ink'
                  : 'border-hairline text-ink-muted hover:border-border-strong hover:text-ink',
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
