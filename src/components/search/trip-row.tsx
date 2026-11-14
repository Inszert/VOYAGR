import { abs, format } from '@/core/money';
import { localHour, minutesIntoLocalDay } from '@/core/dates';
import { Icon, Media, ProvenanceBadge } from '@/components/ui';
import type { DataProvenance } from '@/core/trip/provenance';
import { connectionCount } from '@/core/trip/legs';
import type { FlightLeg } from '@/core/trip/types';
import { cn } from '@/lib/cn';
import { shortDate } from '@/lib/display-date';
import { tintFor } from '@/lib/tint';
import { imageryUrlFor } from '@/providers/imagery/url';
import type { DestinationImage } from '@/providers/imagery/types';
import type { RankedTrip } from '@/search/types';
import type { DealAgainstTypical } from '@/search/deal-score';
import { DealNote } from './deal-note';

/**
 * One trip, as a line in the list.
 *
 * The trip being built gets the whole card; every other result gets this. A
 * page of twenty full cards was twenty thousand pixels of the same object,
 * and the thing somebody scanning a list compares - where, when, how, how
 * much - fits on one row. Everything else about the trip is one click away,
 * in the builder, where it is also something they can change.
 *
 * **Nothing that should worry them is folded away.** What ruled a near miss
 * out, and the warnings on a trip that qualified, are on the row itself: a
 * warning somebody has to go looking for is not a warning.
 *
 * Every figure is the engine's: the total, the fare, the headroom.
 */

export interface TripRowProps {
  readonly trip: RankedTrip;
  /** Zero-based position among the results, or -1 for a near miss. */
  readonly rank: number;
  readonly view?: 'trip' | 'flight';
  readonly provenance?: DataProvenance;
  readonly image?: DestinationImage | null;
  /** Opens this trip in the builder. */
  readonly buildHref: string;
  /** How this trip compares with the typical one to the same place. */
  readonly deal?: DealAgainstTypical | null;
}

function clock(value: string): string {
  const minutes = minutesIntoLocalDay(value);
  return `${String(localHour(value)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "09:17 → 13:08, direct". The provider's clock faces and its stops. */
function legSummary(leg: FlightLeg): string | null {
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];
  if (!first || !last) return null;

  const stops = connectionCount(leg);
  return `${clock(first.departsAt)} → ${clock(last.arrivesAt)}, ${
    stops === 0 ? 'direct' : `${stops} stop${stops === 1 ? '' : 's'}`
  }`;
}

export function TripRow({
  trip,
  rank,
  view = 'trip',
  provenance = 'unavailable',
  image = null,
  buildHref,
  deal = null,
}: TripRowProps) {
  const { candidate, cost, eligibility, warnings, score } = trip;
  const headingId = `row-${candidate.id}-heading`;
  const nearMiss = rank < 0;
  const out = legSummary(candidate.flight.outbound);
  const back = legSummary(candidate.flight.inbound);

  return (
    <article
      aria-labelledby={headingId}
      data-tint={tintFor(candidate.destination)}
      className="group border-border hover:bg-surface-raised ease-standard duration-quick relative grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-b py-4 transition-colors sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:px-3"
    >
      <Media
        seed={candidate.destination}
        image={image ? { url: imageryUrlFor(candidate.destination), alt: '' } : null}
        zoomOnHover
        className="row-span-2 h-full min-h-[5.5rem] rounded-(--radius-control) sm:row-span-1"
      />

      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={headingId} className="font-display text-ink text-xl leading-tight">
          <a
            href={buildHref}
            // The whole row is the target; there is one stop in the tab order.
            className="focus-visible:outline-accent-to after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {candidate.destinationName}
          </a>{' '}
          <span className="text-ink-muted font-sans text-sm font-normal">
            from {candidate.origin}
          </span>
        </h3>
        <p className="text-ink-muted text-sm tabular-nums">
          {shortDate(candidate.dates.departureDate)} to {shortDate(candidate.dates.returnDate)} ·{' '}
          {candidate.dates.nights} nights · score {score.score}
        </p>
        <p className="text-ink-muted flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums">
          {out ? (
            <span className="flex items-center gap-1.5">
              <Icon name="plane" size={0.95} className="text-tint-ink" />
              Out {out}
            </span>
          ) : null}
          {back ? <span>Back {back}</span> : null}
          <span className="flex items-center gap-1.5">
            <Icon name="bed" size={0.95} className="text-tint-ink" />
            {candidate.hotel.name}
          </span>
        </p>

        {nearMiss && eligibility.violations.length > 0 ? (
          <ul className="text-critical-ink mt-1 flex flex-col gap-0.5 text-xs">
            {eligibility.violations.map((violation) => (
              <li key={violation.code}>{violation.message}</li>
            ))}
          </ul>
        ) : warnings.length > 0 ? (
          <ul className="text-caution-ink mt-1 flex flex-col gap-0.5 text-xs">
            {warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="col-start-2 flex flex-wrap items-end justify-between gap-2 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:justify-start">
        <div className="text-right">
          <p className="text-ink flex items-center justify-end gap-2 text-xl font-semibold tabular-nums">
            {format(view === 'flight' ? candidate.flight.price : cost.total)}
          </p>
          <p className="text-ink-muted text-xs tabular-nums">
            {view === 'flight'
              ? `flights · whole trip ${format(cost.total)}`
              : `total · ${format(cost.perPerson)} each`}
          </p>
          <p
            className={cn(
              'text-xs font-medium tabular-nums',
              eligibility.budgetHeadroom.amount >= 0 ? 'text-positive-ink' : 'text-critical-ink',
            )}
          >
            {eligibility.budgetHeadroom.amount >= 0
              ? `${format(eligibility.budgetHeadroom)} under your maximum`
              : `${format(abs(eligibility.budgetHeadroom))} over your maximum`}
          </p>
          <DealNote deal={deal} />
        </div>
        <div className="flex items-center gap-3">
          <ProvenanceBadge provenance={provenance} explain={false} />
          <span
            aria-hidden="true"
            className="text-tint-ink flex items-center gap-1 text-sm font-medium"
          >
            Build this
            <Icon
              name="arrow-right"
              size={0.9}
              className="ease-standard duration-quick transition-transform group-hover:translate-x-0.5"
            />
          </span>
        </div>
      </div>
    </article>
  );
}
