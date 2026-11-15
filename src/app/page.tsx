import type { Metadata } from 'next';
import { DiscoveryStage } from '@/components/discovery/discovery-stage';
import { pickMoment, toHomeCard } from '@/components/home/card-data';
import { DestinationMoment } from '@/components/home/destination-moment';
import { ImageCredits } from '@/components/home/image-credits';
import { NextTripPanel } from '@/components/home/next-trip-panel';
import { PopularSection } from '@/components/home/popular-section';
import { TrustBand } from '@/components/home/trust-band';
import { Container, UpdatedAgo } from '@/components/ui';
import { redirect } from 'next/navigation';
import { firstValues, loadStagePage, wasSubmitted } from '@/discovery/load-stage';
import { parseSearchForm } from '@/search/schema';
import { resolveWorldRegion } from '@/search/world-regions';
import { listPlaceableDestinations } from '@/search/destination-names';
import { resolveImagery } from '@/providers/imagery';
import { imageryUrlFor } from '@/providers/imagery/url';
import type { HeroRailItem } from '@/components/discovery/hero-rail';
import destinationImages from '../../public/img/destinations/manifest.json';
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
    parseSearchForm(values, listPlaceableDestinations(), resolveWorldRegion).ok
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

  /*
   * The right-edge rail: the five best-placed cards, as the rail below them
   * has them. A photograph from the generated set when this airport has one,
   * otherwise whatever the imagery provider found, otherwise a wash.
   */
  const localImages = destinationImages as Record<string, { blur: string }>;
  const rail: HeroRailItem[] = railCards.slice(0, 5).map((card) => {
    const code = card.point.destination;
    const local = localImages[code];

    return {
      code,
      name: card.point.name,
      country: card.point.country,
      label: card.label,
      href: card.href,
      actionLabel: card.actionLabel,
      weather: card.point.weather
        ? { maxC: card.point.weather.maxC, wet: card.point.weather.rainChance >= 0.4 }
        : null,
      image: local
        ? { kind: 'local', blur: local.blur }
        : card.image
          ? { kind: 'remote', src: imageryUrlFor(code) }
          : null,
    };
  });

  /*
   * Below the hero: the same cards, reduced to plain values, so the mosaic,
   * the rail and the closing moment all read one object per place.
   */
  const homeCards = railCards.map((card) => toHomeCard(card, localImages));
  const recommended = page.recommended;
  const moment = pickMoment(homeCards, recommended?.candidate.destination ?? null);

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
          sources: page.sources,
          countryCounts: stage.countryCounts,
          selectedCountry: stage.country
            ? { adm0: stage.country.adm0, name: stage.country.name, bbox: stage.country.bbox }
            : null,
          navigation: page.navigation,
          variant: 'stage',
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
        sources={page.sources}
        season={page.season}
        airports={page.airports}
        rail={rail}
        featured={
          rail[0] && railCards[0] ? { item: rail[0], reason: railCards[0].point.reason } : null
        }
        searched={false}
        action="/explore"
      />

      <PopularSection
        cards={homeCards}
        totalCount={stage.points.length}
        mode={page.mode}
        assumptions={page.assumptions}
        country={stage.country}
        regionSummary={stage.regionSummary}
        clearHref={page.clearCountryHref()}
        unpriced={page.unpriced}
        viewAllHref={query ? `/explore?${query}` : '/explore'}
        originName={stage.originPoints[0]?.name ?? null}
        controls={{
          mode: page.mode,
          modeHref: page.modeHref,
          carry: page.carry,
          counts: stage.countryCounts,
          selected: stage.country,
        }}
      />

      {moment ? (
        <DestinationMoment
          card={moment.card}
          eyebrow={moment.isBest ? 'Best value right now' : 'Worth a closer look'}
        />
      ) : null}

      {/*
        Something to do next, built from the snapshot that is already on the
        page. A search never runs here - it carries on to the explorer - so
        this is always the page's closing answer.
      */}
      <NextTripPanel
        trip={recommended}
        tripHref={
          recommended
            ? (stage.cards.find(
                (card) => card.point.destination === recommended.candidate.destination,
              )?.href ?? '/explore')
            : '/explore'
        }
        exploreHref={query ? `/explore?${query}` : '/explore'}
      />

      <Container size="wide" className="py-3">
        <UpdatedAgo ageMs={page.updatedAgeMs} />
      </Container>

      <TrustBand />

      <ImageCredits cards={homeCards} />
    </div>
  );
}
