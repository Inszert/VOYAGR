import { Container, Icon, type IconName } from '@/components/ui';
import type { DataProvenance } from '@/core/trip/provenance';
import { imageryUrlFor } from '@/providers/imagery/url';
import type { AirportSuggestion } from '@/search/destination-names';
import type { SearchFormErrors } from '@/search/schema';
import { CompactSearch } from './compact-search';
import { GlobeStage, type GlobeStageProps } from './globe-stage';

/**
 * The stage: the first screen of the product.
 *
 * Composition, not behaviour. The headline and the search on the left, the
 * planet on the right, and one card floating over it. Every piece here is
 * server-rendered except the globe, and every piece is a form or a link, so
 * the stage is fully operable before the globe draws.
 *
 * The page is night from here to the footer - see the tokens in
 * `globals.css`. What the stage adds on top of that is the sky the planet
 * hangs in: two soft washes and a ruled field, no imagery, no request.
 */

export interface DiscoveryStageProps {
  globe: GlobeStageProps;
  /**
   * Remounts the compact form when the search changes. Only the form: its
   * inputs are uncontrolled, and a navigation from a lens or a chip would
   * otherwise leave them showing the previous search. The globe has no key,
   * so a selection is a flight over the globe already there.
   */
  formKey: string;
  today: string;
  values: Readonly<Record<string, string | undefined>>;
  /** Defaults for the compact form: the traveller's, plus dates not in the past. */
  defaults: Readonly<Record<string, string>>;
  /** Defaults for the lenses, which keep the window form so a lens's nights still apply. */
  lensDefaults: Readonly<Record<string, string>>;
  errors: SearchFormErrors;
  destinationsDefault: string;
  destinationsHint: string;
  /** Query parameters the search carries through. */
  carry: Readonly<Record<string, string>>;
  provenance: DataProvenance;
  /** What the globe is lit for, said in words beside it. */
  season: { readonly description: string; readonly month: string };
  /** Every airport the catalogue knows, for the search suggestions. */
  airports: readonly AirportSuggestion[];
  /**
   * One destination, over the globe.
   *
   * The best-placed card in the rail, shown here as well, because the space
   * under a round picture in a rectangular column is otherwise dead. It is
   * the same link to the same search - not an editorial pick, which would be
   * a claim nobody computed.
   */
  featured?: {
    readonly code: string;
    readonly name: string;
    readonly country: string;
    readonly label: string;
    readonly reason: string;
    readonly href: string;
    readonly actionLabel: string;
    readonly hasImage: boolean;
  } | null;
  /** True when the stage sits above results, so the copy can be shorter. */
  searched: boolean;
  action: '/' | '/explore';
}

/**
 * What the product promises, under the thing that delivers it.
 *
 * Four short claims, each one true of what is actually built. The icons are
 * decoration beside words that already say it - see `Icon`.
 */
const PROMISES: readonly (readonly [IconName, string, string])[] = [
  ['plane', 'Whole trips', 'Flights, hotel and transfers'],
  ['tag', 'Every cost tagged', 'Quoted, estimated or excluded'],
  ['calendar', 'Flexible dates', 'See what a week is worth'],
  ['bell', 'It keeps looking', 'Re-prices after you leave'],
];

/**
 * The wash under the featured thumbnail, from the destination's own code -
 * the same derivation the rail's cards use, so one place keeps one colour
 * wherever it appears.
 */
function washFor(code: string): React.CSSProperties {
  const hue = [...code].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return {
    backgroundImage: `linear-gradient(140deg, oklch(0.55 0.14 ${hue}) 0%, oklch(0.3 0.1 ${(hue + 40) % 360}) 100%)`,
  };
}

export function DiscoveryStage({
  globe,
  formKey,
  today,
  values,
  defaults,
  lensDefaults,
  errors,
  destinationsDefault,
  destinationsHint,
  carry,
  provenance,
  season,
  airports,
  featured = null,
  searched,
  action,
}: DiscoveryStageProps) {
  return (
    /*
      `overflow-x-clip`, not `overflow-hidden`.

      The planet is meant to run off the right of the viewport and carry on
      under the band below - the one thing it must never look like is a
      picture in a frame. Clipping only the horizontal axis stops a globe that
      bleeds sideways from adding a horizontal scrollbar, while leaving it free
      to overflow downwards. `overflow-hidden` did both, and cut the sphere and
      its atmosphere off square on all four sides.
    */
    <section
      aria-labelledby="stage-heading"
      className="bg-bg text-text relative -mt-[72px] overflow-x-clip pt-[72px]"
    >
      {/*
        Space, and the light the planet is sitting in.

        Three washes and a fall to the deepest value at the bottom, so the sky
        is darkest where the page continues rather than ending on a seam. The
        middle one is the important one: it is centred where the globe hangs,
        and it is the glow that used to be a bright ring drawn around the
        sphere. A ring has an edge and reads as an outline; ambient light does
        not, and this has no edge anywhere - it is simply the sky being
        brighter near the planet, which is what a sky near a planet is.

        No imagery and no gradient panel: this is one paint.
      */}
      <div
        aria-hidden="true"
        className="voyagr-sky pointer-events-none absolute inset-0 -z-10"
        style={{ '--sky-x': '73%', '--sky-y': '47%' } as React.CSSProperties}
      />

      {/* The ruled field, for the dark to be a surface rather than an absence. */}
      <div aria-hidden="true" className="voyagr-grid pointer-events-none absolute inset-0 -z-10" />

      <Container size="wide" className="pt-10 pb-12 lg:pt-14 lg:pb-16">
        {/*
          46% and the rest, and `minmax(0, …)` on both.

          Without an explicit zero minimum the lens row's unwrappable chips set
          the left column's width and the globe beside them grows to nine
          hundred pixels on a phone.
        */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,46%)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <p
                className="stage-rise text-muted flex items-center gap-2.5 text-[11px] font-medium tracking-[0.16em] uppercase"
                style={{ '--stage-delay': '0ms' } as React.CSSProperties}
              >
                <Icon name="sparkle" size={1} className="size-[14px]" />
                Explore · Discover · Go further
              </p>
              {/*
                Three lines at 62px, and no full stop.

                A display serif at this size is a shape before it is a
                sentence, and a period hanging off the end of the third line
                is a mark with nothing after it. The copy is unchanged; only
                the punctuation that was doing no work has gone.
              */}
              <h1
                id="stage-heading"
                className="stage-rise max-w-[13ch] text-[44px] leading-[1.05] tracking-[-0.02em] text-balance sm:text-[62px]"
                style={{ '--stage-delay': '40ms' } as React.CSSProperties}
              >
                {searched ? (
                  <>
                    Your trips, <span className="text-accent-ink">on the map</span>
                  </>
                ) : (
                  <>
                    See where you can go, priced as a{' '}
                    <span className="text-accent-ink">whole trip</span>
                  </>
                )}
              </h1>
              <p
                className="stage-rise text-muted max-w-[520px] text-[16px] leading-[1.6]"
                style={{ '--stage-delay': '80ms' } as React.CSSProperties}
              >
                Flights, a hotel and the ride from the airport, priced together and ranked by what
                the whole trip is worth to you. Voyagr keeps looking after you close the tab, and
                tells you when a better one appears.
              </p>
            </div>

            <div className="stage-rise" style={{ '--stage-delay': '120ms' } as React.CSSProperties}>
              <CompactSearch
                key={formKey}
                values={values}
                defaults={defaults}
                errors={errors}
                action={action}
                destinationsDefault={destinationsDefault}
                destinationsHint={destinationsHint}
                carry={carry}
                airports={airports}
                today={today}
                lensDefaults={lensDefaults}
              />
            </div>

            {/*
              One row of four, with the chip above the words rather than
              beside them. At the width of a 46% column, four items with the
              icon inline leave eighty pixels for a description, which is
              four lines of orphaned words; stacked, each one gets the whole
              cell and none of them runs past two.
            */}
            <ul
              className="stage-rise grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4"
              style={{ '--stage-delay': '160ms' } as React.CSSProperties}
            >
              {PROMISES.map(([icon, title, detail]) => (
                <li key={title} className="flex min-w-0 flex-col gap-2.5">
                  <span
                    aria-hidden="true"
                    className="voyagr-tile text-muted grid size-[34px] place-items-center rounded-[10px]"
                  >
                    <Icon name={icon} size={1} className="size-[17px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="text-text block text-[12px] font-medium">{title}</span>
                    <span className="text-dim mt-0.5 block text-[12px] leading-[1.35]">
                      {detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/*
            The planet is not in a box.

            The column runs past the container's right gutter and off the edge
            of the viewport, and past the bottom of the hero, so the sphere is
            cropped by the window the way a photograph of the Earth is cropped
            by a window - not by a frame drawn around it. The section clips
            only horizontally, so this costs no scrollbar.

            Only the planet runs past the column. The caption under it stays
            inside, or a sentence about the season ends up off-screen.
          */}
          <div className="flex flex-col gap-4">
            <div className="relative flex min-h-[22rem] flex-col gap-4 lg:-mt-10 lg:-mr-[9vw] lg:h-[42rem] xl:-mr-[7vw]">
              <GlobeStage {...globe} className="min-h-[22rem] flex-1" />

              {featured ? (
                /*
                  On the planet, not under it.

                  A card floating over the globe is the one piece of the
                  reference that is not decoration: it is the same link to
                  the same search the rail carries, put where somebody
                  looking at the world is already looking. It only floats
                  where there is room - on a phone it is an ordinary card
                  below the globe, because a card over a globe that is barely
                  wider than the card is just a card.
                */
                <a
                  href={featured.href}
                  data-globe-overlay
                  className="voyagr-panel ease-standard duration-settled focus-visible:outline-stage-accent group flex items-center gap-3 overflow-hidden rounded-[12px] p-2.5 transition-[border-color,transform] hover:border-[--color-stage-accent] motion-safe:hover:-translate-y-0.5 lg:absolute lg:bottom-6 lg:left-6 lg:z-10 lg:w-[19.5rem]"
                >
                  <span
                    aria-hidden="true"
                    className="relative size-[46px] shrink-0 overflow-hidden rounded-[10px]"
                    style={washFor(featured.code)}
                  >
                    {featured.hasImage ? (
                      <img
                        src={imageryUrlFor(featured.code)}
                        alt=""
                        loading="eager"
                        decoding="async"
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="text-text block text-[14px] font-medium">
                      <span className="sr-only">{featured.actionLabel}</span> {featured.name},{' '}
                      {featured.country}
                    </span>
                    <span className="text-muted line-clamp-2 block text-[12px] leading-[1.35]">
                      {featured.reason}
                    </span>
                    <span className="text-text mt-1 block text-[12px] font-medium tabular-nums">
                      {featured.label}
                    </span>
                  </span>

                  <span
                    aria-hidden="true"
                    className="text-muted ease-standard duration-quick mr-1 shrink-0 transition-colors group-hover:text-[--color-accent-ink]"
                  >
                    <Icon name="arrow-right" size={1} className="size-[16px]" />
                  </span>
                </a>
              ) : null}
            </div>

            {/*
              One line, at the weight of a caption.

              This was two paragraphs, and the second of them - where the sun
              stands this month, and which hemisphere therefore has the ice -
              read as debug output printed under the picture. It is still
              here, because it is what the globe is lit for and somebody
              looking at a white Arctic deserves to be able to find out why.
              It is just not shouted: it hangs off the globe glyph, as its
              title for a pointer and in the accessibility tree for everyone
              else, which is where an aside belongs.
            */}
            <p className="text-dim flex flex-wrap items-center gap-x-2 text-[11px]">
              <span
                tabIndex={0}
                title={season.description}
                className="focus-visible:outline-accent-ink inline-flex rounded-full"
              >
                <Icon name="globe" size={1} className="size-[13px]" />
                <span className="sr-only">{season.description}</span>
              </span>
              <span>
                {provenance === 'mock'
                  ? 'Every price on the globe is demo data from fixtures, not a real offer.'
                  : 'Prices are the cheapest whole trip the search found at each place.'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Drag to turn it.</span>
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
