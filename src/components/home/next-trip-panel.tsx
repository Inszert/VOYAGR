import { format } from '@/core/money';
import { Button, Container, Icon } from '@/components/ui';
import type { RankedTrip } from '@/search/types';
import { shortDate } from '@/lib/display-date';
import './home.css';

/**
 * "Your next trip": the best whole trip in the snapshot, as one panel.
 *
 * The page opens on a snapshot that has already priced whole trips; this shows
 * the best of them rather than running a second search dressed as a
 * recommendation. Everything on it was produced by the engines - the total by
 * `trip/cost.ts`, the score by `scoring.ts`, the nights by `core/dates.ts`.
 * This file chooses words and a layout.
 *
 * It is drawn only when there is such a trip. And it says what the total does
 * not hold: an estimate is named as one, and a cost left out is listed - a
 * missing transfer found at the airport is the failure this product exists to
 * prevent.
 */

export interface NextTripPanelProps {
  trip: RankedTrip | null;
  tripHref: string;
  exploreHref: string;
}

export function NextTripPanel({ trip, tripHref, exploreHref }: NextTripPanelProps) {
  if (!trip) return null;

  const { candidate, cost, score } = trip;
  const nights = candidate.dates.nights;
  const estimated = cost.estimatedTotal.amount > 0;
  const left = [...new Set(cost.excluded.map((line) => line.label))];

  return (
    <section aria-labelledby="next-trip-heading" className="home-scope bg-surface">
      <Container size="wide" className="pb-10 lg:pb-16">
        <div className="border-border bg-surface-raised grid overflow-hidden rounded-(--radius-shell) border lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex flex-col gap-5 p-6 lg:p-9">
            <h2
              id="next-trip-heading"
              className="text-brand-ink text-[0.6875rem] font-medium tracking-[0.16em] uppercase"
            >
              Your next trip
            </h2>

            <div>
              <p className="font-display text-display-sm">{candidate.destinationName}</p>
              <p className="text-ink-muted mt-1 text-sm">
                {shortDate(candidate.dates.departureDate)} &ndash;{' '}
                {shortDate(candidate.dates.returnDate)} &middot; {nights}{' '}
                {nights === 1 ? 'night' : 'nights'} &middot;{' '}
                {candidate.passengers === 1 ? '1 traveller' : `${candidate.passengers} travellers`}
              </p>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <p className="font-display text-ink text-4xl leading-none tabular-nums">
                {format(cost.total)}
              </p>
              <p className="text-ink-muted text-sm">Scores {score.score} out of 100</p>
            </div>

            <ul className="text-ink-muted flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              <li className="flex items-center gap-1.5">
                <Icon name="plane" />
                Flights
              </li>
              <li className="flex items-center gap-1.5">
                <Icon name="bed" />
                Hotel
              </li>
              {candidate.transfer ? (
                <li className="flex items-center gap-1.5">
                  <Icon name="car" />
                  Transfer
                </li>
              ) : null}
            </ul>

            {estimated ? (
              <p className="text-caution-ink text-[0.8125rem]">
                Includes {format(cost.estimatedTotal)} that is estimated, not quoted.
              </p>
            ) : null}
            {left.length > 0 ? (
              <p className="text-caution-ink text-[0.8125rem]">
                Not in this total: {left.join(', ').toLowerCase()}.
              </p>
            ) : null}

            <a
              href={tripHref}
              className="text-ink hover:text-brand-ink ease-standard duration-quick inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium transition-colors"
            >
              See this trip
              <Icon name="arrow-right" size={0.9} />
            </a>
          </div>

          <div className="border-border flex flex-col justify-center gap-4 border-t p-6 lg:border-t-0 lg:border-l lg:p-9">
            <h3 className="font-display text-display-sm text-balance">
              Explore the world your way
            </h3>
            <p className="text-ink-muted max-w-sm text-sm leading-relaxed">
              Turn the globe, open a country, and see what a whole trip there actually costs -
              flights, a hotel and the ride from the airport, together.
            </p>
            <Button asChild variant="cta" shape="pill" className="w-fit">
              <a href={exploreHref}>
                Start exploring
                <Icon name="arrow-right" size={0.95} />
              </a>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
