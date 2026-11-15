import { abs, format } from '@/core/money';
import { Collapsible, Icon } from '@/components/ui';
import { DestinationPicture } from './destination-picture';
import { clock, duration } from './route-line';
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
 * **Nothing that should worry them is hidden.** What ruled a near miss out is
 * written on the row. The warnings on a trip that qualified sit behind one line
 * that says how many there are ("2 things to check"), so the count is always in
 * view even when the sentences are not.
 *
 * Every figure is the engine's: the total, the fare, the headroom.
 */

export interface TripRowProps {
  readonly trip: RankedTrip;
  /** Zero-based position among the results, or -1 for a near miss. */
  readonly rank: number;
  readonly view?: 'trip' | 'flight';
  /** The country in full, so the row says "Malta", not "MT". */
  readonly country?: string | null;
  readonly image?: DestinationImage | null;
  /** Opens this trip in the builder. */
  readonly buildHref: string;
  /** How this trip compares with the typical one to the same place. */
  readonly deal?: DealAgainstTypical | null;
}

/** "09:17 → 13:08 · 2h 51m · direct". The provider's clock faces, duration and stops. */
function legSummary(leg: FlightLeg): string | null {
  const first = leg.segments[0];
  const last = leg.segments[leg.segments.length - 1];
  if (!first || !last) return null;

  const stops = connectionCount(leg);
  return `${clock(first.departsAt)} → ${clock(last.arrivesAt)} · ${duration(leg.durationMinutes)} · ${
    stops === 0 ? 'direct' : `${stops} stop${stops === 1 ? '' : 's'}`
  }`;
}

export function TripRow({
  trip,
  rank,
  view = 'trip',
  country = null,
  image = null,
  buildHref,
  deal = null,
}: TripRowProps) {
  const { candidate, cost, eligibility, warnings } = trip;
  const headingId = `row-${candidate.id}-heading`;
  const nearMiss = rank < 0;
  const out = legSummary(candidate.flight.outbound);
  const back = legSummary(candidate.flight.inbound);
  const under = eligibility.budgetHeadroom.amount >= 0;

  return (
    <article
      aria-labelledby={headingId}
      data-tint={tintFor(candidate.destination)}
      className="voyagr-card group border-border bg-surface-raised hover:border-border-strong ease-standard duration-quick relative flex h-full gap-3 rounded-(--radius-card) border p-3 transition-colors sm:gap-4 sm:p-4"
    >
      <DestinationPicture
        code={candidate.destination}
        providerUrl={image ? imageryUrlFor(candidate.destination) : null}
        alt={`Illustration of ${candidate.destinationName}`}
        sizes="(min-width: 640px) 132px, 72px"
        className="voyagr-card-frame aspect-[3/2] w-[72px] shrink-0 self-start rounded-(--radius-card) sm:w-[132px]"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-col gap-1">
            <h3
              id={headingId}
              className="font-display text-ink flex flex-wrap items-baseline gap-x-2 text-[1.125rem] leading-tight"
            >
              <a
                href={buildHref}
                // The whole row is the target; there is one stop in the tab order.
                className="focus-visible:outline-accent-to after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {candidate.destinationName}
              </a>
              {country ? (
                <span className="text-ink-muted font-sans text-sm font-normal">{country}</span>
              ) : null}
            </h3>
            <p className="text-ink-muted text-sm tabular-nums">
              <span className="whitespace-nowrap">
                {shortDate(candidate.dates.departureDate)} to{' '}
                {shortDate(candidate.dates.returnDate)}
              </span>{' '}
              <span className="whitespace-nowrap">· {candidate.dates.nights} nights</span>
            </p>
          </div>
          <div className="text-ink-muted flex min-w-0 flex-col gap-0.5 text-xs tabular-nums sm:col-span-2 sm:row-start-2">
            {out ? (
              <p className="flex items-center gap-1.5">
                <Icon name="plane" size={0.95} className="text-tint-ink shrink-0" />
                <span>
                  <span className="sr-only">Outbound </span>
                  <span aria-hidden="true">Out </span>
                  {out}
                </span>
              </p>
            ) : null}
            {back ? (
              <p className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block w-[0.95rem] shrink-0" />
                <span>
                  <span className="sr-only">Return </span>
                  <span aria-hidden="true">Back </span>
                  {back}
                </span>
              </p>
            ) : null}
            <p className="flex items-center gap-1.5">
              <Icon name="bed" size={0.95} className="text-tint-ink shrink-0" />
              <span className="truncate">{candidate.hotel?.name ?? 'Stay not included'}</span>
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5 self-end text-right sm:col-start-2 sm:row-start-1 sm:max-w-[13rem] sm:self-start">
            <p className="text-ink-muted text-xs">from</p>
            <p className="text-ink text-[1.25rem] leading-tight font-semibold tabular-nums">
              {format(view === 'flight' ? candidate.flight.price : cost.total)}
            </p>
            <p className="text-ink-muted text-xs tabular-nums">
              {view === 'flight'
                ? `flights · whole trip ${format(cost.total)}`
                : `total · ${format(cost.perPerson)} per traveller`}
            </p>
            <p
              className={cn(
                'text-xs font-medium tabular-nums',
                under ? 'text-positive-ink' : 'text-critical-ink',
              )}
            >
              {under
                ? `${format(eligibility.budgetHeadroom)} under your maximum`
                : `${format(abs(eligibility.budgetHeadroom))} over your maximum`}
            </p>
            <DealNote deal={deal} />
          </div>
        </div>

        {nearMiss && eligibility.violations.length > 0 ? (
          <ul className="text-critical-ink flex flex-col gap-0.5 text-xs">
            {eligibility.violations.map((violation) => (
              <li key={violation.code}>{violation.message}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-x-4">
          {!nearMiss && warnings.length > 0 ? (
            <Collapsible
              summary={`${warnings.length} ${warnings.length === 1 ? 'thing' : 'things'} to check`}
              className="mr-auto min-w-0"
            >
              <ul className="text-ink-muted flex flex-col gap-1 text-xs">
                {warnings.map((warning) => (
                  <li key={warning.code}>{warning.message}</li>
                ))}
              </ul>
            </Collapsible>
          ) : (
            <span />
          )}
          <span
            aria-hidden="true"
            className="text-tint-ink ml-auto flex min-h-11 items-center gap-1 text-sm font-medium"
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
