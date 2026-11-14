import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, Icon } from '@/components/ui';
import { format } from '@/core/money';
import { demoDataSentence } from '@/core/trip/provenance';
import { shortDate } from '@/lib/display-date';
import { redirect } from 'next/navigation';
import { wasSubmitted } from '@/discovery/load-stage';
import { DestinationRail } from '@/components/discovery/destination-rail';
import { GlobeStage } from '@/components/discovery/globe-stage';
import { StageControls } from '@/components/discovery/stage-controls';
import { SearchResults } from '@/components/search/search-results';
import { SaveSearchForm } from '@/components/watches/save-search-form';
import { saveSearchAction } from '@/app/actions/watches';
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
 * The explorer: where a trip is actually searched for.
 *
 * Discover is the front door; every search submitted there, and every lens,
 * lands here with the same query. The globe keeps its full height until a
 * search has run, then steps down so the results - the thing just asked for -
 * start above the fold's second screen rather than below a planet.
 */

export const metadata: Metadata = {
  title: 'Explore',
};

/**
 * A starting name for a saved search.
 *
 * Built from what the user actually asked for, so the name means something
 * the moment they see it rather than being "Saved search 3".
 */
function suggestedSearchName(values: Record<string, string | undefined>): string {
  const destinations = (values.destinations ?? '').trim();
  const from = (values.earliestDeparture ?? values.departureDate ?? '').slice(0, 7);

  if (destinations && from) return `${destinations} in ${from}`;
  return destinations || 'Saved search';
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = firstValues(await searchParams);
  const page = await loadStagePage(values, '/explore');
  const { stage } = page;

  // A search this page cannot run is fixed where the form is.
  if (wasSubmitted(values) && Object.keys(page.errors).length > 0) {
    redirect(
      `/?${new URLSearchParams(
        Object.entries({ ...values, edit: '1' }).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ).toString()}`,
    );
  }

  const images = await resolveImagery(stage.cards.map((card) => card.point.destination));
  const query = new URLSearchParams(
    Object.entries(values).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();

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

        {/*
          The heading and the search, side by side.

          This is the page that searches: Discover hands every submitted
          search on to here, lenses included. The form is the same compact
          one, submitting to this page, so a changed search is a navigation
          that keeps the globe and the results in step.
        */}
        {/*
          The search on the left, the planet on the right - the same
          composition as Discover, so moving from one to the other is moving
          further into the same place rather than onto another website.

          The globe keeps its column rather than spanning the viewport: in a
          column the sphere and its atmosphere have room on every side, and
          the search is beside what it changes instead of above it.
        */}
        <Container
          size="wide"
          className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 pt-6 pb-8 lg:grid-cols-[minmax(0,31rem)_minmax(0,1fr)]"
        >
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <h1
                id="explore-heading"
                className="font-display text-display-sm sm:text-display-md text-balance"
              >
                {page.outcome ? (
                  <>
                    Your trips, <span className="text-tint-ink">on the map.</span>
                  </>
                ) : (
                  <>
                    Explore the world, <span className="text-tint-ink">priced.</span>
                  </>
                )}
              </h1>
              {/* Four pixels under a forty-pixel heading is not a gap. */}
              <p className="text-stage-ink-muted mt-3 max-w-xl text-sm">
                {page.provenance === 'mock' ? `${demoDataSentence(page.sources) ?? ''} ` : ''}
                {page.outcome
                  ? 'Every trip below is also a chip on the globe. Narrow them, compare the dates, or open one and build it your way.'
                  : 'Click a country to look inside it. Drag to turn the globe, scroll to zoom.'}
              </p>
            </div>

            {/*
              No form here. The search is stated in one line, and changing it
              opens Discover's form already filled in with it.
            */}
            {page.profile ? (
              <div className="border-border flex flex-col gap-3 border-y py-4">
                <p className="text-ink flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold">
                    {page.profile.origins.join(', ')} →{' '}
                    {values.destinations?.trim() ? values.destinations : 'anywhere'}
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    {shortDate(page.profile.earliestDeparture)} to{' '}
                    {shortDate(page.profile.latestReturn)}
                  </span>
                  <span className="text-ink-muted">
                    {page.profile.minNights === page.profile.maxNights
                      ? `${page.profile.minNights} nights`
                      : `${page.profile.minNights}-${page.profile.maxNights} nights`}
                  </span>
                  <span className="text-ink-muted">
                    {page.profile.passengers}{' '}
                    {page.profile.passengers === 1 ? 'traveller' : 'travellers'}
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    up to {format(page.profile.maxBudget)}
                  </span>
                </p>
                <a
                  href={`/?${query}&edit=1`}
                  className="text-tint-ink inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                >
                  Change search
                  <Icon name="arrow-right" size={0.9} />
                </a>
              </div>
            ) : (
              <Link
                href="/"
                className="text-tint-ink inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
              >
                Start a search on Discover
                <Icon name="arrow-right" size={0.9} />
              </Link>
            )}
          </div>

          <div className="relative h-[24rem] w-full sm:h-[32rem] lg:h-[40rem]">
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
              sources={page.sources}
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
        </Container>
      </section>

      {page.outcome && page.profile && page.filters ? (
        /*
         * The results, in the stage's palette.
         *
         * `stage-scope` remaps the semantic tokens so every component inside
         * keeps its own contrast pairings on the night.
         */
        <section className="stage-scope bg-stage text-stage-ink">
          <Container size="wide" className="flex flex-col gap-6 pt-2 pb-12">
            <SearchResults
              outcome={page.outcome}
              profile={page.profile}
              filters={page.filters}
              searchValues={values}
              resultAgeMs={page.resultAgeMs}
              images={images}
              basePath="/explore"
              saveSearch={
                <SaveSearchForm
                  query={query}
                  suggestedName={suggestedSearchName(values)}
                  signedIn={page.signedIn}
                  action={saveSearchAction}
                />
              }
            />
          </Container>
        </section>
      ) : null}

      <DestinationRail
        cards={railCards}
        totalCount={stage.points.length}
        mode={page.mode}
        provenance={page.provenance}
        sources={page.sources}
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
