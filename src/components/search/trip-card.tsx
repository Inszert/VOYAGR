import { format } from '@/core/money';
import { Badge, Card, Disclosure, ProvenanceBadge } from '@/components/ui';
import { buildFlightHandoff, buildHotelHandoff, OUTBOUND_LINK_REL } from '@/booking/handoff';
import type { RankedTrip } from '@/search/types';
import type { Alternative } from '@/search/alternatives';
import type { DataProvenance } from '@/core/trip/provenance';
import { summariseReasons, type TripReason } from '@/search/explain';
import { CostBreakdown } from './cost-breakdown';
import { ScoreExplanation } from './score-explanation';
import { SwapPanel } from './swap-panel';
import { WarningList } from './warning-list';

/**
 * One trip in the results list.
 *
 * The card answers, in order: what is it, what does it cost, how good is it,
 * and what should worry you. The last of those is above the fold rather than
 * inside the disclosure, because a warning the user has to go looking for is
 * not a warning.
 *
 * Every figure comes from the engine. Every outbound link comes from
 * `@/booking/handoff` - never assembled here.
 */

const RANK_LABEL = ['Best match', 'Runner-up', 'Third'] as const;

function nightsLabel(nights: number) {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

function hoursLabel(minutes: number) {
  return `${Math.round(minutes / 60)} hours`;
}

/** Stops on the busier leg: what a traveller means by "one stop". */
function stopsLabel(candidate: RankedTrip['candidate']): string {
  const stops = Math.max(
    candidate.flight.outbound.segments.length - 1,
    candidate.flight.inbound.segments.length - 1,
  );

  if (stops === 0) return 'direct';
  return `${stops} stop${stops === 1 ? '' : 's'}`;
}

/**
 * The outlook in one phrase.
 *
 * Averaged across the trip's days and stated as a range, because a single
 * number would imply a precision the forecast does not have - and days far
 * enough out are climatology rather than a forecast at all.
 */
function weatherLabel(candidate: RankedTrip['candidate']): string {
  if (candidate.weather.length === 0) return 'Not available';

  const highs = candidate.weather.map((day) => day.temperatureMaxC);
  const low = Math.round(Math.min(...highs));
  const high = Math.round(Math.max(...highs));

  const confident = candidate.weather.every((day) => day.confidence >= 0.5);
  const range = low === high ? `${low}°C` : `${low}–${high}°C`;

  return confident ? range : `${range}, typical for the season`;
}

export interface TripCardProps {
  trip: RankedTrip;
  /** Zero-based position in the results list. */
  rank: number;
  /** Where this trip's prices came from. */
  provenance?: DataProvenance;
  /** Why this trip is being shown, in human terms. */
  reasons?: readonly TripReason[];
  /**
   * Other flights and hotels this search saw, each already evaluated as a whole
   * trip. Omitted for a card that is not the one being examined, because
   * evaluating alternatives for forty results would be work nobody asked for.
   */
  flightAlternatives?: readonly Alternative[];
  hotelAlternatives?: readonly Alternative[];
}

export function TripCard({
  trip,
  rank,
  provenance = 'unavailable',
  reasons = [],
  flightAlternatives = [],
  hotelAlternatives = [],
}: TripCardProps) {
  const { candidate, cost, score, warnings, usableTime, eligibility } = trip;
  const headingId = `trip-${candidate.id}-heading`;
  const warningsId = `trip-${candidate.id}-warnings`;
  const scoreId = `trip-${candidate.id}-score`;

  const flightLink = buildFlightHandoff(candidate.flight, { candidateId: candidate.id });
  const hotelLink = buildHotelHandoff(candidate.hotel, { candidateId: candidate.id });
  const rankLabel = RANK_LABEL[rank];

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      // The top result sits above the rest, because it is the answer and the
      // others are the alternatives to it.
      elevation={rank === 0 ? 'floating' : 'raised'}
      feature={rank === 0}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id={headingId}
            className={
              rank === 0
                ? 'text-ink font-display text-display-sm'
                : 'text-ink text-lg font-semibold'
            }
          >
            {candidate.destinationName} from {candidate.origin}
          </h3>
          <p className="text-ink-muted text-sm">
            {candidate.dates.departureDate} to {candidate.dates.returnDate} ·{' '}
            {nightsLabel(candidate.dates.nights)} · {candidate.passengers}{' '}
            {candidate.passengers === 1 ? 'traveller' : 'travellers'}
          </p>
        </div>

        <div className="text-right">
          {/* Beside the number, never in a footnote. */}
          <p className="text-ink flex items-center justify-end gap-2 text-xl font-semibold tabular-nums">
            {format(cost.total)}
            <ProvenanceBadge provenance={provenance} explain={false} />
          </p>
          <p className="text-ink-muted text-sm tabular-nums">
            {format(cost.perPerson)} each · {format(cost.perNight)} a night
          </p>
        </div>
      </div>

      <dl className="border-border grid grid-cols-2 gap-x-6 gap-y-2 border-y py-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Flights</dt>
          <dd className="text-ink tabular-nums">
            {format(candidate.flight.price)}
            <span className="text-ink-muted"> · {stopsLabel(candidate)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Hotel</dt>
          <dd className="text-ink tabular-nums">
            {format(candidate.hotel.totalPrice)}
            <span className="text-ink-muted"> · {candidate.dates.nights} nights</span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Airport transfer</dt>
          <dd className="text-ink tabular-nums">
            {candidate.transfer ? (
              `${format(candidate.transfer.pricePerDirection)} each way`
            ) : (
              // Never a zero. An unpriced transfer is a cost we could not get,
              // not a cost that does not exist.
              <span className="text-caution-ink">Not priced</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Weather</dt>
          <dd className="text-ink">{weatherLabel(candidate)}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {rankLabel ? (
          <Badge tone="brand" srPrefix="Ranking">
            {rankLabel}
          </Badge>
        ) : null}
        <Badge tone="neutral" srPrefix="Trip score">
          Score {score.score} of 100
        </Badge>
        <Badge tone="neutral" srPrefix="Usable holiday time">
          {hoursLabel(usableTime.totalMinutes)} at the destination
        </Badge>
        <Badge tone={eligibility.budgetHeadroom.amount >= 0 ? 'positive' : 'critical'}>
          {eligibility.budgetHeadroom.amount >= 0
            ? `${format(eligibility.budgetHeadroom)} under your maximum`
            : `${format(eligibility.budgetHeadroom)} over your maximum`}
        </Badge>
      </div>

      {/*
        Section 9: explain the ranking in human terms and do not expose
        meaningless technical scoring. Every figure in this sentence comes from
        the engines; the factor breakdown is still there, one disclosure down,
        for anyone who wants it.
      */}
      <div>
        <h4 id={scoreId} className="text-ink text-sm font-medium">
          Why this trip?
        </h4>
        <p className="text-ink mt-1">{summariseReasons(reasons)}</p>
      </div>

      {eligibility.violations.length > 0 ? (
        <div className="border-critical-500/30 bg-critical-500/10 rounded-[--radius-control] border p-3">
          <h4 className="text-critical-ink text-sm font-medium">Outside what you asked for</h4>
          <ul className="mt-1 flex flex-col gap-1">
            {eligibility.violations.map((violation) => (
              <li key={violation.code} className="text-ink text-sm">
                {violation.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h4 id={warningsId} className="text-ink text-sm font-medium">
          Before you book
        </h4>
        <div className="mt-2">
          <WarningList warnings={warnings} headingId={warningsId} />
        </div>
      </div>

      <Disclosure summary="Full cost breakdown">
        <CostBreakdown
          cost={cost}
          passengers={candidate.passengers}
          nights={candidate.dates.nights}
        />
      </Disclosure>

      <Disclosure summary={`How the score of ${score.score} was calculated`}>
        <ScoreExplanation score={score} headingId={scoreId} />
      </Disclosure>

      <SwapPanel
        heading="Change the flight"
        alternatives={flightAlternatives}
        currency={cost.total.currency}
      />

      <SwapPanel
        heading="Change the hotel"
        alternatives={hotelAlternatives}
        currency={cost.total.currency}
      />

      <Disclosure summary="Flight and hotel details">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink font-medium">Flights</dt>
            <dd className="text-ink-muted">
              {candidate.flight.outbound.segments
                .map((segment) => `${segment.origin}→${segment.destination}`)
                .join(' · ')}{' '}
              out, {candidate.flight.outbound.durationMinutes} min.
              <br />
              {candidate.flight.inbound.segments
                .map((segment) => `${segment.origin}→${segment.destination}`)
                .join(' · ')}{' '}
              back, {candidate.flight.inbound.durationMinutes} min.
            </dd>
          </div>
          <div>
            <dt className="text-ink font-medium">Hotel</dt>
            <dd className="text-ink-muted">
              {candidate.hotel.name}
              {candidate.hotel.starRating === null ? '' : `, ${candidate.hotel.starRating} star`}
              {candidate.hotel.reviewScore === null
                ? ''
                : `, guests rate it ${candidate.hotel.reviewScore} from ${candidate.hotel.reviewCount} reviews`}
              .
            </dd>
          </div>
        </dl>
      </Disclosure>

      {flightLink || hotelLink ? (
        <div className="border-border flex flex-wrap gap-3 border-t pt-4">
          {flightLink ? (
            <a
              href={flightLink.url}
              rel={OUTBOUND_LINK_REL}
              target="_blank"
              className="text-brand-ink text-sm underline underline-offset-4"
            >
              Book the flight with {flightLink.providerId}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          {hotelLink ? (
            <a
              href={hotelLink.url}
              rel={OUTBOUND_LINK_REL}
              target="_blank"
              className="text-brand-ink text-sm underline underline-offset-4"
            >
              Book the hotel with {hotelLink.providerId}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-ink-muted border-border border-t pt-4 text-sm">
          This provider did not supply a booking link for these offers.
        </p>
      )}
    </Card>
  );
}
