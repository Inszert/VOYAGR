import { format } from '@/core/money';
import { Container, Icon, ProvenanceBadge } from '@/components/ui';
import type { DataProvenance } from '@/core/trip/provenance';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import type { RankedTrip } from '@/search/types';

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * e.g. "6 Jun". Read off the ISO string rather than through `Date`, which is
 * how a trip that leaves on the sixth starts showing the fifth west of
 * Greenwich.
 */
function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

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
}

/** A photograph with its wash underneath, or just the wash. */
function Picture({ picture, className = '' }: { picture: BandPicture | null; className?: string }) {
  if (!picture) return null;

  const hue =
    [...picture.code].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return (
    <div aria-hidden="true" className={`absolute inset-0 -z-10 ${className}`}>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(150deg, oklch(0.5 0.13 ${hue}) 0%, oklch(0.25 0.08 ${(hue + 40) % 360}) 70%)`,
        }}
      />
      {picture.image ? (
        <img
          src={imageryUrlFor(picture.code)}
          alt=""
          width={picture.image.width}
          height={picture.image.height}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <div className="from-stage via-stage/70 absolute inset-0 bg-gradient-to-t to-transparent" />
    </div>
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
  provenance,
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
          <article className="border-stage-glass-border relative isolate flex min-h-[19rem] flex-col justify-end overflow-hidden rounded-[--radius-shell] border p-7">
            <Picture picture={wide} />

            <p className="text-stage-ink-muted text-xs font-semibold tracking-[0.2em] uppercase">
              The next adventure awaits
            </p>
            <h3 className="font-display text-display-sm mt-2 max-w-[14ch] text-balance">
              Explore the world your way
            </h3>
            <p className="text-stage-ink-muted mt-2 max-w-sm text-sm">
              Turn the globe, open a country, and see what a whole trip there actually costs -
              flights, a hotel and the ride from the airport, together.
            </p>

            <a
              href={exploreHref}
              className="voyagr-cta ease-standard duration-quick focus-visible:outline-stage-accent mt-5 inline-flex w-fit items-center gap-2 rounded-[--radius-pill] px-5 py-2.5 text-sm font-semibold transition-[filter,transform] hover:brightness-110 motion-safe:hover:-translate-y-0.5"
            >
              Start exploring
              <Icon name="arrow-right" size={0.95} />
            </a>

            <Caption picture={wide} />
          </article>

          {/* The recommendation, out of the snapshot already on this page. */}
          <article className="voyagr-panel flex min-h-[19rem] flex-col gap-4 overflow-hidden rounded-[--radius-shell] p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Icon name="sparkle" size={0.95} className="text-stage-accent" />
              Your next trip
            </h3>

            {trip ? (
              <div className="border-stage-glass-border bg-stage/60 flex flex-1 flex-col gap-3 rounded-[--radius-card] border p-3">
                <div className="flex gap-3">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-[--radius-control]">
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
                  <ProvenanceBadge provenance={provenance} explain={false} />
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
          <article className="border-stage-glass-border relative isolate flex min-h-[19rem] flex-col justify-end overflow-hidden rounded-[--radius-shell] border p-6">
            <Picture picture={tall} />

            <h3 className="font-display text-2xl leading-tight text-balance">
              More adventures near you
            </h3>
            <p className="text-stage-ink-muted mt-2 text-sm">
              Every place the catalogue can price, on one globe, with what the trip costs on it.
            </p>

            <a
              href={exploreHref}
              className="border-stage-glass-border bg-stage-glass text-stage-ink ease-standard duration-quick focus-visible:outline-stage-accent mt-4 grid size-10 place-items-center rounded-full border backdrop-blur-sm transition-colors hover:border-[--color-stage-accent]"
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
