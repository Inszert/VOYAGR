import { format } from '@/core/money';
import { Badge, Card, Disclosure, Icon, ProvenanceBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import { buildFlightHandoff, buildHotelHandoff, OUTBOUND_LINK_REL } from '@/booking/handoff';
import type { RankedTrip } from '@/search/types';
import type { Alternative } from '@/search/alternatives';
import type { DataProvenance } from '@/core/trip/provenance';
import { summariseReasons, type TripReason } from '@/search/explain';
import { RouteLine } from './route-line';
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

/**
 * A disclosure inside the grouped panel.
 *
 * The panel owns the border and the rules between rows, so each row drops its
 * own border and its corner radius; a rounded box inside a rounded box with a
 * rule between them is three edges where one was wanted.
 */
const ROW = 'rounded-none border-0';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * e.g. "6 Jun". Read off the ISO string rather than through `Date`.
 *
 * A calendar date is a date, and parsing one into a `Date` to format it is
 * how a trip that leaves on the sixth starts showing the fifth for anyone
 * west of Greenwich. A fixed month table also keeps the wording identical
 * whichever machine rendered the page.
 */
function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

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
  /**
   * The destination's photograph, when one was found.
   *
   * Optional, and absent everywhere the card is rendered without a page having
   * resolved imagery first. The header is built to look deliberate without it.
   */
  image?: DestinationImage | null;
}

/**
 * The wash under the header's photograph.
 *
 * Hue from the destination's own code, the same derivation the discovery cards
 * use, so one place keeps one colour wherever it appears - and so a card whose
 * photograph never arrived still looks like that place's card.
 */
function washFor(code: string): React.CSSProperties {
  const hue = [...code].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return {
    backgroundImage: `linear-gradient(140deg, oklch(0.5 0.13 ${hue}) 0%, oklch(0.26 0.09 ${(hue + 40) % 360}) 100%)`,
  };
}

export function TripCard({
  trip,
  rank,
  provenance = 'unavailable',
  reasons = [],
  flightAlternatives = [],
  hotelAlternatives = [],
  image = null,
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
      {/*
        The header carries the picture.

        Full-bleed out of the card's own padding, in the stage's palette, so
        this reads as the same product as the globe it was opened from rather
        than as a report about it. `stage-scope` is what makes that safe: every
        semantic token inside resolves to its dark value, so the green on
        "under your maximum" is the one meant for a dark surface whichever
        scheme the rest of the page is in.

        The wash is painted whether or not a photograph arrives, and the scrim
        sits over both, so the type has its own darkness under it either way.
      */}
      <header
        className={cn(
          'stage-scope relative isolate flex flex-col justify-end overflow-hidden',
          rank === 0
            ? '-mx-7 -mt-7 min-h-[13rem] rounded-t-[--radius-surface] p-7'
            : '-mx-5 -mt-5 min-h-[11rem] rounded-t-[--radius-card] p-5',
        )}
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          <div className="absolute inset-0" style={washFor(candidate.destination)} />
          {image ? (
            <img
              src={imageryUrlFor(candidate.destination)}
              alt=""
              width={image.width}
              height={image.height}
              loading={rank === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/25" />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            {rankLabel ? (
              <p className="text-xs font-semibold tracking-[0.16em] text-white/80 uppercase">
                {rankLabel}
              </p>
            ) : null}
            <h3
              id={headingId}
              className={
                rank === 0
                  ? 'font-display text-display-sm mt-1 text-white'
                  : 'mt-1 text-xl font-semibold text-white'
              }
            >
              {candidate.destinationName}{' '}
              {/*
                The explicit space matters: JSX trims one at the start of a text
                child, and without it the heading's accessible name runs the two
                words together as "Antalyafrom VIE".
              */}
              <span className="font-normal text-white/70">from {candidate.origin}</span>
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/80">
              <Icon name="calendar" size={0.9} />
              {shortDate(candidate.dates.departureDate)} to {shortDate(candidate.dates.returnDate)}{' '}
              · {nightsLabel(candidate.dates.nights)} · {candidate.passengers}{' '}
              {candidate.passengers === 1 ? 'traveller' : 'travellers'}
            </p>
          </div>

          <div className="text-right">
            {/* Beside the number, never in a footnote. */}
            <p
              className={`flex items-center justify-end gap-2 font-semibold text-white tabular-nums ${
                rank === 0 ? 'text-3xl' : 'text-2xl'
              }`}
            >
              {format(cost.total)}
              <ProvenanceBadge provenance={provenance} explain={false} />
            </p>
            <p className="mt-0.5 text-sm text-white/75 tabular-nums">
              {format(cost.perPerson)} each · {format(cost.perNight)} a night
            </p>
            <p
              className={`mt-1 text-sm font-medium tabular-nums ${
                eligibility.budgetHeadroom.amount >= 0 ? 'text-positive-ink' : 'text-critical-ink'
              }`}
            >
              {eligibility.budgetHeadroom.amount >= 0
                ? `${format(eligibility.budgetHeadroom)} under your maximum`
                : `${format(eligibility.budgetHeadroom)} over your maximum`}
            </p>
          </div>
        </div>
      </header>

      {/*
        The journey, drawn the way the globe draws it.

        Two lines rather than a sentence about stops: the shape of a flight -
        when it leaves, where it stops, when it lands - is the thing somebody
        comparing trips is actually reading, and it is the same shape as the
        arc they clicked to get here.
      */}
      <div className="border-border flex flex-col gap-2 border-y py-3">
        <RouteLine leg={candidate.flight.outbound} label="Outbound" />
        <RouteLine leg={candidate.flight.inbound} label="Return" />
      </div>

      {/*
        The four things the total is made of, each in its own tile.

        Tiles rather than a run of label-and-value pairs, because these are the
        figures somebody comparing two trips reads first, and a row of small
        print is not something anybody compares. The icons are decoration:
        every tile says its own name beside one.
      */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border-border bg-surface-sunken rounded-[--radius-control] border p-3">
          <dt className="text-ink-muted flex items-center gap-1.5 text-xs">
            <Icon name="plane" size={0.95} />
            Flights
          </dt>
          <dd className="text-ink mt-1 text-sm tabular-nums">
            {format(candidate.flight.price)}
            <span className="text-ink-muted"> · {stopsLabel(candidate)}</span>
          </dd>
        </div>
        <div className="border-border bg-surface-sunken rounded-[--radius-control] border p-3">
          <dt className="text-ink-muted flex items-center gap-1.5 text-xs">
            <Icon name="bed" size={0.95} />
            Hotel
          </dt>
          <dd className="text-ink mt-1 text-sm tabular-nums">
            {format(candidate.hotel.totalPrice)}
            <span className="text-ink-muted"> · {candidate.dates.nights} nights</span>
          </dd>
        </div>
        <div className="border-border bg-surface-sunken rounded-[--radius-control] border p-3">
          <dt className="text-ink-muted flex items-center gap-1.5 text-xs">
            <Icon name="car" size={0.95} />
            Airport transfer
          </dt>
          <dd className="text-ink mt-1 text-sm tabular-nums">
            {candidate.transfer ? (
              `${format(candidate.transfer.pricePerDirection)} each way`
            ) : (
              // Never a zero. An unpriced transfer is a cost we could not get,
              // not a cost that does not exist.
              <span className="text-caution-ink">Not priced</span>
            )}
          </dd>
        </div>
        <div className="border-border bg-surface-sunken rounded-[--radius-control] border p-3">
          <dt className="text-ink-muted flex items-center gap-1.5 text-xs">
            <Icon name="sun" size={0.95} />
            Weather
          </dt>
          <dd className="text-ink mt-1 text-sm">{weatherLabel(candidate)}</dd>
        </div>
      </dl>

      {/*
        Section 9: explain the ranking in human terms and do not expose
        meaningless technical scoring. Every figure in this sentence comes from
        the engines; the factor breakdown is still there, one disclosure down,
        for anyone who wants it.
      */}
      <div className="bg-surface-sunken rounded-[--radius-card] p-4">
        <h4 id={scoreId} className="text-ink text-sm font-medium">
          Why this trip?
        </h4>
        <p className="text-ink mt-1">{summariseReasons(reasons)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="neutral" srPrefix="Trip score">
            Score {score.score} of 100
          </Badge>
          <Badge tone="neutral" srPrefix="Usable holiday time">
            {hoursLabel(usableTime.totalMinutes)} at the destination
          </Badge>
        </div>
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

      {/*
        Everything that can be opened, as one panel rather than five.

        Five separately bordered bars stacked down a card read as leftover
        admin below the answer. One panel with rules between its rows is the
        same five disclosures, the same markup and the same behaviour - the
        browser still supplies all of it - and it looks like part of the card.
      */}
      <div className="border-border divide-border divide-y overflow-hidden rounded-[--radius-card] border">
        <Disclosure summary="Full cost breakdown" className={ROW}>
          <CostBreakdown
            cost={cost}
            passengers={candidate.passengers}
            nights={candidate.dates.nights}
          />
        </Disclosure>

        <Disclosure summary={`How the score of ${score.score} was calculated`} className={ROW}>
          <ScoreExplanation score={score} headingId={scoreId} />
        </Disclosure>

        <SwapPanel
          heading="Change the flight"
          alternatives={flightAlternatives}
          currency={cost.total.currency}
          className={ROW}
        />

        <SwapPanel
          heading="Change the hotel"
          alternatives={hotelAlternatives}
          currency={cost.total.currency}
          className={ROW}
        />

        <Disclosure summary="Flight and hotel details" className={ROW}>
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
      </div>

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
