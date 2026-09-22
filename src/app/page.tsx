import type { Metadata } from 'next';
import { Container } from '@/components/ui';
import { DestinationRail } from '@/components/discovery/destination-rail';
import { DiscoveryStage } from '@/components/discovery/discovery-stage';
import { NextTripBand, type BandPicture } from '@/components/discovery/next-trip-band';
import { StageControls } from '@/components/discovery/stage-controls';
import { TrustStrip } from '@/components/discovery/trust-strip';
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
 * The front page: the world, priced.
 *
 * The stage first - headline, compact search, globe - then the rail that says
 * in words what the globe shows, then, once a search has run, the results.
 * The search is a GET, so every state of this page is a URL: a search, a
 * ranking, a country, a destination filter. Shareable, bookmarkable, and
 * correct with the back button.
 *
 * The page computes nothing. Every figure on it was produced by `src/core/`
 * and carried here by the search or the discovery snapshot.
 */

export const metadata: Metadata = {
  title: 'Discover',
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

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = firstValues(await searchParams);
  const page = await loadStagePage(values, '/');
  const { stage } = page;

  /*
   * Photographs, if they arrive in time.
   *
   * Decoration is never allowed to hold up a price, so this is bounded by a
   * clock inside `resolveImagery` and returns whatever it has. A first render
   * on a cold cache may show gradients; the cards are designed for that, and
   * the next reader gets the pictures.
   */
  const images = await resolveImagery(stage.cards.map((card) => card.point.destination));
  const railCards = stage.cards.map((card) => ({
    ...card,
    image: images.get(card.point.destination) ?? null,
  }));

  const picture = (index: number): BandPicture | null => {
    const card = railCards[index];
    if (!card) return null;

    return {
      code: card.point.destination,
      name: card.point.name,
      image: card.image,
    };
  };

  const recommended = page.recommended;
  const recommendedPicture: BandPicture | null = recommended
    ? {
        code: recommended.candidate.destination,
        name: recommended.candidate.destinationName,
        image: images.get(recommended.candidate.destination) ?? null,
      }
    : null;

  const query = new URLSearchParams(
    Object.entries(values).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();

  return (
    <div className="flex flex-col">
      <DiscoveryStage
        formKey={query}
        globe={{
          chips: stage.chips,
          origins: stage.originPoints.map((origin) => ({
            code: origin.code,
            name: origin.name,
            position: origin.position,
          })),
          routes: stage.routes,
          points: stage.pointsGeoJson,
          landUrl: LAND_URL,
          iceUrl: ICE_URL,
          placesUrl: PLACES_URL,
          countriesUrl: COUNTRIES_URL,
          countriesDetailUrl: COUNTRIES_DETAIL_URL,
          physicalUrl: PHYSICAL_URL,
          cityLightsUrl: CITY_LIGHTS_URL,
          coastlineUrl: COASTLINE_URL,
          seasonDate: page.season.date,
          regionsUrl: stage.regionsUrl,
          provenance: page.provenance,
          countryCounts: stage.countryCounts,
          selectedCountry: stage.country
            ? { adm0: stage.country.adm0, name: stage.country.name, bbox: stage.country.bbox }
            : null,
          navigation: page.navigation,
          variant: 'hero',
        }}
        today={page.today}
        values={values}
        defaults={page.formDefaults}
        lensDefaults={page.lensDefaults}
        errors={page.errors}
        destinationsDefault={page.destinationsDefault}
        destinationsHint={page.destinationsHint}
        carry={page.carry}
        provenance={page.provenance}
        season={page.season}
        airports={page.airports}
        featured={
          railCards[0]
            ? {
                code: railCards[0].point.destination,
                name: railCards[0].point.name,
                country: railCards[0].point.country,
                label: railCards[0].label,
                reason: railCards[0].point.reason,
                href: railCards[0].href,
                actionLabel: railCards[0].actionLabel,
                hasImage: railCards[0].image !== null,
              }
            : null
        }
        searched={page.outcome !== null}
        action="/"
      />

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
        viewAllHref={query ? `/explore?${query}` : '/explore'}
        controls={
          <StageControls
            mode={page.mode}
            modeHref={page.modeHref}
            action="/"
            carry={page.carry}
            counts={stage.countryCounts}
            selected={stage.country}
          />
        }
      />

      {/*
        Something to do next, built from the snapshot that is already on the
        page. Hidden once a search has run: the results below answer the same
        question better, and two recommendations on one page are two answers
        pretending to be one.
      */}
      {page.outcome ? null : (
        <NextTripBand
          trip={recommended}
          tripHref={
            recommended
              ? (stage.cards.find(
                  (card) => card.point.destination === recommended.candidate.destination,
                )?.href ?? '/explore')
              : '/explore'
          }
          tripPicture={recommendedPicture}
          wide={picture(0)}
          tall={picture(1)}
          exploreHref={query ? `/explore?${query}` : '/explore'}
          provenance={page.provenance}
        />
      )}

      {page.outcome && page.profile && page.filters ? (
        /*
         * The results sit in the stage's palette too.
         *
         * The hero, the rail and the closing band are all night; a results
         * list that flipped to parchment in a light colour scheme would be a
         * different website below the fold. `stage-scope` remaps the semantic
         * tokens, so every component inside keeps its own contrast pairings.
         */
        <section className="stage-scope bg-stage text-stage-ink">
          <Container size="wide" className="flex flex-col gap-6 pt-2 pb-12">
            <SaveSearchForm
              query={query}
              suggestedName={suggestedSearchName(values)}
              signedIn={page.signedIn}
              action={saveSearchAction}
            />

            <SearchResults
              outcome={page.outcome}
              profile={page.profile}
              filters={page.filters}
              searchValues={values}
              resultAgeMs={page.resultAgeMs}
              images={images}
            />
          </Container>
        </section>
      ) : null}

      <TrustStrip
        provenance={page.provenance}
        sources={page.sources}
        noticeShown={page.outcome !== null}
      />
    </div>
  );
}
