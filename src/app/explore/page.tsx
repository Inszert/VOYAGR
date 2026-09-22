import type { Metadata } from 'next';
import { Container } from '@/components/ui';
import { DestinationRail } from '@/components/discovery/destination-rail';
import { GlobeStage } from '@/components/discovery/globe-stage';
import { StageControls } from '@/components/discovery/stage-controls';
import { firstValues, loadStagePage } from '@/discovery/load-stage';
import { resolveImagery } from '@/providers/imagery';
import {
  COUNTRIES_DETAIL_URL,
  COUNTRIES_URL,
  ICE_URL,
  LAND_URL,
  PLACES_URL,
  PHYSICAL_URL,
  CITY_LIGHTS_URL,
  COASTLINE_URL,
} from '@/discovery/stage-data';

/**
 * The explorer: the globe on its own.
 *
 * The same data as the front page, composed for looking rather than for
 * reading: the globe fills the viewport, the rail sits beside it, and the
 * headline is one line. Every control the front page has is here too - the
 * ranking, the country picker, the chips - so nothing is reachable from one
 * page and not the other.
 */

export const metadata: Metadata = {
  title: 'Explore',
};

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = firstValues(await searchParams);
  const page = await loadStagePage(values, '/explore');
  const { stage } = page;

  const images = await resolveImagery(stage.cards.map((card) => card.point.destination));
  const railCards = stage.cards.map((card) => ({
    ...card,
    image: images.get(card.point.destination) ?? null,
  }));

  return (
    <div className="flex flex-col">
      <section
        aria-labelledby="explore-heading"
        className="bg-bg text-text relative -mt-[72px] overflow-x-clip pt-[72px]"
      >
        <div
          aria-hidden="true"
          className="voyagr-sky pointer-events-none absolute inset-0 -z-10"
          style={{ '--sky-x': '50%', '--sky-y': '56%' } as React.CSSProperties}
        />

        <div
          aria-hidden="true"
          className="voyagr-grid pointer-events-none absolute inset-0 -z-10"
        />

        <Container size="wide" className="flex flex-col gap-4 pt-6 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1
                id="explore-heading"
                className="font-display text-display-sm sm:text-display-md text-balance"
              >
                Explore the world, <span className="text-stage-accent">priced.</span>
              </h1>
              <p className="text-stage-ink-muted mt-1 text-sm">
                {page.provenance === 'mock'
                  ? 'Every price is demo data from fixtures, not a real offer. '
                  : ''}
                Click a country to look inside it. Drag to turn the globe, scroll to zoom.
              </p>
            </div>
          </div>
        </Container>

        {/*
          Outside the column, and clipped by nothing.

          The globe used to sit in a 1216px container inside a section with
          `overflow-hidden`, which cut the sphere and its atmosphere off
          square on all four sides - a planet in a box, on the one page that
          is nothing but the planet. It spans the viewport now, and the
          section clips only horizontally so a sphere wider than the window
          costs no scrollbar.
        */}
        <div className="relative h-[calc(100dvh-13rem)] max-h-[56rem] min-h-[26rem] w-full">
          <GlobeStage
            chips={stage.chips}
            origins={stage.originPoints.map((origin) => ({
              code: origin.code,
              name: origin.name,
              position: origin.position,
            }))}
            routes={stage.routes}
            points={stage.pointsGeoJson}
            landUrl={LAND_URL}
            iceUrl={ICE_URL}
            placesUrl={PLACES_URL}
            countriesUrl={COUNTRIES_URL}
            countriesDetailUrl={COUNTRIES_DETAIL_URL}
            physicalUrl={PHYSICAL_URL}
            cityLightsUrl={CITY_LIGHTS_URL}
            coastlineUrl={COASTLINE_URL}
            seasonDate={page.season.date}
            regionsUrl={stage.regionsUrl}
            provenance={page.provenance}
            countryCounts={stage.countryCounts}
            selectedCountry={
              stage.country
                ? { adm0: stage.country.adm0, name: stage.country.name, bbox: stage.country.bbox }
                : null
            }
            navigation={page.navigation}
            variant="explorer"
          />
        </div>
      </section>

      <DestinationRail
        cards={railCards}
        totalCount={stage.points.length}
        mode={page.mode}
        provenance={page.provenance}
        assumptions={page.assumptions}
        country={stage.country}
        regionSummary={stage.regionSummary}
        clearHref={page.clearCountryHref()}
        unpriced={page.unpriced}
        controls={
          <StageControls
            mode={page.mode}
            modeHref={page.modeHref}
            action="/explore"
            carry={page.carry}
            counts={stage.countryCounts}
            selected={stage.country}
          />
        }
      />
    </div>
  );
}
