import { format } from '@/core/money';
import { Button, Container, Icon, Media } from '@/components/ui';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import type { RankedTrip } from '@/search/types';
import { shortDate } from '@/lib/display-date';

/**
 * What to do next, as three panels.
 *
 * The page opens on a snapshot that has already priced whole trips, and until
 * now it showed only the places. This band shows the best trip in that same
 * snapshot - not a second search dressed as a recommendation. Everything on
 * it was produced by the engines: the total by `trip/cost.ts`, the score by
 * `scoring.ts`, the nights by the date arithmetic in `core/dates.ts`. This
 * file chooses words and a layout, and no figures.
 *
 * The photographs name what they show, because a picture used as decoration
 * that a reader takes for the destination is a claim nobody meant to make.
 */

export interface BandPicture {
  readonly code: string;
  /** What the photograph is of. Printed, not just used as alternative text. */
  readonly name: string;
  readonly image: DestinationImage | null;
}

export interface NextTripBandProps {
  /** The best trip in the snapshot, or null when nothing was priced. */
  trip: RankedTrip | null;
  /** Where the trip's own search lives. */
  tripHref: string;
  /** The picture beside the trip. */
  tripPicture: BandPicture | null;
  /** The two editorial panels' pictures. */
  wide: BandPicture | null;
  tall: BandPicture | null;
  exploreHref: string;
  provenance: DataProvenance;
  /** Who supplied each part, so the badge can say which price is real. */
  sources?: readonly SourceAttribution[];
}

/**
 * A photograph with its wash underneath, or just the wash.
 *
 * Through `Media`, so a place is the same colour here as it is on the rail
 * and on its result card. It had its own copy of the derivation, and a
 * fractionally different gradient, which is how one destination ended up
 * with two identities on one page.
 */
function Picture({ picture, className = '' }: { picture: BandPicture | null; className?: string }) {
  if (!picture) return null;

  return (
    <Media
      aria-hidden="true"
      seed={picture.code}
      image={picture.image ? { url: imageryUrlFor(picture.code), alt: '' } : null}
      scrim="stage"
      className={`absolute inset-0 -z-10 ${className}`}
    />
  );
}

/** "Pictured: Chania, Crete" - so a photograph never stands in for a place. */
function Caption({ picture }: { picture: BandPicture | null }) {
  if (!picture?.image) return null;

  return (
    <p className="text-stage-ink-muted/80 absolute right-4 bottom-3 text-[0.68rem]">
      Pictured: {picture.name}
    </p>
  );
}

export function NextTripBand({
  trip,
  tripHref,
  tripPicture,
  wide,
  tall,
  exploreHref,
}: NextTripBandProps) {
  return (
    <section
      aria-labelledby="next-trip-heading"
      className="stage-scope bg-stage text-stage-ink relative isolate"
    >
      <h2 id="next-trip-heading" className="sr-only">
        Where to go next
      </h2>

      <Container size="wide" className="pb-16">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]">
          {/* The invitation. */}
          <article className="border-stage-glass-border relative isolate flex min-h-[19rem] flex-col justify-end overflow-hidden rounded-(--radius-shell) border p-7">
            <Picture picture={wide} />

            {/*
              White, not `--muted`, because this line sits on a photograph
              and a photograph can be a bright sky. The muted token is right
              against a surface whose colour we chose and wrong against one
              we did not.
            */}
            <p className="text-xs font-semibold tracking-[0.2em] text-white/75 uppercase">
              The next adventure awaits
            </p>
            <h3 className="font-display text-display-sm mt-2 max-w-[14ch] text-balance">
              Explore the world your way
            </h3>
            <p className="mt-2 max-w-sm text-sm text-white/80">
              Turn the globe, open a country, and see what a whole trip there actually costs -
              flights, a hotel and the ride from the airport, together.
            </p>

            <Button
              asChild
              variant="cta"
              shape="pill"
              className="ease-standard duration-quick mt-5 w-fit transition-[filter,transform] hover:brightness-110 motion-safe:hover:-translate-y-0.5"
            >
              <a href={exploreHref}>
                Start exploring
                <Icon name="arrow-right" size={0.95} />
              </a>
            </Button>

            <Caption picture={wide} />
          </article>

          {/* The recommendation, out of the snapshot already on this page. */}
          <article className="voyagr-panel flex min-h-[19rem] flex-col gap-4 overflow-hidden rounded-(--radius-shell) p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Icon name="sparkle" size={0.95} className="text-stage-accent" />
              Your next trip
            </h3>

            {trip ? (
              <div className="border-stage-glass-border bg-stage/60 flex flex-1 flex-col gap-3 rounded-(--radius-card) border p-3">
                <div className="flex gap-3">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-(--radius-control)">
                    <Picture picture={tripPicture} className="-z-0" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-stage-ink font-medium">{trip.candidate.destinationName}</p>
                    <p className="text-stage-ink-muted mt-0.5 text-sm">
                      {shortDate(trip.candidate.dates.departureDate)} -{' '}
                      {shortDate(trip.candidate.dates.returnDate)} ·{' '}
                      {trip.candidate.passengers === 1
                        ? '1 traveller'
                        : `${trip.candidate.passengers} travellers`}
                    </p>
                    <p className="text-stage-accent mt-1.5 text-xs font-semibold">
                      Scores {trip.score.score} out of 100
                    </p>
                  </div>
                </div>

                <p className="text-stage-ink font-display text-3xl leading-none tabular-nums">
                  {format(trip.cost.total)}
                </p>

                <ul className="text-stage-ink-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <li className="flex items-center gap-1.5">
                    <Icon name="plane" />
                    Flights
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Icon name="bed" />
                    Hotel
                  </li>
                  {trip.candidate.transfer ? (
                    <li className="flex items-center gap-1.5">
                      <Icon name="car" />
                      Transfer
                    </li>
                  ) : null}
                  <li className="flex items-center gap-1.5">
                    <Icon name="calendar" />
                    {trip.candidate.dates.nights}{' '}
                    {trip.candidate.dates.nights === 1 ? 'night' : 'nights'}
                  </li>
                </ul>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={tripHref}
                    className="text-stage-ink hover:text-stage-accent ease-standard duration-quick inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
                  >
                    See this trip
                    <Icon name="arrow-right" size={0.9} />
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-stage-ink-muted flex-1 text-sm">
                Nothing is priced just now, so there is no trip to put here. Run a search and this
                becomes the best one it found.
              </p>
            )}
          </article>

          {/* The way back to the globe. */}
          <article className="border-stage-glass-border relative isolate flex min-h-[19rem] flex-col justify-end overflow-hidden rounded-(--radius-shell) border p-6">
            <Picture picture={tall} />

            <h3 className="font-display text-2xl leading-tight text-balance">
              More adventures near you
            </h3>
            {/* On a photograph, like the panel on the left. */}
            <p className="mt-2 text-sm text-white/80">
              Every place the catalogue can price, on one globe, with what the trip costs on it.
            </p>

            <a
              href={exploreHref}
              className="border-stage-glass-border bg-stage-glass text-stage-ink ease-standard duration-quick focus-visible:outline-stage-accent mt-4 grid size-10 place-items-center rounded-full border backdrop-blur-sm transition-colors hover:border-(--color-stage-accent)"
            >
              <Icon name="arrow-right" size={0.95} />
              <span className="sr-only">Open the explorer</span>
            </a>

            <Caption picture={tall} />
          </article>
        </div>
      </Container>
    </section>
  );
}
