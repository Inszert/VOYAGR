import { abs, format, money, ratio, type Money } from '@/core/money';
import { evenShare, perTraveller, travellersLabel } from '@/core/party';
import { connectionCount, connectionsUnitemised, legArrival } from '@/core/trip/legs';
import { localDate, daysBetween, minutesIntoLocalDay } from '@/core/dates';
import { costCoverage, describeExclusions } from '@/core/trip/coverage';
import type { CostCategory, FlightLeg, HotelOffer, SearchProfile } from '@/core/trip/types';
import type { StayLinkOffer } from '@/core/stay/types';
import { Button, Disclosure, Icon, type IconName } from '@/components/ui';
import { buildFlightHandoff, buildHotelHandoff, OUTBOUND_LINK_REL } from '@/booking/handoff';
import type { PartnerOffer } from '@/booking/partners';
import { PartnerOfferRow } from '@/components/partners/partner-offer-row';
import { FindStayLink } from '@/components/stays/find-stay-link';
import { earthMonthOf } from '@/components/discovery/globe-style';
import { cn } from '@/lib/cn';
import { weekdayDate } from '@/lib/display-date';
import { tilesForWindow, EARTH_MAX_ZOOM } from '@/lib/tile-locator';
import { resolveAirport } from '@/providers/reference/airports';
import type { Alternative } from '@/search/alternatives';
import type { DealAgainstTypical } from '@/search/deal-score';
import type { TripReason } from '@/search/explain';
import { goodToKnow, seasonLine, type CheckKind } from '@/search/trip-view';
import type { BuiltTrip, FlightChoice } from '@/search/trip-builder';
import { TYPICAL_LABEL } from '@/discovery/weather-summary';
import { tintFor } from '@/lib/tint';
import { AddToPlan, type PlanTrip } from './add-to-plan';
import { CostBreakdown } from './cost-breakdown';
import { DealNote } from './deal-note';
import { clock, duration } from './route-line';
import { ScoreExplanation } from './score-explanation';
import {
  HotelGallery,
  LegChanger,
  SummaryBar,
  TripTotal,
  type ChangeOption,
} from './your-trip-client';
import './explore.css';

/**
 * "Your trip": the trip being built, as one journey (docs/design-trip-builder.md
 * sections 1-7).
 *
 * Three legs joined by a rail - out, the stay, back - each of which can be
 * changed in place, beside a summary that says what it all costs for the
 * party. Every figure is the engine's: totals from `cost.ts`, swaps from
 * `src/search/swap.ts` through `buildTrip`, the score from `scoring.ts`, and
 * every split per person or per night from `src/core/party.ts`. This file
 * formats and arranges; it never adds one price to another.
 */

export interface YourTripProps {
  readonly built: BuiltTrip;
  readonly profile: SearchProfile;
  readonly flightHref: (offerId: string) => string;
  readonly hotelHref: (offerId: string) => string;
  readonly resetHref: string;
  /** Where "try other dates" goes: the calendar above. */
  readonly calendarHref: string;
  readonly reasons: readonly TripReason[];
  readonly deal?: DealAgainstTypical | null;
  readonly stayLink?: StayLinkOffer | null;
  readonly transferOffer?: PartnerOffer | null;
  readonly planTrips?: readonly PlanTrip[] | null;
  readonly destinationHref?: string;
  /** Whole trip or flights alone in the headline, as the toolbar chose. */
  readonly view?: 'trip' | 'flight';
  /** A trip outside the limits that is being looked at anyway. */
  readonly nearMiss?: boolean;
  /** Where "Watch this price" goes, when there is somewhere. */
  readonly watchHref?: string;
  /** "What to do in <city>", resolved by the page (it reads the places loader). */
  readonly whatToDo?: React.ReactNode;
}

// --- Words ---------------------------------------------------------------------

function nightsLabel(nights: number) {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
}

function stopsWords(leg: FlightLeg): string {
  const stops = connectionCount(leg);
  if (stops === 0) return 'Direct';
  const via = connectionsUnitemised(leg)
    ? ''
    : ` in ${leg.segments
        .slice(0, -1)
        .map((segment) => segment.destination)
        .join(', ')}`;
  return `${stops} ${stops === 1 ? 'stop' : 'stops'}${via}`;
}

function cityOf(code: string): string | null {
  return resolveAirport(code)?.municipality ?? null;
}

/** "06:10 — 07:55 · 1h 45m · Direct", or "06:10 · lands — not stated · …". */
function legLine(leg: FlightLeg): string {
  const first = leg.segments[0];
  if (!first) return '';
  const arrival = legArrival(leg);
  return `${clock(first.departsAt)} — ${arrival ? clock(arrival) : 'landing not stated'} · ${duration(leg.durationMinutes)} · ${stopsWords(leg)}`;
}

function metres(value: number): string {
  return value < 1000 ? `${Math.round(value / 50) * 50} m` : `${(value / 1000).toFixed(1)} km`;
}

/** "+ €24.00", "− €12.40", "same price": the engine's difference, signed in words. */
function deltaText(
  minorUnits: number,
  currency: string,
): Pick<ChangeOption, 'delta' | 'deltaTone'> {
  if (minorUnits === 0) return { delta: 'same price', deltaTone: 'same' };
  const formatted = format(abs(money(minorUnits, currency)));
  return minorUnits > 0
    ? { delta: `+ ${formatted}`, deltaTone: 'more' }
    : { delta: `− ${formatted}`, deltaTone: 'less' };
}

const CATEGORY_NAME: Partial<Record<CostCategory, string>> = {
  flight: 'Flights',
  flight_fees: 'Flight fees',
  hotel: 'Stay',
  hotel_fees: 'Local taxes',
  transfer: 'Airport transfer',
  local_transport: 'Getting around',
  food: 'Food',
  activities: 'Activities',
  parking: 'Parking',
  car_rental: 'Car hire',
  other: 'Other',
};

const CHECK_ICON: Record<CheckKind, IconName> = {
  bag: 'bag',
  ticket: 'ticket',
  clock: 'clock',
  cloud: 'cloud',
  bed: 'bed',
  shield: 'shield',
};

/** One sentence on what a score means, keyed off the engine's number. */
function scoreMeaning(score: number): string {
  if (score >= 80)
    return 'Among the best fits for what you asked: price, timing and stay all line up.';
  if (score >= 60) return 'A good fit for what you asked, with a trade-off or two below.';
  return 'It fits what you asked, though others may suit you better; the factors say why.';
}

// --- Options for the changer -----------------------------------------------------

function flightOptions(
  choices: readonly FlightChoice[],
  currency: string,
  hrefFor: (offerId: string) => string,
): ChangeOption[] {
  return choices.map((choice) => {
    const { flight } = choice.trip.candidate;
    const out = flight.outbound.segments[0];
    return {
      id: choice.offerId,
      href: hrefFor(choice.offerId),
      title: `Out ${legLine(flight.outbound)}`,
      lines: [
        `Back ${legLine(flight.inbound)}`,
        [...new Set(flight.outbound.segments.map((segment) => segment.flightNumber))].join(', '),
      ],
      ...deltaText(choice.totalDeltaMinorUnits, currency),
      tripTotal: `trip ${format(choice.trip.cost.total)}`,
      isCurrent: choice.isCurrent,
      eligible: choice.trip.eligibility.eligible,
      order: {
        cheapest: choice.totalDeltaMinorUnits,
        earliest: out ? minutesIntoLocalDay(out.departsAt) : null,
        fastest: flight.outbound.durationMinutes + flight.inbound.durationMinutes,
      },
    };
  });
}

function hotelOptions(
  choices: readonly Alternative[],
  currency: string,
  hrefFor: (offerId: string) => string,
): ChangeOption[] {
  return choices.flatMap((choice) => {
    const hotel = choice.trip.candidate.hotel;
    if (!hotel) return [];
    return [
      {
        id: choice.offerId,
        href: hrefFor(choice.offerId),
        title: hotel.name,
        lines: [
          [
            hotel.starRating === null ? null : `${hotel.starRating}-star`,
            hotel.reviewScore === null
              ? null
              : `${hotel.reviewScore} · ${hotel.reviewCount.toLocaleString('en-GB')} reviews`,
            hotel.distanceToCentreMetres === null
              ? null
              : `${metres(hotel.distanceToCentreMetres)} from the centre`,
          ]
            .filter(Boolean)
            .join(' · '),
          [
            hotel.freeCancellation ? 'Free cancellation' : 'Non-refundable',
            hotel.boardType === 'room_only' ? null : BOARD[hotel.boardType],
          ]
            .filter(Boolean)
            .join(' · '),
        ].filter(Boolean),
        ...deltaText(choice.totalDeltaMinorUnits, currency),
        tripTotal: `trip ${format(choice.trip.cost.total)}`,
        isCurrent: choice.isCurrent,
        eligible: choice.trip.eligibility.eligible,
        order: {
          cheapest: choice.totalDeltaMinorUnits,
          rated: hotel.reviewScore === null ? null : -hotel.reviewScore,
          closest: hotel.distanceToCentreMetres,
        },
      },
    ];
  });
}

const BOARD: Record<HotelOffer['boardType'], string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  full_board: 'Full board',
  all_inclusive: 'All inclusive',
};

// --- Pieces ----------------------------------------------------------------------

/** The card each leg sits in, with its node on the rail. */
function LegCard({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <li className="relative pl-7 sm:pl-8">
      <span
        aria-hidden="true"
        className="border-border-strong bg-surface absolute top-6 left-0 size-2.5 rounded-full border-2"
      />
      <section
        aria-labelledby={labelledBy}
        className="bg-surface-raised border-border rounded-(--radius-card) border p-4 sm:p-5"
      >
        {children}
      </section>
    </li>
  );
}

function FlightLegBody({
  leg,
  label,
  headingId,
}: {
  leg: FlightLeg;
  label: string;
  headingId: string;
}) {
  const first = leg.segments[0];
  const last = leg.segments.at(-1);
  if (!first || !last) return null;

  const arrival = legArrival(leg);
  const day = localDate(first.departsAt);
  const shift = arrival ? daysBetween(day, localDate(arrival)) : 0;
  const numbers = [...new Set(leg.segments.map((segment) => segment.flightNumber))];

  return (
    <div className="flex flex-col gap-3">
      <h3 id={headingId} className="text-dim text-[11px] font-semibold tracking-[0.16em] uppercase">
        {label} · {weekdayDate(day)}
      </h3>

      <div className="grid grid-cols-[auto_minmax(2.5rem,1fr)_auto] items-start gap-x-3 sm:gap-x-4">
        <div>
          <p className="text-ink text-2xl leading-none font-semibold tabular-nums">
            {clock(first.departsAt)}
          </p>
          <p className="text-ink-muted mt-1.5 text-xs">
            <span className="text-ink font-medium">{first.origin}</span>
            {cityOf(first.origin) ? ` ${cityOf(first.origin)}` : ''}
          </p>
        </div>

        <div className="flex flex-col items-center gap-1 pt-1">
          <span className="text-ink-muted text-xs tabular-nums">
            {duration(leg.durationMinutes)}
          </span>
          <span aria-hidden="true" className="bg-border-strong block h-px w-full" />
          <span className="text-ink-muted text-center text-xs">{stopsWords(leg)}</span>
        </div>

        <div className="text-right">
          {/* The arrival, or that nobody said: never the departure printed twice. */}
          {arrival ? (
            <p className="text-ink text-2xl leading-none font-semibold tabular-nums">
              {clock(arrival)}
              {shift > 0 ? (
                <sup className="text-caution-ink ml-0.5 text-[10px] font-semibold">
                  +{shift}
                  <span className="sr-only">{` ${shift === 1 ? 'day' : 'days'} later`}</span>
                </sup>
              ) : null}
            </p>
          ) : (
            <p className="text-ink-muted text-sm leading-6">Landing time not stated</p>
          )}
          <p className="text-ink-muted mt-1.5 text-xs">
            <span className="text-ink font-medium">{last.destination}</span>
            {cityOf(last.destination) ? ` ${cityOf(last.destination)}` : ''}
          </p>
        </div>
      </div>

      <p className="text-dim text-xs tabular-nums">Flight {numbers.join(', ')}</p>
    </div>
  );
}

/** A small round piece of our own satellite map with one pin. Regional scale: our tiles stop at zoom 4. */
function Locator({
  position,
  name,
  month,
}: {
  position: readonly [number, number];
  name: string;
  month: string;
}) {
  const tiles = tilesForWindow(position, EARTH_MAX_ZOOM, 96);
  return (
    <div
      role="img"
      aria-label={`Where ${name} is, on a regional map`}
      className="border-border relative size-24 shrink-0 overflow-hidden rounded-full border"
    >
      {tiles.map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element -- our own static tile
        <img
          key={`${tile.x}-${tile.y}`}
          src={`/geo/earth/v2/${month}/${tile.z}/${tile.x}/${tile.y}.webp`}
          alt=""
          width={256}
          height={256}
          loading="lazy"
          className="absolute max-w-none"
          style={{ left: tile.left, top: tile.top }}
        />
      ))}
      <span
        aria-hidden="true"
        className="bg-ink ring-surface absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
      />
    </div>
  );
}

function StayLegBody({
  hotel,
  nights,
  headingId,
  checkIn,
  destinationName,
  stayLink,
}: {
  hotel: HotelOffer | null;
  nights: number;
  headingId: string;
  checkIn: string;
  destinationName: string;
  stayLink: StayLinkOffer | null;
}) {
  const eyebrow = (
    <h3 id={headingId} className="text-dim text-[11px] font-semibold tracking-[0.16em] uppercase">
      Stay · {nightsLabel(nights)} from {weekdayDate(checkIn)}
    </h3>
  );

  if (!hotel) {
    return (
      <div className="flex flex-col gap-3">
        {eyebrow}
        <p className="font-display text-ink text-xl">No stay priced yet</p>
        {stayLink ? (
          <FindStayLink offer={stayLink} size="md" />
        ) : (
          <p className="text-ink-muted text-sm">
            Find a stay in {destinationName}; the total below does not include one.
          </p>
        )}
      </div>
    );
  }

  // Older cached results predate these fields; absent reads as unstated.
  const photos = hotel.photoUrls ?? [];
  const position = hotel.position ?? null;
  const area = hotel.area ?? null;
  const night = evenShare(hotel.totalPrice, nights).each;
  const facts = [
    hotel.freeCancellation ? 'Free cancellation' : 'Non-refundable',
    hotel.boardType === 'room_only' ? 'Room only' : BOARD[hotel.boardType],
    hotel.excludedFees ? `Local taxes of ${format(hotel.excludedFees)} payable there` : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="flex flex-col gap-3">
      {eyebrow}
      <div className="flex flex-col gap-4 sm:flex-row">
        <HotelGallery
          name={hotel.name}
          photos={photos}
          className="aspect-[16/10] w-full shrink-0 sm:aspect-auto sm:h-[150px] sm:w-[200px]"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="font-display text-ink text-xl leading-tight">{hotel.name}</p>
          {hotel.starRating !== null ? (
            <p className="text-ink-muted text-sm">
              <span aria-hidden="true" className="text-ink mr-1.5 tracking-[0.1em]">
                {'★'.repeat(Math.round(hotel.starRating))}
              </span>
              {Math.round(hotel.starRating)}-star hotel
            </p>
          ) : null}
          {hotel.reviewScore !== null ? (
            <p className="text-ink-muted text-sm tabular-nums">
              <span className="text-ink font-medium">{hotel.reviewScore}</span> guest score ·{' '}
              {hotel.reviewCount.toLocaleString('en-GB')} reviews
            </p>
          ) : null}
          {area || hotel.distanceToCentreMetres !== null ? (
            <p className="text-ink-muted flex items-center gap-1.5 text-sm">
              <Icon name="pin" size={0.9} aria-hidden="true" />
              {[
                area,
                hotel.distanceToCentreMetres === null
                  ? null
                  : `${metres(hotel.distanceToCentreMetres)} from the centre`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
          <ul className="text-ink-muted mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {facts.map((fact) => (
              <li key={fact} className="flex items-center gap-1">
                <Icon name="check" size={0.8} aria-hidden="true" />
                {fact}
              </li>
            ))}
          </ul>
        </div>
        {position ? (
          <Locator position={position} name={hotel.name} month={earthMonthOf(checkIn)} />
        ) : null}
      </div>
      <p className="text-ink text-sm tabular-nums">
        <span className="font-semibold">{format(hotel.totalPrice)}</span>
        <span className="text-ink-muted">
          {' '}
          for {nightsLabel(nights)} · {format(night)} a night
          {hotel.rooms !== null && hotel.rooms > 1 ? ` · ${hotel.rooms} rooms` : ''}
        </span>
      </p>
    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  line,
}: {
  id: string;
  eyebrow: string;
  title: string;
  line?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-dim text-[11px] font-semibold tracking-[0.18em] uppercase">{eyebrow}</p>
      <h3 id={id} className="font-display text-ink text-xl">
        {title}
      </h3>
      {line ? <p className="text-ink-muted text-sm">{line}</p> : null}
    </div>
  );
}

/** The score as a ring: decoration over the number, which is also in words. */
function ScoreRing({ score }: { score: number }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return (
    <span className="relative grid size-[72px] shrink-0 place-items-center">
      <svg aria-hidden="true" viewBox="0 0 72 72" className="absolute inset-0 -rotate-90">
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="4"
          className="stroke-surface-sunken"
        />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className="stroke-tint-ink"
        />
      </svg>
      <span className="text-ink text-xl font-semibold tabular-nums">{score}</span>
    </span>
  );
}

// --- The section -----------------------------------------------------------------

export function YourTrip({
  built,
  profile,
  flightHref,
  hotelHref,
  resetHref,
  calendarHref,
  reasons,
  deal = null,
  stayLink = null,
  transferOffer = null,
  planTrips = null,
  destinationHref,
  view = 'trip',
  nearMiss = false,
  watchHref,
  whatToDo = null,
}: YourTripProps) {
  const { trip } = built;
  const { candidate, cost, score, eligibility } = trip;
  const id = `trip-${candidate.id}`;
  const travellers = candidate.passengers;
  const party = travellersLabel(travellers);
  const currency = cost.total.currency;

  const headline: Money = view === 'flight' ? candidate.flight.price : cost.total;
  const each = perTraveller(headline, travellers).each;
  const exclusions = describeExclusions(costCoverage(cost.excluded).excluded);
  const checks = goodToKnow(trip);
  const season = seasonLine(
    candidate.destinationName,
    candidate.dates.departureDate,
    candidate.dates.returnDate,
    candidate.weather,
  );

  const flightLink = buildFlightHandoff(candidate.flight, { candidateId: candidate.id });
  // Two one-way tickets are two bookings: the return has its own link.
  const twoTickets = candidate.flight.ticketing === 'two_one_way';
  const returnLink =
    twoTickets && candidate.flight.returnDeepLink
      ? buildFlightHandoff(
          { ...candidate.flight, deepLink: candidate.flight.returnDeepLink },
          { candidateId: candidate.id },
        )
      : null;
  const hotelLink = candidate.hotel
    ? buildHotelHandoff(candidate.hotel, { candidateId: candidate.id })
    : null;
  const transferExcluded = cost.excluded.some((line) => line.category === 'transfer');

  const flights = flightOptions(built.flights, currency, flightHref);
  const hotels = hotelOptions(built.hotels, currency, hotelHref);
  const total = {
    amountMinor: headline.amount,
    currency,
    formatted: format(headline),
    basis: `for ${party}`,
  };

  const budgetShare =
    profile.maxBudget.amount > 0 && profile.maxBudget.currency === cost.total.currency
      ? Math.max(0, Math.min(1, ratio(cost.total, profile.maxBudget)))
      : null;

  const primary = flightLink ? (
    <Button asChild variant="cta" size="lg" className="w-full">
      <a href={flightLink.url} rel={OUTBOUND_LINK_REL} target="_blank">
        {twoTickets ? 'Book the outbound ticket' : 'Continue to book flights'}
        <span className="sr-only"> with {flightLink.providerId} (opens in a new tab)</span>
        <Icon name="arrow-right" size={1} aria-hidden="true" />
      </a>
    </Button>
  ) : (
    <p className="text-ink-muted text-sm">This provider did not supply a booking link.</p>
  );

  const panel = (headingLevel: 'h3' | 'p') => {
    const Heading = headingLevel;
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <Heading className="text-dim text-[11px] font-semibold tracking-[0.18em] uppercase">
            {view === 'flight' ? `Flights for ${party}` : `Total for ${party}`}
          </Heading>
          <p className="text-ink text-[2.25rem] leading-none font-semibold tracking-tight">
            <span className="text-ink-muted mr-1.5 align-middle text-sm font-normal">from</span>
            <TripTotal {...total} announce={headingLevel === 'h3'} />
          </p>
          <p className="text-ink-muted text-sm tabular-nums">{format(each)} per person</p>
        </div>

        <dl className="flex flex-col gap-1.5 text-sm">
          {cost.byCategory.map((entry) => {
            const estimated = entry.lines.some((line) => line.confidence === 'estimated');
            return (
              <div key={entry.category} className="flex items-baseline gap-2">
                <dt className="text-ink-muted shrink-0">
                  {CATEGORY_NAME[entry.category] ?? entry.category}
                  {estimated ? <span className="text-caution-ink"> estimate</span> : null}
                </dt>
                <span
                  aria-hidden="true"
                  className="border-border-strong mb-1 flex-1 border-b border-dotted"
                />
                <dd
                  className={cn('tabular-nums', estimated ? 'text-ink-muted italic' : 'text-ink')}
                >
                  {estimated ? '~' : ''}
                  {format(entry.amount)}
                </dd>
              </div>
            );
          })}
        </dl>

        {exclusions ? (
          <p className="text-ink text-sm">
            <span className="text-caution-ink font-medium">Not included: </span>
            {exclusions.replace(/^Flights only — /, '').replace(/ not included$/, '')}.
          </p>
        ) : (
          <p className="text-ink-muted text-sm">Everything we know to cost money is counted.</p>
        )}

        {budgetShare !== null ? (
          <div className="flex flex-col gap-1.5">
            <span
              aria-hidden="true"
              className="bg-surface-sunken block h-1.5 overflow-hidden rounded-full"
            >
              <span
                className={cn(
                  'block h-full rounded-full',
                  eligibility.budgetHeadroom.amount >= 0 ? 'bg-positive-ink' : 'bg-critical-ink',
                )}
                style={{ width: `${Math.round(budgetShare * 100)}%` }}
              />
            </span>
            <p
              className={cn(
                'text-sm tabular-nums',
                eligibility.budgetHeadroom.amount >= 0 ? 'text-positive-ink' : 'text-critical-ink',
              )}
            >
              {eligibility.budgetHeadroom.amount >= 0
                ? `${format(eligibility.budgetHeadroom)} under your maximum`
                : `${format(abs(eligibility.budgetHeadroom))} over your maximum`}{' '}
              <span className="text-ink-muted">of {format(profile.maxBudget)}</span>
            </p>
          </div>
        ) : null}

        <DealNote deal={deal} />

        {built.customised ? (
          <p className="text-ink-muted text-sm">
            <span className="text-ink font-medium">Built by you. </span>
            {built.deltaFromOriginal
              ? built.deltaFromOriginal.amount === 0
                ? 'Same total as the trip you started from.'
                : `${format(abs(built.deltaFromOriginal))} ${
                    built.deltaFromOriginal.amount < 0 ? 'cheaper' : 'more'
                  } than the trip you started from.`
              : 'The trip you started from was priced in another currency.'}{' '}
            <a
              href={resetHref}
              className="text-tint-ink inline-flex min-h-11 items-center font-medium underline underline-offset-4"
            >
              Back to the original
            </a>
          </p>
        ) : null}

        {primary}

        <ul className="divide-border border-border flex flex-col divide-y border-t text-sm">
          {returnLink ? (
            <li className="py-2">
              <a
                href={returnLink.url}
                rel={OUTBOUND_LINK_REL}
                target="_blank"
                className="text-ink inline-flex min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
              >
                Book the return ticket with {returnLink.providerId}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ) : null}
          {hotelLink ? (
            <li className="py-2">
              <a
                href={hotelLink.url}
                rel={OUTBOUND_LINK_REL}
                target="_blank"
                className="text-ink inline-flex min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
              >
                Book the hotel with {hotelLink.providerId}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ) : null}
          {!candidate.hotel && stayLink ? (
            <li className="py-2">
              <FindStayLink offer={stayLink} size="md" />
            </li>
          ) : null}
          {transferExcluded && transferOffer ? (
            <li className="flex flex-col gap-1 py-2">
              <PartnerOfferRow offer={transferOffer} />
              {planTrips ? (
                <AddToPlan
                  offerId={transferOffer.id}
                  trips={planTrips}
                  partner={transferOffer.partner}
                />
              ) : null}
            </li>
          ) : null}
          {watchHref ? (
            <li className="py-2">
              <a
                href={watchHref}
                className="text-ink inline-flex min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline"
              >
                <Icon name="bell" size={0.95} aria-hidden="true" />
                Watch this price
              </a>
            </li>
          ) : null}
        </ul>
      </div>
    );
  };

  return (
    <article
      id={`${id}-section`}
      aria-labelledby={`${id}-heading`}
      data-tint={tintFor(candidate.destination)}
      className="flex flex-col gap-6"
    >
      <header className="flex flex-col gap-1.5">
        <p className="text-dim text-[11px] font-semibold tracking-[0.18em] uppercase">
          {nearMiss ? 'Close, but outside your limits' : 'Your trip'}
        </p>
        <h2 id={`${id}-heading`} className="font-display text-ink text-display-sm">
          {destinationHref ? (
            <a href={destinationHref} className="underline-offset-4 hover:underline">
              Your trip to {candidate.destinationName}
            </a>
          ) : (
            `Your trip to ${candidate.destinationName}`
          )}
        </h2>
        <p className="text-ink-muted text-sm tabular-nums">
          {weekdayDate(candidate.dates.departureDate)} → {weekdayDate(candidate.dates.returnDate)} ·{' '}
          {nightsLabel(candidate.dates.nights)} · {party}
          {twoTickets ? ' · two one-way tickets' : ''}
        </p>
        {season ? (
          <p className="text-ink-muted flex items-center gap-1.5 text-sm">
            <Icon name={season.typical ? 'cloud' : 'sun'} size={0.95} aria-hidden="true" />
            {season.text}
            <span className="text-dim text-xs">
              {season.typical ? `· ${TYPICAL_LABEL.toLowerCase()}` : '· forecast'}
            </span>
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-8">
          {eligibility.violations.length > 0 ? (
            <div className="border-critical-500/30 bg-critical-500/10 rounded-(--radius-control) border p-3">
              <p className="text-critical-ink text-sm font-medium">Outside what you asked for</p>
              <ul className="mt-1 flex flex-col gap-1">
                {eligibility.violations.map((violation) => (
                  <li key={violation.code} className="text-ink text-sm">
                    {violation.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* The journey: three cards on one rail. */}
          <ol aria-label="The trip, in order" className="relative flex flex-col gap-3">
            <span
              aria-hidden="true"
              className="bg-border-strong absolute top-7 bottom-7 left-[4.5px] w-px"
            />
            <LegCard labelledBy={`${id}-out`}>
              <LegChanger
                what="outbound flight"
                param="tFlight"
                options={flights}
                sorts={[
                  { id: 'cheapest', label: 'Cheapest' },
                  { id: 'earliest', label: 'Earliest' },
                  { id: 'fastest', label: 'Fastest' },
                ]}
                emptyText="No other flights for these dates"
                emptyHref={calendarHref}
              >
                <FlightLegBody
                  leg={candidate.flight.outbound}
                  label="Outbound"
                  headingId={`${id}-out`}
                />
              </LegChanger>
            </LegCard>

            <LegCard labelledBy={`${id}-stay`}>
              {candidate.hotel ? (
                <LegChanger
                  what="stay"
                  param="tHotel"
                  options={hotels}
                  sorts={[
                    { id: 'cheapest', label: 'Cheapest' },
                    { id: 'rated', label: 'Best rated' },
                    { id: 'closest', label: 'Closest to the centre' },
                  ]}
                  emptyText="No other stays for these dates"
                  emptyHref={calendarHref}
                >
                  <StayLegBody
                    hotel={candidate.hotel}
                    nights={candidate.dates.nights}
                    headingId={`${id}-stay`}
                    checkIn={candidate.dates.departureDate}
                    destinationName={candidate.destinationName}
                    stayLink={stayLink}
                  />
                </LegChanger>
              ) : (
                <StayLegBody
                  hotel={null}
                  nights={candidate.dates.nights}
                  headingId={`${id}-stay`}
                  checkIn={candidate.dates.departureDate}
                  destinationName={candidate.destinationName}
                  stayLink={stayLink}
                />
              )}
            </LegCard>

            <LegCard labelledBy={`${id}-back`}>
              <LegChanger
                what="return flight"
                param="tFlight"
                options={flights}
                sorts={[
                  { id: 'cheapest', label: 'Cheapest' },
                  { id: 'earliest', label: 'Earliest' },
                  { id: 'fastest', label: 'Fastest' },
                ]}
                emptyText="No other flights for these dates"
                emptyHref={calendarHref}
              >
                <FlightLegBody
                  leg={candidate.flight.inbound}
                  label="Return"
                  headingId={`${id}-back`}
                />
              </LegChanger>
            </LegCard>
          </ol>

          {whatToDo}

          {/* Good to know: what to check, one line each. */}
          <section aria-labelledby={`${id}-know`} className="flex flex-col gap-3">
            <SectionHeading id={`${id}-know`} eyebrow="Before you pay" title="Good to know" />
            {checks.length === 0 ? (
              <p className="text-ink-muted text-sm">Nothing on this trip needs checking.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {checks.map((item) => (
                  <li key={item.key} className="text-ink flex items-start gap-2.5 text-sm">
                    <Icon
                      name={CHECK_ICON[item.kind]}
                      size={1}
                      aria-hidden="true"
                      className="text-ink-muted mt-0.5 shrink-0"
                    />
                    <span>
                      <span className="sr-only">
                        {item.certainty === 'check' ? 'To check: ' : 'Known: '}
                      </span>
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Disclosure summary="Why we flag these" className="border-0 bg-transparent p-0">
              <p className="text-ink-muted text-sm">
                These are what people most often discover too late: a bag that was not included, two
                tickets that do not protect each other, a time that makes a day shorter. We list a
                fact as something to check whenever the provider did not state it, rather than
                guessing that it is fine.
              </p>
            </Disclosure>
          </section>

          {/* Why this trip: the engine's reasons, then its score and how it adds up. */}
          <section aria-labelledby={`${id}-why`} className="flex flex-col gap-4">
            <SectionHeading id={`${id}-why`} eyebrow="The score" title="Why this trip?" />
            {reasons.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {reasons.map((reason) => (
                  <li
                    key={reason.source}
                    className="border-border text-ink inline-flex items-center gap-1.5 rounded-(--radius-pill) border px-3 py-1 text-sm"
                  >
                    <Icon name="check" size={0.85} aria-hidden="true" className="text-ink-muted" />
                    {reason.text.charAt(0).toUpperCase() + reason.text.slice(1)}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-4">
              <ScoreRing score={score.score} />
              <div className="flex flex-col gap-0.5">
                <p className="text-ink text-sm font-medium">
                  <span className="sr-only">Trip score </span>
                  {score.score} out of 100
                </p>
                <p className="text-ink-muted text-sm">{scoreMeaning(score.score)}</p>
              </div>
            </div>
            <Disclosure summary={`How the score of ${score.score} adds up`}>
              <ScoreExplanation score={score} headingId={`${id}-why`} />
            </Disclosure>
            <Disclosure summary="Full cost breakdown">
              <CostBreakdown
                cost={cost}
                passengers={candidate.passengers}
                nights={candidate.dates.nights}
                rooms={candidate.hotel?.rooms ?? null}
              />
            </Disclosure>
          </section>
        </div>

        <aside
          aria-label="Trip summary"
          className="bg-surface-raised border-border hidden self-start rounded-(--radius-card) border p-5 lg:sticky lg:top-[calc(var(--voyagr-header-h,4.5rem)+5.5rem)] lg:block"
        >
          {panel('h3')}
        </aside>
      </div>

      <SummaryBar
        watchId={`${id}-section`}
        total={total}
        perPerson={`${format(each)} per person`}
        action={
          flightLink ? (
            <Button asChild variant="cta" size="md">
              <a href={flightLink.url} rel={OUTBOUND_LINK_REL} target="_blank">
                Book flights
                <span className="sr-only"> with {flightLink.providerId} (opens in a new tab)</span>
              </a>
            </Button>
          ) : null
        }
        panel={panel('p')}
      />
    </article>
  );
}
