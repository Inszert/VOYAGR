import { Container, Icon, type IconName } from '@/components/ui';
import {
  demoDataSentence,
  type DataProvenance,
  type SourceAttribution,
} from '@/core/trip/provenance';
import type { AirportSuggestion } from '@/search/destination-names';
import type { SearchFormErrors } from '@/search/schema';
import { CompactSearch } from './compact-search';
import { GlobeStage, type GlobeStageProps } from './globe-stage';
import { FeaturedCard } from './featured-card';
import { HeroMetrics } from './hero-metrics';
import { HeroRail, type HeroRailItem } from './hero-rail';
import { MorePlaces } from './more-places';

/**
 * The stage: the first screen of the product.
 *
 * Composition, not behaviour. The planet is centred and large behind the
 * headline, the search is one glass bar pinned to the bottom, and a rail of
 * live destinations runs down the right edge. Every piece here is
 * server-rendered except the globe and the rail's conversation with it, and
 * every piece is a form or a link, so the stage is fully operable before the
 * globe draws.
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
  /** Who supplied each part, so the caption can say which prices are real. */
  sources?: readonly SourceAttribution[];
  /** What the globe is lit for, said in words beside it. */
  season: { readonly description: string; readonly month: string };
  /** Every airport the catalogue knows, for the search suggestions. */
  airports: readonly AirportSuggestion[];
  /**
   * Up to five live destinations for the right-edge rail, each tied to its pin.
   * The same places, figures and links as the rail below the hero.
   */
  rail?: readonly HeroRailItem[];
  /** The one destination on the hero: the first of the rail, and why it is first. */
  featured?: { readonly item: HeroRailItem; readonly reason: string } | null;
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

const INTRO =
  'Flights, a hotel and the ride from the airport, priced together and ranked by what the whole trip is worth to you. Voyagr keeps looking after you close the tab, and tells you when a better one appears.';

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
  sources = [],
  season,
  airports,
  rail = [],
  featured = null,
  searched,
  action,
}: DiscoveryStageProps) {
  return (
    /*
      `overflow-x-clip`, not `overflow-hidden`.

      The planet is meant to run off the sides of the viewport and carry on
      under whatever is below - the one thing it must never look like is a
      picture in a frame. Clipping only the horizontal axis stops a globe that
      bleeds sideways from adding a horizontal scrollbar, while leaving it free
      to overflow downwards.
    */
    <section
      aria-labelledby="stage-heading"
      className="bg-bg text-text relative -mt-[72px] overflow-x-clip"
    >
      {/*
        Space, and the light the planet is sitting in: ambient, no edge. The
        glow is centred where the globe hangs - the middle of the hero.
      */}
      <div
        aria-hidden="true"
        className="voyagr-sky pointer-events-none absolute inset-0 -z-10"
        style={{ '--sky-x': '50%', '--sky-y': '48%' } as React.CSSProperties}
      />

      {/* The ruled field, for the dark to be a surface rather than an absence. */}
      <div aria-hidden="true" className="voyagr-grid pointer-events-none absolute inset-0 -z-10" />

      {/*
        The stage: one screen. The planet is the page - centred and large
        behind the words, and the words sit on the dark limb at the bottom
        left. `data-hero` is what the globe measures its visibility against:
        the idle turn and the arcs' light stop when less than a fifth of it
        is on screen.
      */}
      <div
        data-hero
        className="group/hero relative h-[calc(100svh-var(--hero-top,56px))] min-h-[40rem] pt-[calc(var(--hero-top,56px)+72px)] sm:h-[calc(100svh-var(--hero-top,0px))] sm:min-h-[44rem] sm:pt-[calc(var(--hero-top,0px)+72px)] lg:overflow-clip"
      >
        <HeroMetrics />

        {/*
          The planet.

          Three compositions. On a phone the box starts 38% down the screen
          and is as tall as the sphere is wide (118vw), so it bleeds off both
          sides; the hero's own top is measured (`HeroMetrics`), not assumed,
          because the header wraps there. In between it is centred. From 1024px
          it is the whole hero with the camera padded so the sphere's centre is at
          66% of the width, and the box starts 8% down so the bottom of the planet
          runs off the hero - the hero crops it. Behind everything else, and
          the content layer lets pointers through wherever it is empty, so the
          globe can still be dragged.
        */}
        <GlobeStage
          {...globe}
          variant="stage"
          className="absolute inset-x-0 top-[calc(38svh-var(--hero-top,56px))] z-0 h-[118vw] sm:top-[calc(var(--hero-top,0px)+72px)] sm:bottom-0 sm:h-auto lg:top-[8%] lg:bottom-auto lg:h-full"
        />

        {/* Dark behind the words wherever the planet comes under them: a scrim, not a panel. */}
        <div
          aria-hidden="true"
          className="voyagr-hero-scrim pointer-events-none absolute inset-0 z-[1]"
        />

        <Container
          size="wide"
          className="pointer-events-none relative z-10 flex h-full flex-col justify-between pb-5 sm:justify-end sm:pb-6"
        >
          <div
            data-globe-overlay
            className="ease-out-quart duration-settled flex max-w-[44rem] flex-col gap-4 pt-4 transition-[opacity,translate] group-has-[[aria-haspopup=dialog][aria-expanded=true]]/hero:-translate-y-2 group-has-[[aria-haspopup=dialog][aria-expanded=true]]/hero:opacity-0 max-sm:group-has-[#hero-search-open:checked]/hero:opacity-0 sm:pb-8 lg:max-w-[400px] 2xl:max-w-[460px]"
          >
            <p
              className="stage-rise text-muted text-[11px] font-medium tracking-[0.16em] uppercase"
              style={{ '--stage-delay': '0ms' } as React.CSSProperties}
            >
              Explore · Discover · Go further
            </p>
            {/*
              Three lines at most, and no full stop. A display serif at this
              size is a shape before it is a sentence; the headline sits over
              the dark limb, bottom left, and the sphere stays clear of it.
            */}
            <h1
              id="stage-heading"
              className="stage-rise max-w-[15ch] text-[2.75rem] leading-none tracking-[-0.03em] text-balance sm:text-[3.5rem] lg:max-w-[400px] lg:text-[3rem] 2xl:max-w-[460px] 2xl:text-[3.5rem]"
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
              className="stage-rise text-muted max-w-[520px] text-[16px] leading-[1.6] max-sm:hidden lg:max-w-[400px]"
              style={{ '--stage-delay': '80ms' } as React.CSSProperties}
            >
              {INTRO}
            </p>
          </div>

          {/* The one bar. Expands in place, upward. */}
          <div
            data-globe-overlay
            className="stage-rise pointer-events-auto w-full max-sm:absolute max-sm:inset-x-5 max-sm:bottom-5 max-sm:w-auto lg:max-w-[920px]"
            style={{ '--stage-delay': '120ms' } as React.CSSProperties}
          >
            <CompactSearch
              key={formKey}
              variant="bar"
              values={values}
              defaults={defaults}
              errors={errors}
              action={action}
              here="/"
              destinationsDefault={destinationsDefault}
              destinationsHint={destinationsHint}
              carry={carry}
              airports={airports}
              today={today}
              lensDefaults={lensDefaults}
            />
          </div>

          {/* One destination, bottom right of the planet, like a pin that has been opened. */}
          {featured ? (
            <div className="pointer-events-auto absolute right-4 bottom-[6.5rem] hidden w-[19.5rem] lg:block xl:right-6">
              <FeaturedCard item={featured.item} reason={featured.reason} />
            </div>
          ) : null}
        </Container>
      </div>

      <Container size="wide" className="flex flex-col gap-8 pt-10 pb-12 lg:pb-16">
        <HeroRail items={rail} provenance={provenance} sources={sources} />

        <p className="text-muted max-w-[520px] text-[15px] leading-[1.6] sm:hidden">{INTRO}</p>

        {/*
          One row of four, with the chip above the words rather than beside
          them, so none of them runs past two lines.
        */}
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
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
                <span className="text-dim mt-0.5 block text-[12px] leading-[1.35]">{detail}</span>
              </span>
            </li>
          ))}
        </ul>

        {/*
          One line, at the weight of a caption. Where the sun stands this month
          hangs off the globe glyph, as its title for a pointer and in the
          accessibility tree for everyone else.
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
              ? (demoDataSentence(sources) ??
                'Every price on the globe is demo data from fixtures, not a real offer.')
              : 'Prices are the cheapest whole trip the search found at each place.'}
          </span>
          <span aria-hidden="true">·</span>
          <span>Drag to turn it.</span>
          <span aria-hidden="true">·</span>
          <span>Imagery: NASA Earth Observatory / Blue Marble</span>
        </p>
      </Container>
      <MorePlaces />
    </section>
  );
}
