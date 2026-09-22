import { localHour, minutesIntoLocalDay } from '@/core/dates';
import type { FlightLeg } from '@/core/trip/types';

/**
 * One leg of a flight, drawn as the line it is.
 *
 * The globe draws a route as an arc from the origin to the destination; a
 * result card draws the same journey flattened, with the stops on it. That is
 * what makes the results read as a continuation of the map rather than as a
 * different product underneath it.
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
  /** "Out" or "Back", so a screen reader knows which leg it is hearing. */
  label: string;
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

export function RouteLine({ leg, label }: RouteLineProps) {
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];

  if (!first || !last) return null;

  const stops = leg.segments.length - 1;
  const connections = leg.segments.slice(0, -1).map((segment) => segment.destination);

  return (
    // Wrapping, so the duration drops to its own line on a phone rather than
    // squeezing the line itself down to a stub.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-14">
        <p className="text-ink text-sm font-semibold tabular-nums">{clock(first.departsAt)}</p>
        <p className="text-ink-muted text-xs">{first.origin}</p>
      </div>

      {/*
        The line itself is decoration - the times, the airports and the stops
        are all in text either side of it - so it is hidden from assistive
        technology rather than described.
      */}
      <div aria-hidden="true" className="relative min-w-12 flex-1 pt-1">
        <div className="bg-border-strong h-px w-full" />
        <div className="bg-brand-600 absolute top-1 left-0 size-2 -translate-y-1/2 rounded-full" />
        <div className="bg-brand-600 absolute top-1 right-0 size-2 -translate-y-1/2 rounded-full" />
        {connections.map((code, index) => (
          <div
            key={`${code}-${index}`}
            className="bg-surface-raised border-border-strong absolute top-1 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{ left: `${((index + 1) / (connections.length + 1)) * 100}%` }}
          />
        ))}
      </div>

      <div className="min-w-14 text-right">
        <p className="text-ink text-sm font-semibold tabular-nums">{clock(last.arrivesAt)}</p>
        <p className="text-ink-muted text-xs">{last.destination}</p>
      </div>

      <p className="text-ink-muted w-full text-xs sm:w-auto sm:min-w-28 sm:text-right">
        <span className="sr-only">{label}: </span>
        {duration(leg.durationMinutes)}
        {' · '}
        {stops === 0
          ? 'direct'
          : `${stops} stop${stops === 1 ? '' : 's'} in ${connections.join(', ')}`}
      </p>
    </div>
  );
}
