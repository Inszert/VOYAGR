import { daysBetween, localDate } from '@/core/dates';
import { connectionCount } from '@/core/trip/legs';
import type { FlightLeg } from '@/core/trip/types';
import { weekdayDate } from '@/lib/display-date';
import { clock, duration } from './route-line';

/**
 * The two flights as two lines: when each leaves and lands, how long, how many
 * stops - in words. The full journey, baggage included, is one disclosure down.
 *
 * Every figure is the provider's own, read the way `RouteLine` reads it: clock
 * faces through `clock`, the duration from the leg and never from subtracting
 * two local times.
 */

function Row({ label, leg }: { label: string; leg: FlightLeg }) {
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];
  if (!first || !last) return null;

  const stops = connectionCount(leg);
  const day = localDate(first.departsAt);
  const shift = daysBetween(day, localDate(last.arrivesAt));

  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 py-2.5 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto]">
      <span className="text-ink-muted text-xs font-medium tracking-wide uppercase">{label}</span>
      <span className="text-ink text-sm font-medium tabular-nums">
        {clock(first.departsAt)} {first.origin}
        <span aria-hidden="true" className="text-dim mx-1.5">
          →
        </span>
        <span className="sr-only"> to </span>
        {clock(last.arrivesAt)} {last.destination}
        {shift > 0 ? (
          <span className="text-caution-ink ml-1 text-xs">
            +{shift}
            <span className="sr-only"> {shift === 1 ? 'day' : 'days'} later</span>
          </span>
        ) : null}
      </span>
      <span className="text-ink-muted col-start-2 text-xs tabular-nums sm:col-start-3">
        {weekdayDate(day)} · {duration(leg.durationMinutes)} ·{' '}
        {stops === 0 ? 'direct' : `${stops} ${stops === 1 ? 'stop' : 'stops'}`}
      </span>
    </li>
  );
}

export function ItineraryRows({
  outbound,
  inbound,
  className,
}: {
  outbound: FlightLeg;
  inbound: FlightLeg;
  className?: string;
}) {
  return (
    <ul
      aria-label="Flights"
      className={`divide-border border-border divide-y border-y ${className ?? ''}`}
    >
      <Row label="Out" leg={outbound} />
      <Row label="Back" leg={inbound} />
    </ul>
  );
}
