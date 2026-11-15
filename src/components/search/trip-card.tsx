import { abs, format } from '@/core/money';
import { connectionCount } from '@/core/trip/legs';
import { Badge, Button, Card, Disclosure, FactGrid, Icon, Price, type Fact } from '@/components/ui';
import { cn } from '@/lib/cn';
import './explore.css';
import type { DestinationImage } from '@/providers/imagery/types';
import { DestinationPicture } from './destination-picture';
import { ItineraryRows } from './itinerary-rows';
import { AddToPlan, type PlanTrip } from './add-to-plan';
import { imageryUrlFor } from '@/providers/imagery/url';
import { buildFlightHandoff, buildHotelHandoff, OUTBOUND_LINK_REL } from '@/booking/handoff';
import { FindStayLink } from '@/components/stays/find-stay-link';
import type { PartnerOffer } from '@/booking/partners';
import { PartnerOfferRow } from '@/components/partners/partner-offer-row';
import { costCoverage, describeExclusions } from '@/core/trip/coverage';
import type { StayLinkOffer } from '@/core/stay/types';
import type { RankedTrip } from '@/search/types';
import type { Alternative } from '@/search/alternatives';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import { summariseReasons, type TripReason } from '@/search/explain';
import { RouteLine } from './route-line';
import { CostBreakdown } from './cost-breakdown';
import { ScoreExplanation } from './score-explanation';
import { DateSwapPanel, SwapPanel } from './swap-panel';
import { DealNote } from './deal-note';
import { TYPICAL_LABEL } from '@/discovery/weather-summary';
import type { DealAgainstTypical } from '@/search/deal-score';
import type { BuiltTrip, DateChoice } from '@/search/trip-builder';
import { tintFor } from '@/lib/tint';
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

/** Only worth saying when the stay needed more than one room; unknown stays silent. */
function roomsNote(rooms: number | null): string {
  return rooms !== null && rooms > 1 ? ` across ${rooms} rooms` : '';
}

/**
 * A disclosure inside the grouped panel.
 *
 * The panel owns the border and the rules between rows, so each row drops its
 * own border and its corner radius; a rounded box inside a rounded box with a
 * rule between them is three edges where one was wanted.
 */
const ROW = 'rounded-none border-0';

/**
 * A row in the builder: its own soft pane on the framed panel, rather than a
 * rule in a list - three choices, each worth a moment, not three lines of
 * small print.
 */
const BUILD_ROW =
  'bg-surface/50 border-tint/20 hover:border-tint/45 rounded-(--radius-card) ease-standard duration-quick transition-colors';

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
    connectionCount(candidate.flight.outbound),
    connectionCount(candidate.flight.inbound),
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

  // The weakest claim wins: a week with any climate-average day is not a forecast.
  const forecast = candidate.weather.every((day) => day.basis === 'forecast');
  const range = low === high ? `${low}°C` : `${low}–${high}°C`;

  return forecast ? range : `${range}, ${TYPICAL_LABEL.toLowerCase()}`;
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
   * The trip as the traveller is building it, and where each choice goes.
   *
   * When present, the swap panels offer every option as a link that rebuilds
   * the trip, a third panel moves it to other dates, and the card says what
   * the changes did to the total. The card itself renders `builder.built.trip`
   * - the caller passes that as `trip` as well, so there is one source.
   */
  builder?: {
    readonly built: BuiltTrip;
    readonly flightHref: (offerId: string) => string;
    readonly hotelHref: (offerId: string) => string;
    readonly dateHref: (choice: DateChoice) => string;
    readonly resetHref: string;
  };
  /**
   * Which price leads: the whole trip's, or the flights' alone.
   *
   * Reading, not recomputing. Both figures are the engine's - the trip total
   * and the fare as quoted - and the ranking is the same either way.
   */
  view?: 'trip' | 'flight';
  /** Opens this trip in the builder. For the cards that are not already in it. */
  buildHref?: string;
  /** What the top trip is called when it leads on a sort, e.g. "Cheapest". */
  lead?: string;
  /** Replaces the rank as the eyebrow, e.g. "Your trip". */
  label?: string;
  /** How this trip compares with the typical one to the same place. */
  deal?: DealAgainstTypical | null;
  /**
   * The destination's photograph, when one was found.
   *
   * Optional, and absent everywhere the card is rendered without a page having
   * resolved imagery first. The header is built to look deliberate without it.
   */
  image?: DestinationImage | null;
  /**
   * A "find a stay" link, for a trip with no priced stay. Resolved by the page;
   * absent when there is no link vendor configured, and the card then says only
   * that the stay is not included.
   */
  stayLink?: StayLinkOffer | null;
  /**
   * A partner who can sort the airport transfer. Shown only when this trip's
   * transfer cost line is `excluded`, beside the words that say so; absent
   * when no partner is registered, and the card then shows nothing extra.
   */
  transferOffer?: PartnerOffer | null;
  /** The destination in full ("Malta"), never a code. */
  country?: string | null;
  /**
   * The signed-in person's trips, for "Add to my plan". `null` or absent means
   * nobody is signed in, and the button is not shown.
   */
  planTrips?: readonly PlanTrip[] | null;
  /** Name the picture for the view transition into the destination page. One per page. */
  transition?: boolean;
  /** Where the destination page lives, with the search's dates carried over. */
  destinationHref?: string;
}

export function TripCard({
  trip,
  rank,
  lead,
  reasons = [],
  flightAlternatives = [],
  hotelAlternatives = [],
  image = null,
  stayLink = null,
  transferOffer = null,
  country = null,
  planTrips = null,
  transition = false,
  destinationHref,
  builder,
  view = 'trip',
  buildHref,
  label,
  deal = null,
}: TripCardProps) {
  const { candidate, cost, score, warnings, usableTime, eligibility } = trip;
  const headingId = `trip-${candidate.id}-heading`;
  const warningsId = `trip-${candidate.id}-warnings`;
  const scoreId = `trip-${candidate.id}-score`;

  /*
   * The parts behind the total, one disclosure down.
   *
   * Every one of them is read off the candidate the engine produced; nothing
   * here adds, converts or rounds. A transfer nobody priced says so rather
   * than showing a zero, because a missing cost and a cost of nothing are
   * different facts and only one of them is true. The weather is not here: it
   * has its own line above the fold.
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
    },
    {
      key: 'hotel',
      icon: 'bed',
      label: 'Hotel',
      value: candidate.hotel ? (
        <>
          {format(candidate.hotel.totalPrice)}
          <span className="text-ink-muted"> · {candidate.dates.nights} nights</span>
        </>
      ) : (
        // Never a zero: no price was quoted, which is not a free stay.
        <span className="text-caution-ink">Not priced</span>
      ),
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
  ];

  const flightLink = buildFlightHandoff(candidate.flight, { candidateId: candidate.id });
  const hotelLink = candidate.hotel
    ? buildHotelHandoff(candidate.hotel, { candidateId: candidate.id })
    : null;
  /*
   * What the total leaves out, said once, from the engine's own tagging.
   *
   * "Flights only - stay not included" when the stay is missing, a plain
   * "Airport transfer not included" when only that is. The transfer partner
   * row further down no longer repeats it.
   */
  const exclusions = describeExclusions(costCoverage(cost.excluded).excluded);
  const transferExcluded = cost.excluded.some((line) => line.category === 'transfer');
  const rankLabel = label ?? (rank === 0 ? (lead ?? RANK_LABEL[0]) : RANK_LABEL[rank]);

  /*
   * Three densities, which is what stops the page being one long column of
   * identical objects.
   *
   *  - **featured** - the answer. The largest picture and the largest price.
   *  - **medium** - the alternatives to it.
   *  - **compact** - a near miss. It did not meet what was asked for, and
   *    rendering it at the same weight as a trip that did would make a search
   *    that found nothing look like a search that found ten things.
   *
   * Nothing is removed at any density: the same facts, disclosures and
   * warnings are on a near miss as on the best match.
   */
  const featured = rank === 0;
  const compact = rank < 0;

  const secondaryRows = [
    hotelLink ? (
      <li
        key="hotel"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5"
      >
        <span className="text-ink-muted flex items-center gap-2 text-sm">
          <Icon name="bed" size={1} aria-hidden="true" />
          Hotel on this trip
        </span>
        <Button asChild variant="secondary" size="md">
          <a href={hotelLink.url} rel={OUTBOUND_LINK_REL} target="_blank">
            Book the hotel with {hotelLink.providerId}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </li>
    ) : null,
    stayLink ? (
      <li key="stay" className="py-2.5">
        <FindStayLink offer={stayLink} size="md" />
      </li>
    ) : null,
    transferExcluded && transferOffer ? (
      <li key="transfer" className="flex flex-col gap-1 py-2.5">
        <PartnerOfferRow offer={transferOffer} />
        {planTrips ? (
          <AddToPlan offerId={transferOffer.id} trips={planTrips} partner={transferOffer.partner} />
        ) : null}
      </li>
    ) : null,
  ].filter(Boolean);

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      elevation={featured ? 'floating' : compact ? 'flat' : 'raised'}
      // The destination's own colour, for what on this card is tinted.
      data-tint={tintFor(candidate.destination)}
      className={cn(
        'voyagr-card flex flex-col overflow-hidden p-0',
        'rounded-(--radius-surface)',
        featured && 'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]',
      )}
    >
      {/*
        The header carries the picture, in the stage's palette so this reads
        as the same product as the globe it was opened from. The scrim sits
        over the picture or the tile alike, so the type has its own darkness
        under it either way. The box has a height of its own, so nothing moves
        when the picture arrives.
      */}
      <DestinationPicture
        code={candidate.destination}
        providerUrl={image ? imageryUrlFor(candidate.destination) : null}
        alt={`Illustration of ${candidate.destinationName}`}
        priority={featured}
        {...(transition ? { transitionName: `dest-${candidate.destination}` } : {})}
        className={cn(
          'stage-scope flex flex-col justify-between p-5 sm:p-6',
          featured
            ? 'min-h-[15rem] sm:min-h-[18rem] lg:min-h-full'
            : compact
              ? 'min-h-[8.5rem]'
              : 'min-h-[12.5rem]',
        )}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/35 to-black/10"
        />

        {rankLabel ? (
          <p className="w-fit rounded-(--radius-pill) bg-black/45 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-white uppercase backdrop-blur-sm">
            {rankLabel}
          </p>
        ) : (
          <span />
        )}

        <div className="min-w-0">
          <h3
            id={headingId}
            className={cn(
              'font-display leading-tight text-white',
              featured ? 'text-display-sm' : compact ? 'text-xl' : 'text-2xl',
            )}
          >
            {destinationHref ? (
              <a
                href={destinationHref}
                className="rounded-sm after:absolute after:inset-0 after:content-['']"
              >
                {candidate.destinationName}
              </a>
            ) : (
              candidate.destinationName
            )}{' '}
            {/*
              The explicit space matters: JSX trims one at the start of a text
              child, and without it the heading's accessible name runs the two
              words together as "Antalyafrom VIE".
            */}
            <span className="font-sans text-base font-normal text-white/80">
              from {candidate.origin}
            </span>
          </h3>
          {country ? <p className="mt-1 text-sm text-white/80">{country}</p> : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/85 tabular-nums">
            <Icon name="calendar" size={0.9} aria-hidden="true" />
            {shortDate(candidate.dates.departureDate)} to {shortDate(candidate.dates.returnDate)} ·{' '}
            {nightsLabel(candidate.dates.nights)} · {candidate.passengers}{' '}
            {candidate.passengers === 1 ? 'traveller' : 'travellers'}
          </p>
        </div>
      </DestinationPicture>

      <div
        className={cn('flex min-w-0 flex-col', compact ? 'gap-4 p-4 sm:p-5' : 'gap-5 p-5 sm:p-6')}
      >
        {/*
          The price, and what it leaves out, together.

          One figure at one size, "from" before it because it is the cheapest
          quote seen and can move, then what it is for, then - in words, once -
          what it does not cover. Per-traveller and per-night figures are the
          engine's, in the caption that was always there.
        */}
        <div className="flex flex-col gap-1">
          <p className="text-ink-muted text-sm">from</p>
          <Price
            amount={format(view === 'flight' ? candidate.flight.price : cost.total)}
            size={featured ? 'xl' : compact ? 'md' : 'lg'}
            caption={
              view === 'flight'
                ? `flights for ${candidate.passengers} · whole trip ${format(cost.total)}`
                : `total · ${format(cost.perPerson)} each${roomsNote(candidate.hotel?.rooms ?? null)} · ${format(cost.perNight)} a night`
            }
            note={
              <div className="mt-1 flex flex-col gap-1">
                {exclusions ? <p className="text-caution-ink font-medium">{exclusions}</p> : null}
                <p
                  className={cn(
                    'font-medium tabular-nums',
                    eligibility.budgetHeadroom.amount >= 0
                      ? 'text-positive-ink'
                      : 'text-critical-ink',
                  )}
                >
                  {/*
                    `abs`, because the word already carries the sign.
                    "-EUR 472.40 over your maximum" is a double negative. The
                    figure is still the engine's; only the minus sign, which
                    "over" already said, is dropped.
                  */}
                  {view === 'flight' ? 'Whole trip: ' : ''}
                  {eligibility.budgetHeadroom.amount >= 0
                    ? `${format(eligibility.budgetHeadroom)} under your maximum`
                    : `${format(abs(eligibility.budgetHeadroom))} over your maximum`}
                </p>
                <DealNote deal={deal} />
              </div>
            }
          />
        </div>

        {builder?.built.customised ? (
          /*
            What the traveller's choices did, against where they started.
            Both totals are the engine's; the difference is the builder's
            subtraction of the two. Reset is a link back to the unbuilt trip.
          */
          <div className="border-tint/40 bg-tint/10 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border px-4 py-3 text-sm">
            <p className="text-ink">
              <span className="text-tint-ink font-semibold">Built by you.</span>{' '}
              {builder.built.deltaFromOriginal
                ? builder.built.deltaFromOriginal.amount === 0
                  ? 'Same total as the trip you started from.'
                  : `${format(abs(builder.built.deltaFromOriginal))} ${
                      builder.built.deltaFromOriginal.amount < 0 ? 'cheaper' : 'more'
                    } than the trip you started from (${format(builder.built.original.cost.total)}).`
                : 'The trip you started from was priced in another currency.'}
            </p>
            <a
              href={builder.resetHref}
              className="text-tint-ink inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
            >
              Back to the original
            </a>
          </div>
        ) : null}

        {view === 'flight' ? (
          <p className="text-ink-muted -mt-2 text-sm">
            {candidate.hotel ? (
              <>
                Showing the flights&rsquo; price. The hotel on this trip,{' '}
                <span className="text-ink">{candidate.hotel.name}</span>, adds{' '}
                <span className="text-ink tabular-nums">{format(candidate.hotel.totalPrice)}</span>.
              </>
            ) : (
              'Showing the flights’ price. No stay was priced for this trip, so it is also the whole total.'
            )}
          </p>
        ) : null}

        {/*
          The flights as two lines and the weather as one. Baggage and every
          leg of the journey are in the breakdown below.
        */}
        <div className="flex flex-col gap-3">
          <ItineraryRows outbound={candidate.flight.outbound} inbound={candidate.flight.inbound} />
          <p className="text-ink-muted flex items-center gap-2 text-sm">
            <Icon name="sun" size={1} aria-hidden="true" />
            <span className="sr-only">Weather: </span>
            <span className="tabular-nums">{weatherLabel(candidate)}</span>
          </p>
        </div>

        {eligibility.violations.length > 0 ? (
          <div className="border-critical-500/30 bg-critical-500/10 rounded-(--radius-control) border p-3">
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

        {/* A warning somebody has to go looking for is not a warning. */}
        <div>
          <h4 id={warningsId} className="text-ink text-sm font-medium">
            Before you book
          </h4>
          <div className="mt-2">
            <WarningList warnings={warnings} headingId={warningsId} />
          </div>
        </div>

        {/*
          The score, explained, behind one disclosure.

          The reasons as separate things, because that is what they are: the
          sentence a screen reader hears is `summariseReasons`, and the visible
          list is the same phrases one to a line. Every phrase comes from
          `src/search/explain.ts`; nothing here is written here. The factor
          breakdown follows, for anyone who wants to check the working.
        */}
        <Disclosure summary={`How the score of ${score.score} was calculated`}>
          <div className="flex flex-col gap-4">
            <div>
              <h4 id={scoreId} className="text-ink text-sm font-medium">
                Why this trip?
              </h4>
              {reasons.length > 0 ? (
                <>
                  <p className="sr-only">{summariseReasons(reasons)}</p>
                  <ul aria-hidden="true" className="mt-2 flex flex-wrap gap-x-2 gap-y-1.5">
                    {reasons.map((reason) => (
                      <li
                        key={reason.source}
                        className="border-border bg-surface-sunken text-ink inline-flex items-center rounded-(--radius-pill) border px-3 py-1 text-sm"
                      >
                        {sentenceCase(reason.text)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : compact /*
                Nothing, on a near miss: "this trip fits what you asked for" is
                false here by definition, and a reassuring sentence above a
                rejection is the worst kind of wrong copy.
              */ ? null : (
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
            <ScoreExplanation score={score} headingId={scoreId} />
          </div>
        </Disclosure>

        {/*
          The breakdown, closed until somebody asks for it. Open by default only
          while a trip is being built, so a swapped flight does not collapse
          the panel it was chosen in.
        */}
        <Disclosure
          summary="Open the breakdown"
          defaultOpen={label !== undefined || Boolean(builder?.built.customised)}
        >
          <div className="flex flex-col gap-4">
            <div
              role="group"
              aria-label="Flight details"
              className="border-border divide-border flex flex-col divide-y border-y lg:flex-row lg:divide-x lg:divide-y-0"
            >
              <RouteLine
                leg={candidate.flight.outbound}
                label="Outbound"
                className="py-3 lg:flex-1 lg:py-2 lg:pr-6"
              />
              <RouteLine
                leg={candidate.flight.inbound}
                label="Return"
                className="py-3 lg:flex-1 lg:py-2 lg:pl-6"
              />
            </div>

            {/* The parts the total is made of, as one panel with hairlines. */}
            <FactGrid facts={facts} columns={3} />

            {builder || flightAlternatives.length > 1 || hotelAlternatives.length > 1 ? (
              <section
                aria-labelledby={`${headingId}-build`}
                className="border-tint/30 from-tint/[0.14] relative overflow-hidden rounded-(--radius-surface) border bg-gradient-to-br via-transparent to-transparent p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h4 id={`${headingId}-build`} className="font-display text-ink text-xl">
                    Build it your way
                  </h4>
                  <p className="text-ink-muted text-xs">
                    Swap any part. Every price is for the whole trip.
                  </p>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  <SwapPanel
                    heading="Change the flight"
                    icon="plane"
                    alternatives={builder ? builder.built.flights : flightAlternatives}
                    currency={cost.total.currency}
                    {...(builder
                      ? { hrefFor: (option) => builder.flightHref(option.offerId) }
                      : {})}
                    className={BUILD_ROW}
                  />

                  <SwapPanel
                    heading="Change the hotel"
                    icon="bed"
                    alternatives={builder ? builder.built.hotels : hotelAlternatives}
                    currency={cost.total.currency}
                    {...(builder ? { hrefFor: (option) => builder.hotelHref(option.offerId) } : {})}
                    className={BUILD_ROW}
                  />

                  {builder ? (
                    <DateSwapPanel
                      choices={builder.built.dates}
                      hrefFor={builder.dateHref}
                      now={`${shortDate(candidate.dates.departureDate)} to ${shortDate(candidate.dates.returnDate)}, ${nightsLabel(candidate.dates.nights)}`}
                      className={BUILD_ROW}
                    />
                  ) : null}
                </div>
              </section>
            ) : null}

            <div className="border-border divide-border divide-y overflow-hidden rounded-(--radius-card) border">
              <Disclosure summary="Full cost breakdown" className={ROW}>
                <CostBreakdown
                  cost={cost}
                  passengers={candidate.passengers}
                  nights={candidate.dates.nights}
                  rooms={candidate.hotel?.rooms ?? null}
                />
              </Disclosure>

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
                      {candidate.hotel ? (
                        <>
                          {candidate.hotel.name}
                          {candidate.hotel.starRating === null
                            ? ''
                            : `, ${candidate.hotel.starRating} star`}
                          {candidate.hotel.reviewScore === null
                            ? ''
                            : `, guests rate it ${candidate.hotel.reviewScore} from ${candidate.hotel.reviewCount} reviews`}
                          .
                        </>
                      ) : (
                        'No stay was priced for these dates.'
                      )}
                    </dd>
                  </div>
                </dl>
              </Disclosure>
            </div>

            {buildHref ? (
              <a
                href={buildHref}
                className="text-tint-ink inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
              >
                Change the flight, hotel or dates of this trip
                <Icon name="arrow-right" size={0.9} />
              </a>
            ) : null}
          </div>
        </Disclosure>

        {/*
          Where the card finishes: one filled action, then the rest as quiet
          rows. Both hand off to the provider that quoted the price, and
          neither is a claim about booking.
        */}
        {flightLink ? (
          <div className="flex flex-col gap-1">
            <Button
              asChild
              variant="cta"
              size="lg"
              className="w-full active:scale-[0.97] motion-reduce:active:scale-100 sm:w-fit"
            >
              <a href={flightLink.url} rel={OUTBOUND_LINK_REL} target="_blank">
                Book the flight with {flightLink.providerId}
                <span className="sr-only"> (opens in a new tab)</span>
                <Icon name="arrow-right" size={1} aria-hidden="true" />
              </a>
            </Button>
            {secondaryRows.length > 0 ? (
              <ul className="divide-border border-border mt-3 divide-y border-t">
                {secondaryRows}
              </ul>
            ) : null}
          </div>
        ) : secondaryRows.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-ink-muted text-sm">
              This provider did not supply a booking link for these offers.
            </p>
            <ul className="divide-border border-border divide-y border-t">{secondaryRows}</ul>
          </div>
        ) : (
          <p className="text-ink-muted border-border border-t pt-4 text-sm">
            This provider did not supply a booking link for these offers.
          </p>
        )}
      </div>
    </Card>
  );
}
