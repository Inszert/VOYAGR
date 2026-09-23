import type { Metadata } from 'next';
import { DestinationRail } from '@/components/discovery/destination-rail';
import { DiscoveryStage } from '@/components/discovery/discovery-stage';
import { NextTripBand, type BandPicture } from '@/components/discovery/next-trip-band';
import { StageControls } from '@/components/discovery/stage-controls';
import { TrustStrip } from '@/components/discovery/trust-strip';
import { redirect } from 'next/navigation';
import { firstValues, loadStagePage, wasSubmitted } from '@/discovery/load-stage';
import { parseSearchForm } from '@/search/schema';
import { listPlaceableDestinations } from '@/search/destination-names';
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

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = firstValues(await searchParams);

  /*
   * Discover is where a trip starts; Explore is where it is searched.
   *
   * A valid submitted search - from this page's form, a lens, an old link or
   * a bookmark - carries on to the explorer with the same query, so every
   * search URL there has ever been still lands on its results. The explorer
   * has no form, so two searches stay here: one that does not parse, which
   * comes back with its errors beside the fields, and one opened with
   * `edit=1` from the explorer's "Change search", which comes back filled in.
   */
  if (
    wasSubmitted(values) &&
    values.edit !== '1' &&
    parseSearchForm(values, listPlaceableDestinations()).ok
  ) {
    redirect(
      `/explore?${new URLSearchParams(
        Object.entries(values).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ).toString()}`,
    );
  }

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
        searched={false}
        action="/explore"
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
        page. A search never runs here - it carries on to the explorer - so
        this is always the page's closing answer.
      */}
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

      <TrustStrip
        provenance={page.provenance}
        sources={page.sources}
        noticeShown={page.outcome !== null}
      />
    </div>
  );
}
