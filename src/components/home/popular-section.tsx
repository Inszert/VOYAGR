import { Button, Container, EmptyState, Icon } from '@/components/ui';
import type { Country } from '@/discovery/countries';
import { MAP_MODE_LABELS, type MapMode } from '@/discovery/map-model';
import type { DiscoveryAssumptions } from '@/discovery/snapshot';
import { shortDate } from '@/lib/display-date';
import type { HomeCard } from './card-data';
import { DestinationCard } from './destination-card';
import { mosaicCount, mosaicSlots, type MosaicSlot } from './mosaic';
import { RankControls, type RankControlsProps } from './rank-controls';
import { ScrollButtons } from './scroll-buttons';
import './home.css';

/**
 * "Popular right now": the destinations, as a magazine spread.
 *
 * Every chip on the globe is a card here, in the same order, so "where can I
 * go?" is answered without a canvas. Section 14 asks that the ranking not be
 * hidden, so each card says (to a screen reader) why it sits where it does.
 *
 * Desktop is an editorial mosaic - one lead tile and its companions - for the
 * counts that fill twelve columns exactly (3, 5, 6, 8). Any other count, and
 * every phone, is a snap rail. Whatever the mosaic does not take goes to the
 * "From {city} tonight" rail underneath, so nothing the globe shows is ever
 * reachable only by spinning.
 *
 * The page computes nothing: the ranking, the labels and the figures arrived
 * from `src/discovery` and `src/core`.
 */

export interface PopularSectionProps {
  cards: readonly HomeCard[];
  /** How many destinations there are before narrowing to a country. */
  totalCount: number;
  mode: MapMode;
  /** Present for the front page's snapshot. */
  assumptions?: DiscoveryAssumptions | null;
  country?: Country | null;
  regionSummary?: string | null;
  /** A link back to the whole world, when narrowed. */
  clearHref?: string;
  /** Prices could not be produced at all; the section says so rather than pretending. */
  unpriced?: boolean;
  /**
   * The departure has priced trips, whether or not any of them could be placed as a card. The
   * "nothing priced" message is only true when this is false.
   */
  hasPricedTrips?: boolean;
  /** With `unpriced`: nothing is cached yet and the worker is filling it, not a failure. */
  pricesLoading?: boolean;
  viewAllHref?: string;
  /** The home airport's city, for "From Vienna tonight" and the empty state. */
  originName: string | null;
  controls: RankControlsProps;
}

function describe(assumptions: DiscoveryAssumptions): string {
  const party =
    assumptions.passengers === 1 ? '1 traveller' : `${assumptions.passengers} travellers`;
  const nights =
    assumptions.minNights === assumptions.maxNights
      ? `${assumptions.minNights} nights`
      : `${assumptions.minNights} to ${assumptions.maxNights} nights`;

  return `Priced for ${party} from ${assumptions.origins.join(', ')}, ${nights}, ${shortDate(assumptions.earliestDeparture)} to ${shortDate(assumptions.latestReturn)}, in ${assumptions.currency}.`;
}

/**
 * The one label a card may wear, from why it is where it is.
 *
 * Derived from the ranking rather than chosen: the first card in "cheapest" is
 * the cheapest, and saying so repeats the engine instead of editorialising.
 */
function chipFor(index: number, mode: MapMode): string | null {
  if (index === 0) return MAP_MODE_LABELS[mode];
  if (index === 1) return 'Runner-up';
  if (index === 2) return 'Third';

  return null;
}

/** `sizes` for each slot at the widths the layout gives it. */
const SIZES: Record<MosaicSlot | 'rail', string> = {
  lead: '(min-width: 1280px) 645px, (min-width: 1024px) 55vw, (min-width: 640px) 340px, 78vw',
  five: '(min-width: 1280px) 455px, (min-width: 1024px) 40vw, (min-width: 640px) 340px, 78vw',
  four: '(min-width: 1280px) 360px, (min-width: 1024px) 32vw, (min-width: 640px) 340px, 78vw',
  six: '(min-width: 1280px) 550px, (min-width: 1024px) 48vw, (min-width: 640px) 340px, 78vw',
  rail: '(min-width: 640px) 340px, 78vw',
};

export function PopularSection({
  cards,
  totalCount,
  mode,
  assumptions = null,
  country = null,
  regionSummary = null,
  clearHref,
  unpriced = false,
  hasPricedTrips = false,
  pricesLoading = false,
  viewAllHref,
  originName,
  controls,
}: PopularSectionProps) {
  const inMosaic = mosaicCount(cards.length);
  const slots = mosaicSlots(inMosaic);
  /* Fewer than three: the rail carries them all and there is no second rail. */
  const lead = inMosaic > 0 ? cards.slice(0, inMosaic) : cards;
  const more = inMosaic > 0 ? cards.slice(inMosaic) : [];

  return (
    <section
      aria-labelledby="rail-heading"
      className="home-scope text-ink bg-surface relative isolate"
    >
      <Container size="wide" className="flex flex-col gap-8 py-10 lg:gap-10 lg:py-16">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="max-w-[34rem]">
            <p className="text-brand-ink text-[0.6875rem] font-medium tracking-[0.16em] uppercase">
              {country ? country.name : 'Popular right now'}
            </p>

            <h2
              id="rail-heading"
              className="font-display text-display-sm sm:text-display-md mt-3 max-w-[22ch] text-balance"
            >
              {country
                ? cards.length === 0
                  ? `Nothing priced in ${country.name} yet`
                  : `${cards.length} ${cards.length === 1 ? 'place' : 'places'} priced in ${country.name}`
                : totalCount === 0
                  ? 'Where you can go'
                  : `${totalCount} ${totalCount === 1 ? 'destination' : 'destinations'}, ranked by ${MAP_MODE_LABELS[mode].toLowerCase()}`}
            </h2>

            <p className="text-ink-muted mt-3 text-sm leading-relaxed">
              {assumptions
                ? describe(assumptions)
                : 'Each price is the cheapest whole trip we could build to that place - flights, a hotel and the ride from the airport, together.'}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3 lg:items-end">
            <RankControls {...controls} />

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              {country && clearHref ? (
                <a
                  href={clearHref}
                  className="text-ink-muted hover:text-ink ease-standard duration-quick inline-flex min-h-11 items-center gap-1.5 text-[13px] transition-colors lg:min-h-8"
                >
                  Show the whole world
                  {totalCount > cards.length ? ` (${totalCount})` : ''}
                  <Icon name="arrow-right" size={1} className="size-[14px]" />
                </a>
              ) : null}

              {viewAllHref ? (
                <a
                  href={viewAllHref}
                  className="text-ink-muted hover:text-ink ease-standard duration-quick inline-flex min-h-11 items-center gap-1.5 text-[13px] transition-colors lg:min-h-8"
                >
                  Open the explorer
                  <Icon name="arrow-right" size={1} className="size-[14px]" />
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {unpriced ? (
          <p role="status" className="text-ink-muted text-[13px]">
            {pricesLoading
              ? 'Prices are not loaded yet. The globe shows these places without them.'
              : 'Prices could not be produced just now, so the globe shows places without them. Try again in a moment, or run a search.'}
          </p>
        ) : null}

        {country && cards.length === 0 && !unpriced ? (
          <p className="text-ink-muted text-[13px]">
            The catalogue has no airport in {country.name} yet, so nothing there can be priced.
            Adding one is a catalogue entry, not a code change - and a dot placed somewhere
            plausible in the meantime would be an invented fact.
          </p>
        ) : null}

        {!country && cards.length === 0 && !unpriced && !hasPricedTrips ? (
          <EmptyState
            title={originName ? `Nothing priced from ${originName} yet` : 'Nothing priced yet'}
            description="Try another airport or different dates, and the places we can price will appear here."
            action={
              <Button asChild variant="secondary" shape="pill">
                <a href={viewAllHref ?? '/explore'}>
                  Open the search
                  <Icon name="arrow-right" size={0.95} />
                </a>
              </Button>
            }
          />
        ) : null}

        {!country && cards.length === 0 && !unpriced && hasPricedTrips ? (
          <p role="status" className="text-ink-muted text-[13px]">
            {originName ? `Trips from ${originName} are priced` : 'Trips are priced'}, but none of
            their places could be shown here yet. Open the explorer to see them.
          </p>
        ) : null}

        {cards.length > 0 ? (
          /*
            One list, two shapes. Below 1024px it is a snap rail; at 1024px
            and up, when the count fills the grid, it is the mosaic. Named,
            because this section also holds the ranking controls, which are a
            list as well.
          */
          <ol
            aria-label="Destinations"
            className={inMosaic > 0 ? 'home-rail home-mosaic' : 'home-rail'}
          >
            {lead.map((card, index) => {
              const slot = inMosaic > 0 ? slots[index] : undefined;

              return (
                <DestinationCard
                  key={card.code}
                  card={card}
                  variant={slot === 'lead' ? 'lead' : slot === 'six' ? 'wide' : 'tile'}
                  slot={slot}
                  chip={chipFor(index, mode)}
                  index={index}
                  parallax={inMosaic > 0}
                  sizes={SIZES[slot ?? 'rail']}
                />
              );
            })}
          </ol>
        ) : null}

        {more.length > 0 ? (
          <div className="flex flex-col gap-5 pt-2 lg:pt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 id="tonight-heading" className="font-display text-display-sm">
                  {originName ? `From ${originName} tonight` : 'More places to go'}
                </h3>
                <p className="text-ink-muted mt-1.5 text-sm">
                  The rest of the ranking, in the same order.
                </p>
              </div>

              <ScrollButtons targetId="more-destinations" noun="destinations" />
            </div>

            <ol id="more-destinations" aria-labelledby="tonight-heading" className="home-rail">
              {more.map((card, index) => (
                <DestinationCard
                  key={card.code}
                  card={card}
                  variant="tall"
                  index={index}
                  sizes="320px"
                />
              ))}
            </ol>
          </div>
        ) : null}

        {/*
          What the product knows about an open country, which today is where it
          is and what shape its regions are. Said out loud rather than left for
          a reader to infer from an empty map.
        */}
        {country ? (
          <dl className="border-border grid gap-x-8 gap-y-2 border-t pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-dim">Where it is</dt>
              <dd className="text-ink">
                {country.subregion}, {country.continent}
              </dd>
            </div>
            <div>
              <dt className="text-dim">On the globe</dt>
              <dd className="text-ink">
                {regionSummary ? `${regionSummary}, drawn as outlines` : 'Its outline only'}
              </dd>
            </div>
            <div>
              <dt className="text-dim">What we can price</dt>
              <dd className="text-ink">
                {cards.length === 0
                  ? 'Nothing yet'
                  : `${cards.length} ${cards.length === 1 ? 'airport' : 'airports'}`}
              </dd>
            </div>
          </dl>
        ) : null}

        {/*
          A note, at the weight of a note. Sections 13 and 14 list more than
          this can answer, and naming the gap beats a control that silently
          matches everything.
        */}
        <p className="border-border text-dim max-w-[720px] border-t pt-6 text-xs leading-relaxed">
          Flights only for now - trains, buses, ferries and driving need providers this product does
          not have yet, and so do the seasonal and &ldquo;most interesting&rdquo; rankings. The
          globe shows where we can actually price a trip.
        </p>
      </Container>
    </section>
  );
}
