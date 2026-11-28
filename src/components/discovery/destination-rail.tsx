import { cn } from '@/lib/cn';
import { Container, Icon } from '@/components/ui';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import type { Country } from '@/discovery/countries';
import { MAP_MODE_LABELS, type DestinationPoint, type MapMode } from '@/discovery/map-model';
import type { DiscoveryAssumptions } from '@/discovery/snapshot';
import type { DestinationImage } from '@/providers/imagery/types';
import { imageryUrlFor } from '@/providers/imagery/url';
import { shortDate } from '@/lib/display-date';

/**
 * The destinations, as cards.
 *
 * Every chip on the globe is a card here, in the same order, with the same
 * figure and the same reason, so "where can I go?" is answered without a
 * canvas, without JavaScript and to a screen reader. Section 14 asks that the
 * ranking not be hidden, so each card says why it sits where it does, quoting
 * a figure an engine produced.
 *
 * **The photograph sits over a gradient, not instead of it.** The wash is
 * derived from the destination's own code and is painted first; the picture
 * covers it when one arrives. A destination nobody has chosen an article for,
 * a reader on a train and a Wikimedia outage all land in the same place - a
 * card that looks deliberate and claims nothing - rather than on a broken
 * image icon. See `docs/imagery-options.md`.
 */

export interface RailCard {
  readonly point: DestinationPoint;
  /** The price, formatted on the server from `Money`; never assembled here. */
  readonly label: string;
  /** Where the card's main action goes: a search, or a filter over one. */
  readonly href: string;
  /** What that action is, for the accessible name. */
  readonly actionLabel: string;
  readonly aboutHref: string;
  /** The photograph, when one was found in time. */
  readonly image?: DestinationImage | null;
}

export interface DestinationRailProps {
  cards: readonly RailCard[];
  /** How many destinations there are before narrowing to a country. */
  totalCount: number;
  mode: MapMode;
  provenance: DataProvenance;
  /** Who supplied each part, so a card can badge flights and hotels separately. */
  sources?: readonly SourceAttribution[];
  /** Present for the front page's snapshot; absent once a search has run. */
  assumptions?: DiscoveryAssumptions | null;
  /** The country the rail is narrowed to, if any. */
  country?: Country | null;
  /** How many regions the globe can draw inside it, in words, or null. */
  regionSummary?: string | null;
  /** A link back to the whole world, when narrowed. */
  clearHref?: string;
  /** Prices could not be produced at all; the rail says so rather than pretending. */
  unpriced?: boolean;
  /** With `unpriced`: nothing is cached yet and the worker is filling it, not a failure. */
  pricesLoading?: boolean;
  /** The ranking and country controls, rendered beside the heading. */
  controls?: React.ReactNode;
  /** Anywhere was searched and no country is chosen yet: say what to do next. */
  awaitingCountry?: boolean;
  /** A search was submitted with no destination: say what to fill in, rather than nothing. */
  needsDestination?: boolean;
  /** Where "see them all" goes, when this is a trimmed view. */
  viewAllHref?: string;
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
 * The badge a card wears, from why it is where it is.
 *
 * Derived from the ranking the search produced rather than chosen: the first
 * card in "cheapest" is the cheapest, and saying so is repeating the engine
 * rather than editorialising over it.
 */
function badgeFor(index: number, mode: MapMode): string | null {
  if (index === 0) return MAP_MODE_LABELS[mode];
  if (index === 1) return 'Runner-up';
  if (index === 2) return 'Third';
  return null;
}

/**
 * The wash under a card's photograph.
 *
 * Hue from the destination's own code, so a place keeps its colour between
 * renders and two neighbours never collide by accident. Decoration: it says
 * nothing about the place, which is why it is a gradient and not a picture.
 */
function washFor(code: string): React.CSSProperties {
  const hue = [...code].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return {
    backgroundImage: `linear-gradient(140deg, oklch(0.55 0.14 ${hue}) 0%, oklch(0.32 0.1 ${(hue + 40) % 360}) 60%, oklch(0.2 0.05 ${(hue + 70) % 360}) 100%)`,
  };
}

/**
 * The weather chip, or nothing.
 *
 * `maxC` is the warmest the stay is expected to get, from the weather
 * provider - not an average, and not this card's opinion. A destination with
 * no weather gets no chip, because an empty degree sign is a claim too.
 */
/**
 * How the plane beside a price is coloured, and what it is saying.
 *
 * `fewestStops` is the fewest connections on the busier leg of any trip found
 * at that place - a figure the search produced, not one read off a label. A
 * direct flight is green, one change is amber, two or more is red, and a
 * destination whose flights we could not count stays muted rather than being
 * coloured as though it were good news.
 *
 * **Colour is never the only signal.** Each one carries the same words in its
 * title and in the accessible name beside it, because a green aeroplane is
 * meaningless to somebody who cannot see that it is green.
 */
function connections(stops: number | null): { className: string; label: string } {
  if (stops === null) return { className: 'text-muted', label: 'Connections not known' };
  if (stops === 0) return { className: 'text-positive-ink', label: 'Direct flight' };
  if (stops === 1) return { className: 'text-caution-ink', label: '1 stop' };

  return { className: 'text-critical-ink', label: `${stops} stops` };
}

/**
 * The price, with its prefix at the weight of a prefix.
 *
 * The label arrives formatted from the server - "from EUR 475.02" - and is
 * never taken apart for its number. This splits it at the one word the
 * server puts in front, so "from" can sit back and the figure can be the
 * thing the eye lands on. The figure itself is untouched, and a label that
 * does not start with that word is printed exactly as it came.
 */
function Price({ label }: { label: string }) {
  const prefix = 'from ';

  if (!label.startsWith(prefix)) {
    return <span className="truncate tabular-nums">{label}</span>;
  }

  return (
    <span className="truncate tabular-nums">
      <span className="text-muted">{prefix.trim()} </span>
      <span className="text-text font-medium">{label.slice(prefix.length)}</span>
    </span>
  );
}

function Weather({ point }: { point: DestinationPoint }) {
  if (!point.weather) return null;

  const wet = point.weather.rainChance >= 0.4;

  return (
    <span className="text-text inline-flex shrink-0 items-center gap-1.5 text-[12px]">
      {/*
        Sun is warm and rain is blue, which is the one pair of colours nobody
        has to be taught. It is never the only signal: the glyph differs, the
        figure is beside it, and the sentence underneath says which it is.
      */}
      <Icon
        name={wet ? 'rain' : 'sun'}
        size={1}
        className={cn('size-[14px]', wet ? 'text-(--color-biome-ink)' : 'text-accent-300')}
      />
      <span className="font-medium tabular-nums">{point.weather.maxC}°C</span>
      <span className="sr-only">
        {wet ? ' warmest day, rain likely' : ' warmest day of the stay'}
      </span>
    </span>
  );
}

export function DestinationRail({
  cards,
  totalCount,
  mode,
  assumptions = null,
  country = null,
  regionSummary = null,
  clearHref,
  unpriced = false,
  pricesLoading = false,
  controls,
  viewAllHref,
  awaitingCountry = false,
  needsDestination = false,
}: DestinationRailProps) {
  const credited = cards.filter(
    (card): card is RailCard & { image: DestinationImage } => card.image != null,
  );

  return (
    /*
      Flat, and divided from the hero by one hairline.

      This band used to carry a violet wash of its own. A tinted background
      behind a row of prices is decoration competing with the figures on it,
      and the seam where the wash met the hero read as two pages joined. It is
      `--bg-alt` now: the same night, one step across rather than one step
      down.
    */
    <section aria-labelledby="rail-heading" className="stage-scope text-text relative isolate">
      {/*
        The band has no top edge, and no background of its own at the top.

        It used to declare `border-t` against `bg-bg-alt`, which put a hairline
        and a tonal step across the full width exactly where the hero ended -
        a box, drawn around the thing the hero was meant to be bleeding out
        of. Worse, an opaque background there cut the planet's atmosphere off
        square, because the glow reaches about a fifth of the viewport below
        the sphere and this section is the next thing painted.

        So the background starts transparent and only becomes the page colour
        two hundred pixels down. The globe's light carries on into the band
        and fades out on its own terms, and there is no line anywhere.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(to_bottom,transparent_0px,var(--color-bg)_200px)]"
      />

      {/*
        The band takes the planet's colour too.

        It was stripped to a flat surface because the violet wash it had was
        arbitrary - a purple glow behind a list of prices, meaning nothing.
        This one means something: it is `--color-biome`, the same value the
        sky behind the globe is tinted with, so the whole page moves together
        as the world turns. Low enough that no figure on top of it loses
        contrast, and it fades with the transition on the root.

        It is masked in over the first hundred and sixty pixels. The ellipse
        is centred on this element's top edge, so without the mask it reaches
        full strength on the first row of pixels and the wash itself becomes
        the horizontal edge the border above was removed to get rid of.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(ellipse_60%_100%_at_18%_0%,color-mix(in_oklab,var(--color-biome)_14%,transparent)_0%,transparent_70%)] [mask-image:linear-gradient(to_bottom,transparent_0px,black_160px)]"
      />
      <Container size="wide" className="flex flex-col gap-8 py-14">
        {/*
          Two columns and one row, not three floating stacks.

          The heading and what it means go left; everything that reorders the
          list goes right, on one line, level with the heading. It was three
          columns before - the ranking in the middle of the measure, the
          country picker beside it, the explorer link under them both - which
          left the sub-copy squeezed into a third of the width and no control
          obviously belonging to anything.
        */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
          {/*
            The heading keeps its measure; the controls take what is left and
            wrap inside it. Sharing the row as two flexible columns let the
            controls - which never wrap willingly - squeeze the heading into
            one word per line.
          */}
          <div className="lg:w-[420px] lg:shrink-0">
            {/*
              The eyebrow is a label, not a highlight. It was the accent,
              which made the least important line on the band the most
              colourful thing on it.
            */}
            <p className="text-biome-ink flex items-center gap-2 text-[11px] tracking-[0.16em] uppercase">
              <Icon name="sparkle" size={1} className="size-[13px]" />
              {country ? country.name : 'Popular right now'}
            </p>

            <h2
              id="rail-heading"
              className="text-text mt-3 max-w-[22ch] text-[28px] leading-[1.15] tracking-[-0.015em] sm:text-[34px]"
            >
              {country
                ? cards.length === 0
                  ? `Nothing priced in ${country.name} yet`
                  : `${cards.length} ${cards.length === 1 ? 'place' : 'places'} priced in ${country.name}`
                : totalCount === 0
                  ? 'Where you can go'
                  : `${totalCount} ${totalCount === 1 ? 'destination' : 'destinations'}, ranked by ${MAP_MODE_LABELS[mode].toLowerCase()}`}
            </h2>

            <p className="text-muted mt-3 max-w-[420px] text-[14px] leading-[1.5]">
              {assumptions
                ? describe(assumptions)
                : 'Each price is the cheapest whole trip we could build to that place - flights, a hotel and the ride from the airport, together.'}
            </p>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3 lg:mt-9 lg:justify-end">
            {controls}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {country && clearHref ? (
                <a
                  href={clearHref}
                  className="text-muted hover:text-text ease-standard duration-quick -my-1 inline-flex items-center gap-1.5 py-1 text-[13px] transition-colors"
                >
                  Show the whole world
                  {totalCount > cards.length ? ` (${totalCount})` : ''}
                  <Icon name="arrow-right" size={1} className="size-[14px]" />
                </a>
              ) : null}

              {viewAllHref ? (
                <a
                  href={viewAllHref}
                  className="text-muted hover:text-text ease-standard duration-quick -my-1 inline-flex items-center gap-1.5 py-1 text-[13px] transition-colors"
                >
                  Open the explorer
                  <Icon name="arrow-right" size={1} className="size-[14px]" />
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {awaitingCountry ? (
          <p role="status" className="text-ink text-[14px]">
            Anywhere is a lot of places. Choose a country above and we will price its airports, then
            you pick one.
          </p>
        ) : null}

        {needsDestination ? (
          <p role="status" className="text-ink text-[14px]">
            Choose where to go first: type airport codes, pick a region, or choose Anywhere and then
            a country. Then search.
          </p>
        ) : null}

        {unpriced && !awaitingCountry && !needsDestination ? (
          <p role="status" className="text-muted text-[13px]">
            {pricesLoading
              ? 'Prices are not loaded yet. The globe shows these places without them.'
              : 'Prices could not be produced just now, so the globe shows places without them. Try again in a moment, or run a search.'}
          </p>
        ) : null}

        {country && cards.length === 0 && !unpriced ? (
          <p className="text-muted text-[13px]">
            The catalogue has no airport in {country.name} yet, so nothing there can be priced.
            Adding one is a catalogue entry, not a code change - and a dot placed somewhere
            plausible in the meantime would be an invented fact.
          </p>
        ) : null}

        {cards.length > 0 ? (
          <ol
            // Named, because this section now holds the ranking controls too,
            // and those are a list as well. "The destinations" and "the ways
            // to rank them" are different lists, and a reader moving between
            // them by keyboard should be told which one they have landed in.
            aria-label="Destinations"
            /*
              As many across as fit, and never a half-empty row.

              A fixed five-column grid is right until a country is opened and
              three places come back: they pack against the left and the row
              reads as a loading state. `auto-fit` collapses the tracks that
              have nothing in them and stretches what is left across the whole
              measure, so three cards are three wide cards rather than three
              cards and a gap.

              Every destination the globe shows is here, in rank order, which
              is the property the canvas depends on - a place must never be
              reachable only by spinning.
            */
            className="grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-5"
          >
            {cards.map(({ point, label, href, actionLabel, aboutHref, image }, index) => {
              const badge = badgeFor(index, mode);
              const flight = connections(point.fewestStops);

              return (
                <li
                  key={point.destination}
                  id={`destination-${point.destination}`}
                  style={{ '--stage-delay': `${Math.min(index, 6) * 40}ms` } as React.CSSProperties}
                  className="stage-rise bg-panel border-hairline ease-standard duration-settled group relative flex flex-col overflow-hidden rounded-[14px] border transition-[border-color,transform] hover:-translate-y-1 hover:border-(--color-accent-ink) motion-reduce:hover:translate-y-0"
                >
                  {/*
                    A band, not a fade.

                    The photograph used to melt into the card body through a
                    long gradient, which made a card read as one smeared
                    block rather than as a picture with a caption. It stops
                    dead at 180px and the body starts on solid panel.
                  */}
                  <div className="relative h-[180px] w-full shrink-0 overflow-hidden">
                    {/* Painted first, and still there if the photograph never arrives. */}
                    <div
                      aria-hidden="true"
                      style={washFor(point.destination)}
                      className="absolute inset-0"
                    />

                    {image ? (
                      <img
                        src={imageryUrlFor(point.destination)}
                        alt={image.description ?? ''}
                        width={image.width}
                        height={image.height}
                        loading={index < 5 ? 'eager' : 'lazy'}
                        decoding="async"
                        /*
                          Graded, because they cannot be art-directed.

                          The photographs are whatever Wikimedia has for the
                          place. Pulling them down and desaturating them made
                          a wall of grey rectangles; this goes the other way -
                          saturation up by a third, contrast up a little,
                          brightness left where it is - so a sea is a sea and
                          a terracotta roof is terracotta. The badges over
                          them carry their own darkness, so nothing depends on
                          the picture being dim.
                        */
                        className="ease-standard absolute inset-0 size-full object-cover brightness-[0.97] contrast-[1.12] saturate-[1.35] transition-transform duration-700 group-hover:scale-[1.06] motion-reduce:group-hover:scale-100"
                      />
                    ) : null}

                    {badge ? (
                      <span className="border-hairline bg-field/85 text-text absolute top-3 left-3 rounded-(--radius-pill) border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md">
                        {badge}
                      </span>
                    ) : null}

                    {/* No provenance badge on the picture; the figure keeps its "from". */}
                  </div>

                  <div className="@container flex flex-1 flex-col px-4 pt-3.5 pb-4">
                    {/*
                      The name sits under the photograph rather than on it.

                      On the picture it needed its own darkness underneath,
                      which meant every card carried a black gradient over the
                      bottom third of its photograph whether the photograph
                      needed one or not.
                    */}
                    <h3 className="text-text text-[19px] leading-tight">
                      <a
                        href={href}
                        className="focus-visible:outline-accent-ink after:absolute after:inset-0 after:content-['']"
                      >
                        {/* The space belongs between the two nodes: the
                            accessible name algorithm trims each one, so a
                            trailing space inside the span is discarded and
                            the link reads "Show only trips toAntalya". */}
                        <span className="sr-only">{actionLabel}</span> {point.name}
                      </a>
                    </h3>
                    <p className="text-muted mt-0.5 text-[12px]">{point.country}</p>

                    {/*
                      Section 14 asks that a ranking explain itself, and this
                      is that explanation - kept, and taken off the card.

                      Three lines of prose between a place name and its price
                      is the thing that made five cards read as five
                      paragraphs. It stays in the markup for anyone reading
                      the page rather than looking at it, and the
                      destination's own page says it in full and in the open.
                    */}
                    <span className="sr-only">{point.reason}</span>

                    {/*
                      The footer: the two figures grouped left, the way out
                      pushed right, and the card's own padding respected on
                      both sides. `min-w-0` on the group is what stops a long
                      total pushing the arrow through the border.
                    */}
                    <div className="border-hairline mt-auto flex items-center gap-x-2 border-t pt-3">
                      <div className="flex min-w-0 items-center gap-x-2.5">
                        <Weather point={point} />

                        <span
                          title={flight.label}
                          className="text-text inline-flex min-w-0 items-center gap-1.5 text-[12px]"
                        >
                          <Icon
                            name="plane"
                            size={1}
                            className={cn('size-[14px]', flight.className)}
                          />
                          <span className="sr-only">{flight.label}. </span>
                          <Price label={label} />
                        </span>
                      </div>

                      {/*
                        The arrow is the way to the place's own page - it was
                        an underlined "About" on a line of its own, which is a
                        row of chrome under every card. It is the first thing
                        to go when a card is too narrow for all three, because
                        a price must never be the thing that drops.
                      */}
                      <a
                        href={aboutHref}
                        // A 16px glyph in a 32px box: the target is the
                        // box, and it was the glyph.
                        className="text-muted hover:text-text ease-standard duration-quick relative z-10 -my-1 ml-auto hidden size-8 shrink-0 place-items-center transition-colors @[13rem]:grid"
                      >
                        <Icon name="arrow-right" size={1} className="size-[16px]" />
                        <span className="sr-only">
                          About{' '}
                          {/* JSX trims a leading space in a text child, and
                              without it the name reads "AboutAntalya". */}
                          <span>{point.name}</span>
                        </span>
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {/*
          What the product knows about an open country, which today is where
          it is and what shape its regions are. Said out loud rather than left
          for a reader to infer from an empty map: the boundaries on the globe
          are geometry, and geometry is not knowledge about a place.
        */}
        {country ? (
          <dl className="border-stage-glass-border grid gap-x-8 gap-y-2 border-t pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-dim">Where it is</dt>
              <dd className="text-text">
                {country.subregion}, {country.continent}
              </dd>
            </div>
            <div>
              <dt className="text-dim">On the globe</dt>
              <dd className="text-text">
                {regionSummary ? `${regionSummary}, drawn as outlines` : 'Its outline only'}
              </dd>
            </div>
            <div>
              <dt className="text-dim">What we can price</dt>
              <dd className="text-text">
                {cards.length === 0
                  ? 'Nothing yet'
                  : `${cards.length} ${cards.length === 1 ? 'airport' : 'airports'}`}
              </dd>
            </div>
          </dl>
        ) : null}

        {/*
          Sections 13 and 14 list more than this can answer. Naming the gap
          beats a control that silently matches everything: a transport filter
          offering "train" that quietly returns flights is worse than none.
        */}
        {/*
          A note, at the weight of a note.

          Sections 13 and 14 list more than this can answer, and naming the
          gap beats a control that silently matches everything. It was set as
          full-width body copy with a bold lead-in, which is how a true
          sentence ends up reading as an error message.
        */}
        <p className="border-hairline text-dim mt-6 max-w-[720px] border-t pt-6 text-[12px] leading-[1.5]">
          Flights only for now - trains, buses, ferries and driving need providers this product does
          not have yet, and so do the seasonal and &ldquo;most interesting&rdquo; rankings. The
          globe shows where we can actually price a trip.
        </p>

        {/*
          Attribution, in full, for every photograph actually on the page.
          A licence obligation is not met by a line in a footer that names the
          source and not the photographer, and it is not met by a tooltip.
        */}
        {credited.length > 0 ? (
          <details className="text-muted text-[13px]">
            <summary className="focus-visible:outline-stage-accent hover:text-stage-ink -my-1 inline-block cursor-pointer py-1">
              Photograph credits
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {credited.map(({ point, image }) => (
                <li key={point.destination}>
                  {point.name}:{' '}
                  <a
                    href={image.credit.pageUrl}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="underline underline-offset-4"
                  >
                    {image.credit.author ?? 'photographer not stated'}
                  </a>
                  {image.credit.licence ? `, ${image.credit.licence}` : ''}
                  {', via Wikimedia'}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Container>
    </section>
  );
}
