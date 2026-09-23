import { useId } from 'react';
import { daysBetween, localDate, localHour, minutesIntoLocalDay } from '@/core/dates';
import type { FlightLeg } from '@/core/trip/types';
import { cn } from '@/lib/cn';
import { weekdayDate } from '@/lib/display-date';

/**
 * One leg of a flight, drawn as the line it is.
 *
 * The globe draws a route as an arc from the origin to the destination; a
 * result card draws the same journey flattened, with the stops on it. That is
 * what makes the results read as a continuation of the map rather than as a
 * different product underneath it.
 *
 * Read in the order somebody comparing flights reads one: which leg and which
 * day, then when it leaves and lands, then how long and how many stops, then
 * who flies it and what bags come with it. The clock times are the largest
 * type because they are the thing that differs most between two results.
 *
 * **Every figure is the provider's.** The clock times are the segments' own
 * wall-clock times, read with `localHour` and `minutesIntoLocalDay` rather
 * than through `Date` - a local departure time is a clock face, not an
 * instant, and parsing one into a `Date` reintroduces exactly the timezone
 * drift those helpers exist to avoid. The duration is `durationMinutes` from
 * the leg, never the difference between two local times, which would be wrong
 * by the offset between two airports.
 */

export interface RouteLineProps {
  leg: FlightLeg;
  /** "Outbound" or "Return": shown above the leg, and the name of its group. */
  label: string;
  className?: string;
}

/** e.g. "06:10". A local time is a clock face, so it is read as one. */
function clock(value: string): string {
  const minutes = minutesIntoLocalDay(value);
  const hours = localHour(value);

  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * What the provider said about one bag.
 *
 * Three answers, not two. `null` is the provider saying nothing, and writing
 * that as "not included" would be a claim we have no grounds for.
 */
function bagLabel(bag: string, included: boolean | null): string {
  if (included === null) return `${bag} not stated`;
  return included ? `${bag} included` : `No ${bag.toLowerCase()}`;
}

export function RouteLine({ leg, label, className }: RouteLineProps) {
  const labelId = useId();
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];

  if (!first || !last) return null;

  const stops = leg.segments.length - 1;
  const connections = leg.segments.slice(0, -1).map((segment) => segment.destination);
  const carriers = [...new Set(leg.segments.map((segment) => segment.carrier))];

  // Calendar days between the two local dates - the "+1" on a red-eye. Both
  // are the provider's own dates, compared with `daysBetween`, never a `Date`.
  const departureDay = localDate(first.departsAt);
  const dayShift = daysBetween(departureDay, localDate(last.arrivesAt));

  return (
    <div role="group" aria-labelledby={labelId} className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-baseline gap-2 text-xs">
          <span id={labelId} className="text-ink font-medium">
            {label}
          </span>
          <span className="text-ink-muted">{weekdayDate(departureDay)}</span>
        </p>

        {/*
          The airline, as its code. The data carries no names and no logos, so
          the mark is the IATA code set small, not a picture of an airline we
          would be guessing at. The flight numbers beside it say the same thing
          in words, so the mark itself is hidden from assistive technology.
        */}
        <p className="text-ink-muted flex min-w-0 items-center gap-2 text-xs">
          <span aria-hidden="true" className="flex gap-1">
            {carriers.map((carrier) => (
              <span
                key={carrier}
                className="border-border-strong bg-surface-sunken text-ink inline-grid h-5 min-w-7 place-items-center rounded-sm border px-1 text-[10px] font-semibold tracking-wide"
              >
                {carrier}
              </span>
            ))}
          </span>
          <span className="truncate tabular-nums">
            {leg.segments.map((segment) => segment.flightNumber).join(', ')}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] items-start gap-x-3 sm:gap-x-4">
        <div>
          <p className="text-ink text-lg leading-none font-semibold tabular-nums">
            <span>{clock(first.departsAt)}</span>
          </p>
          <p className="text-ink-muted mt-1.5 text-xs font-medium tracking-wide">{first.origin}</p>
        </div>

        <div className="flex flex-col items-center gap-1.5 pt-2">
          {/*
            The line itself is decoration - the times, the airports and the
            stops are all in text around it - so it is hidden from assistive
            technology rather than described.
          */}
          <div aria-hidden="true" className="relative h-2 w-full">
            <div className="bg-border-strong absolute inset-x-0 top-1/2 h-px" />
            <div className="border-brand-ink bg-surface-raised absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full border" />
            <div className="bg-brand-ink absolute top-1/2 right-0 size-2 -translate-y-1/2 rounded-full" />
            {connections.map((code, index) => (
              <div
                key={`${code}-${index}`}
                className="bg-surface-raised border-ink-muted absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                style={{ left: `${((index + 1) / (connections.length + 1)) * 100}%` }}
              />
            ))}
          </div>
          <p className="text-ink-muted text-center text-xs text-balance">
            {duration(leg.durationMinutes)}
            {' · '}
            {stops === 0
              ? 'direct'
              : `${stops} stop${stops === 1 ? '' : 's'} in ${connections.join(', ')}`}
          </p>
        </div>

        <div className="text-right">
          <p className="text-ink text-lg leading-none font-semibold tabular-nums">
            <span>{clock(last.arrivesAt)}</span>
            {dayShift > 0 ? (
              <sup className="text-caution-ink ml-0.5 text-[10px] font-semibold">
                +{dayShift}
                <span className="sr-only"> {dayShift === 1 ? 'day' : 'days'} later</span>
              </sup>
            ) : null}
          </p>
          <p className="text-ink-muted mt-1.5 text-xs font-medium tracking-wide">
            {last.destination}
          </p>
        </div>
      </div>

      <ul className="text-ink-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li>{bagLabel('Cabin bag', leg.cabinBaggageIncluded)}</li>
        <li>{bagLabel('Checked bag', leg.checkedBaggageIncluded)}</li>
      </ul>
    </div>
  );
}
