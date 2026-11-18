import type { TripCarry } from '@/search/stays/trip-stays';
import { Icon } from '@/components/ui';

/**
 * The flight chosen on the trip, shown above the stay search it came from.
 * Words only, no price; the link goes back to the trip with its flights.
 */
export function TripFlightCard({ carry }: { carry: TripCarry }) {
  return (
    <section
      aria-labelledby="trip-flight-heading"
      className="border-border bg-surface-raised flex flex-wrap items-start justify-between gap-3 rounded-(--radius-card) border p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          id="trip-flight-heading"
          className="text-dim text-[11px] font-semibold tracking-[0.16em] uppercase"
        >
          Your flight
        </h2>
        <p className="text-ink text-sm tabular-nums">{carry.flightOut}</p>
        {carry.flightBack ? (
          <p className="text-ink-muted text-sm tabular-nums">{carry.flightBack}</p>
        ) : null}
      </div>
      <a
        href={carry.tripHref}
        className="text-tint-ink inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
      >
        <Icon name="chevron-left" size={0.95} aria-hidden="true" />
        Back to your flights
      </a>
    </section>
  );
}
