import { format } from '@/core/money';
import {
  Badge,
  Button,
  Card,
  Disclosure,
  FactGrid,
  Icon,
  Media,
  Price,
  ProvenanceBadge,
  SourceStrip,
  SourceTag,
  type Fact,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import { buildFlightHandoff, buildHotelHandoff, OUTBOUND_LINK_REL } from '@/booking/handoff';
import type { RankedTrip } from '@/search/types';
import type { Alternative } from '@/search/alternatives';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import { summariseReasons, type TripReason } from '@/search/explain';
import { RouteLine } from './route-line';
import { CostBreakdown } from './cost-breakdown';
import { ScoreExplanation } from './score-explanation';
import { SwapPanel } from './swap-panel';
import { WarningList } from './warning-list';
import { shortDate } from '@/lib/display-date';

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

/**
 * A phrase from `explain.ts`, as its own line.
 *
 * The phrases are written to be joined into a sentence, so they start in
 * lower case. Standing alone in a chip that reads as a typo rather than as a
 * style, and this is the only place they are used that way.
 */
function sentenceCase(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
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
  /** Where this trip's prices came from, as a combined verdict. */
  provenance?: DataProvenance;
  /** Which provider supplied each part, named on the card itself. */
  sources?: readonly SourceAttribution[];
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

export function TripCard({
  trip,
  rank,
  provenance = 'unavailable',
  sources = [],
  reasons = [],
  flightAlternatives = [],
  hotelAlternatives = [],
  image = null,
}: TripCardProps) {
  /*
   * Which provider supplied one part of this trip.
   *
   * Looked up rather than positional: a search can mix a live flight
   * provider with a fixture hotel one, and the tile has to name its own.
   */
  const sourceFor = (part: SourceAttribution['part']) =>
    sources.find((source) => source.part === part);

  const { candidate, cost, score, warnings, usableTime, eligibility } = trip;
  const headingId = `trip-${candidate.id}-heading`;
  const warningsId = `trip-${candidate.id}-warnings`;
  const scoreId = `trip-${candidate.id}-score`;

  /*
   * The four figures behind the total.
   *
   * Every one of them is read off the candidate the engine produced; nothing
   * here adds, converts or rounds. A transfer nobody priced says so rather
   * than showing a zero, because a missing cost and a cost of nothing are
   * different facts and only one of them is true.
   */
  const facts: readonly Fact[] = [
    {
      key: 'flights',
      icon: 'plane',
      label: 'Flights',
      value: (
        <>
          {format(candidate.flight.price)}
          <span className="text-ink-muted"> · {stopsLabel(candidate)}</span>
        </>
      ),
      detail: sourceFor('flights') ? (
        <SourceTag source={sourceFor('flights')!} className="mt-2 flex w-fit" />
      ) : null,
    },
    {
      key: 'hotel',
      icon: 'bed',
      label: 'Hotel',
      value: (
        <>
          {format(candidate.hotel.totalPrice)}
          <span className="text-ink-muted"> · {candidate.dates.nights} nights</span>
        </>
      ),
      detail: sourceFor('hotels') ? (
        <SourceTag source={sourceFor('hotels')!} className="mt-2 flex w-fit" />
      ) : null,
    },
    {
      key: 'transfer',
      icon: 'car',
      label: 'Airport transfer',
      value: candidate.transfer ? (
        `${format(candidate.transfer.pricePerDirection)} each way`
      ) : (
        // Never a zero. An unpriced transfer is a cost we could not get,
        // not a cost that does not exist.
        <span className="text-caution-ink">Not priced</span>
      ),
    },
    {
      key: 'weather',
      icon: 'sun',
      label: 'Weather',
      value: weatherLabel(candidate),
    },
  ];

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
      <Media
        seed={candidate.destination}
        image={image ? { url: imageryUrlFor(candidate.destination), alt: '' } : null}
        priority={rank === 0}
        scrim="full"
        className={cn(
          'stage-scope flex flex-col justify-end',
          rank === 0
            ? '-mx-7 -mt-7 min-h-[17rem] rounded-t-[--radius-surface] p-7'
            : '-mx-5 -mt-5 min-h-[13rem] rounded-t-[--radius-card] p-5',
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            {rankLabel ? (
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/75 uppercase">
                {rankLabel}
              </p>
            ) : null}
            <h3
              id={headingId}
              className={
                rank === 0
                  ? 'font-display text-display-sm mt-1.5 text-white'
                  : 'font-display mt-1.5 text-2xl leading-tight text-white'
              }
            >
              {candidate.destinationName}{' '}
              {/*
                The explicit space matters: JSX trims one at the start of a text
                child, and without it the heading's accessible name runs the two
                words together as "Antalyafrom VIE".
              */}
              <span className="font-sans text-base font-normal text-white/70">
                from {candidate.origin}
              </span>
            </h3>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/80">
              <Icon name="calendar" size={0.9} />
              {shortDate(candidate.dates.departureDate)} to {shortDate(candidate.dates.returnDate)}{' '}
              · {nightsLabel(candidate.dates.nights)} · {candidate.passengers}{' '}
              {candidate.passengers === 1 ? 'traveller' : 'travellers'}
            </p>
          </div>

          {/*
            The total, and only the total, at this size.

            What it is made of is four cells further down and what it costs
            per person is the line beneath it. Neither competes with the one
            figure somebody comparing ten of these is actually reading.
          */}
          <Price
            amount={format(cost.total)}
            size={rank === 0 ? 'xl' : 'lg'}
            align="end"
            onImage
            badge={<ProvenanceBadge provenance={provenance} explain={false} />}
            caption={`total · ${format(cost.perPerson)} each · ${format(cost.perNight)} a night`}
            note={
              <div className="flex flex-col items-end gap-1.5">
                <p
                  className={cn(
                    'font-medium tabular-nums',
                    eligibility.budgetHeadroom.amount >= 0
                      ? 'text-positive-ink'
                      : 'text-critical-ink',
                  )}
                >
                  {eligibility.budgetHeadroom.amount >= 0
                    ? `${format(eligibility.budgetHeadroom)} under your maximum`
                    : `${format(eligibility.budgetHeadroom)} over your maximum`}
                </p>
                {/*
                  Named beside the price, because that is where the question
                  "is this real?" is actually asked.
                */}
                <SourceStrip sources={sources} className="justify-end" />
              </div>
            }
          />
        </div>
      </Media>

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
      {/*
        The four things the total is made of, as one panel.

        They were four separately bordered, separately filled tiles, which is
        how a result card ends up reading as a page of cards rather than as
        one object. `FactGrid` is the same four facts with hairlines between
        them - and the same treatment as the disclosure panel further down,
        so the card is two grouped regions instead of nine rectangles.
      */}
      <FactGrid facts={facts} columns={4} />

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

        {/*
          The reasons as separate things, because that is what they are.

          `summariseReasons` joins them into one sentence, which reads well
          and scans badly: comparing five results means reading five
          sentences to find the one difference between them. Each reason is
          its own line here, and the sentence is still what a screen reader
          hears, so nothing was lost by splitting them.

          Every phrase comes from `src/search/explain.ts`, which derives them
          from computed factors. Nothing on this card is written here.
        */}
        {reasons.length > 0 ? (
          <>
            <p className="sr-only">{summariseReasons(reasons)}</p>
            <ul aria-hidden="true" className="mt-2 flex flex-wrap gap-x-2 gap-y-1.5">
              {reasons.map((reason) => (
                <li
                  key={reason.source}
                  className="border-border bg-surface-sunken text-ink inline-flex items-center rounded-[--radius-pill] border px-3 py-1 text-sm"
                >
                  {sentenceCase(reason.text)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-ink-muted mt-1 text-sm">
            This trip fits what you asked for; nothing about it stood out either way.
          </p>
        )}

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

      {/*
        Where the card finishes.

        These were two underlined sentences at the bottom of a long card, and
        they are the only thing on it a user can actually act on. One filled
        control and one quiet one says which is the next step without
        pretending the second does not exist - and neither is a claim about
        booking, because both hand off to the provider that quoted the price.
      */}
      {flightLink || hotelLink ? (
        <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
          {flightLink ? (
            <Button asChild variant={rank === 0 ? 'cta' : 'secondary'} size="md">
              <a href={flightLink.url} rel={OUTBOUND_LINK_REL} target="_blank">
                Book the flight with {flightLink.providerId}
                <span className="sr-only"> (opens in a new tab)</span>
                <Icon name="arrow-right" size={1} aria-hidden="true" />
              </a>
            </Button>
          ) : null}
          {hotelLink ? (
            <Button asChild variant="secondary" size="md">
              <a href={hotelLink.url} rel={OUTBOUND_LINK_REL} target="_blank">
                Book the hotel with {hotelLink.providerId}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
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
