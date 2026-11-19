import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, Icon, UpdatedAgo } from '@/components/ui';
import { ExploreSearchForm } from '@/components/search/explore-search-form';
import { LiveResults } from '@/components/search/live-search';
import { ANYWHERE, isAnywhere, parsePartWeights, chosenTripLengthSummary } from '@/search/schema';
import { DEFAULT_PART_WEIGHTS } from '@/core/trip/scoring';
import { PartWeightsControl } from '@/components/search/part-weights';
import { SearchPreferences } from '@/components/search/search-preferences';
import { format } from '@/core/money';
import { getCurrentUser } from '@/auth/current-user';
import { getRepositories } from '@/db';
import { countryNameFor } from '@/lib/destination-media';
import { shortDate } from '@/lib/display-date';
import { redirect } from 'next/navigation';
import { wasSubmitted } from '@/discovery/load-stage';
import { DestinationRail } from '@/components/discovery/destination-rail';
import { DestinationCard } from '@/components/home/destination-card';
import { toHomeCard } from '@/components/home/card-data';
import destinationImages from '../../../../public/img/destinations/manifest.json';
import { EXPLORE_SLOT_CLASS, StageSlot } from '@/components/discovery/stage-slot';
import { StageSync } from '@/components/discovery/stage-sync';
import { StageControls } from '@/components/discovery/stage-controls';
import { Suspense } from 'react';
import { SearchResults } from '@/components/search/search-results';
import { WhatToDo } from '@/components/search/what-to-do';
import { FlexDatesSection } from '@/components/search/flex-dates-section';
import { SaveSearchForm } from '@/components/watches/save-search-form';
import { saveSearchAction } from '@/app/actions/watches';
import { firstValues, loadStagePage } from '@/discovery/load-stage';
import { withQuery } from '@/discovery/stage-data';
import { resolveImagery } from '@/providers/imagery';
import { getActiveDataSource } from '@/providers/request-source';
import { loadStayLinksForTrips } from '@/search/stays/stay-links';
import { offersForTrip } from '@/booking/partners';
import { TripExtras } from '@/components/partners';
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

const AIRPORT = /^[A-Z]{3}$/;
const DATE_WINDOW = /^(d{4}-d{2}-d{2})..(d{4}-d{2}-d{2})$/;

/**
 * The trip the strip moves, when there is exactly one to move.
 *
 * One place, one origin, and a set of dates: the picked window if there is one,
 * otherwise the dates of the best trip the search found. Anything wider is a
 * search across places or days, and a strip about "these dates" would have no
 * dates to be about.
 */
function flexTrip(
  values: Record<string, string | undefined>,
  outcome: {
    results: readonly { candidate: { dates: { departureDate: string; returnDate: string } } }[];
  } | null,
  currency: string | undefined,
): {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  currency: string;
  passengers: number;
  hrefTemplate: string;
} | null {
  const codes = (value: string | undefined) =>
    (value ?? '')
      .split(/[,s]+/)
      .map((code) => code.toUpperCase())
      .filter(Boolean);

  const destinations = codes(values.destinations);
  const origin = codes(values.origins)[0];
  const destination = destinations[0];
  if (destinations.length !== 1 || !origin || !destination) return null;
  if (!AIRPORT.test(origin) || !AIRPORT.test(destination)) return null;

  const picked = DATE_WINDOW.exec(values.fDates ?? '');
  const best = outcome?.results[0]?.candidate.dates;
  const departureDate = picked?.[1] ?? best?.departureDate;
  const returnDate = picked?.[2] ?? best?.returnDate;
  if (!departureDate || !returnDate) return null;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value !== '' && key !== 'fDates') params.set(key, value);
  }
  params.set('flexibility', 'exact');
  params.set('departureDate', '__DEPARTURE__');
  params.set('returnDate', '__RETURN__');

  const passengers = Number(values.passengers ?? 1);

  return {
    origin,
    destination,
    departureDate,
    returnDate,
    currency: currency ?? 'EUR',
    passengers: Number.isSafeInteger(passengers) && passengers > 0 ? passengers : 1,
    hrefTemplate: `/explore?${params.toString()}`,
  };
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const submitted = firstValues(await searchParams);
  // An empty "To" is a search anywhere: "Anywhere" is only the field's
  // placeholder, so the word is never a value and is filled in here instead.
  const values =
    wasSubmitted(submitted) && !submitted.destinations?.trim()
      ? { ...submitted, destinations: ANYWHERE }
      : submitted;
  const page = await loadStagePage(values, '/explore');
  // What the live search may take for a finished place without a pick.
  const airportCodes = page.airports.map((airport) => airport.code);
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
  // Only trips with no priced stay get one; see `loadStayLinksForTrips`.
  const stayLinks = page.outcome
    ? await loadStayLinksForTrips(
        [...page.outcome.results, ...page.outcome.nearMisses].map((trip) => trip.candidate),
        (await getActiveDataSource()).effective,
      )
    : undefined;
  const query = new URLSearchParams(
    Object.entries(values).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();

  // "Add to my plan" is offered only to somebody signed in, with their own trips to choose from.
  const user = page.outcome ? await getCurrentUser() : null;
  const planTrips = user
    ? (await getRepositories().trips.listForUser(user.id)).map((trip) => ({
        id: trip.id,
        name: trip.name,
      }))
    : null;
  const countries = new Map<string, string>();
  if (page.outcome) {
    for (const trip of [...page.outcome.results, ...page.outcome.nearMisses]) {
      const code = trip.candidate.destination;
      const name = countries.has(code) ? null : countryNameFor(code);
      if (name) countries.set(code, name);
    }
  }

  const railCards = stage.cards.map((card) => ({
    ...card,
    image: images.get(card.point.destination) ?? null,
  }));

  // Every place except the ones the results above already are.
  const searchedCodes = new Set(
    page.outcome
      ? [...page.outcome.results, ...page.outcome.nearMisses].map(
          (trip) => trip.candidate.destination,
        )
      : [],
  );
  const otherCards = railCards
    .filter((card) => !searchedCodes.has(card.point.destination))
    .map((card) => toHomeCard(card, destinationImages as Record<string, { blur: string }>));

  /*
   * Anywhere is a path, not a search: a country, then one of its airports, then its trips.
   * `picking` is the middle step: the country's airports are searched and priced, and the trips
   * wait for the visitor to choose one.
   */
  const anywhereSearch = isAnywhere(values.destinations);
  const picking =
    page.outcome !== null && stage.country !== null && anywhereSearch && !page.filters?.destination;
  const chosenInCountry =
    page.outcome !== null &&
    stage.country !== null &&
    anywhereSearch &&
    Boolean(page.filters?.destination);
  // Choosing a country keeps the search it came from.
  const countryCarry = page.awaitingCountry
    ? Object.fromEntries(
        Object.entries(values).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1] !== '' && entry[0] !== 'country',
        ),
      )
    : page.carry;

  return (
    <div className="flex flex-col">
      <section
        aria-labelledby="explore-heading"
        // The globe is mounted before this section, so the section paints over it. Pointer
        // events pass through; the copy column below opts back in.
        className="text-text pointer-events-none relative -mt-[72px] overflow-x-clip pt-[72px]"
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
          className="pointer-events-none grid grid-cols-[minmax(0,1fr)] items-center gap-6 pt-6 pb-8 lg:grid-cols-[minmax(0,31rem)_minmax(0,1fr)]"
        >
          <div className="pointer-events-auto flex min-w-0 flex-col gap-5">
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
                {page.outcome
                  ? 'Every trip below is also a chip on the globe. Narrow them, compare the dates, or open one and build it your way.'
                  : 'Click a country to look inside it. Drag to turn the globe, scroll to zoom.'}
              </p>
              {page.outcome ? null : (
                <UpdatedAgo ageMs={page.updatedAgeMs} className="text-stage-ink-muted mt-2" />
              )}
            </div>

            {/*
              No form here. The search is stated in one line, and changing it
              opens Discover's form already filled in with it.
            */}
            {page.profile ? (
              <div className="border-border flex flex-col gap-3 border-y py-4">
                {/*
                  The four things people change most, applied as they change:
                  a new address, the same page, the same globe. Everything
                  else about the search rides along as it was, and "Change
                  search" below still opens every option.
                */}
                <ExploreSearchForm
                  label="Change this search"
                  values={values}
                  submitted={submitted}
                  airports={page.airports}
                  today={page.today}
                  errors={page.errors}
                  airportCodes={airportCodes}
                  defaults={{
                    origins: page.profile.origins.join(', '),
                    departureDate: page.profile.earliestDeparture,
                    returnDate: page.profile.latestReturn,
                    passengers: String(page.profile.passengers),
                  }}
                />
                <PartWeightsControl values={parsePartWeights(values) ?? DEFAULT_PART_WEIGHTS} />
                <Suspense fallback={null}>
                  <SearchPreferences />
                </Suspense>
                <p className="text-ink flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-ink-muted tabular-nums">
                    {shortDate(page.profile.earliestDeparture)} to{' '}
                    {shortDate(page.profile.latestReturn)}
                  </span>
                  <span className="text-ink-muted">
                    {chosenTripLengthSummary(
                      values,
                      page.profile.minNights,
                      page.profile.maxNights,
                    )}
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
              <div className="border-border flex flex-col gap-3 border-y py-4">
                <p className="text-ink-muted text-sm">
                  No search yet. Choose where from and when, and the trips will be priced here.
                </p>
                <ExploreSearchForm
                  label="Start a search"
                  values={values}
                  submitted={submitted}
                  airports={page.airports}
                  today={page.today}
                  errors={page.errors}
                  airportCodes={airportCodes}
                  defaults={{ origins: '', departureDate: '', returnDate: '', passengers: '2' }}
                />
                <Link
                  href="/"
                  className="text-tint-ink inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                >
                  Start a search on Discover
                  <Icon name="arrow-right" size={0.9} />
                </Link>
              </div>
            )}
          </div>

          {/*
            The planet's box. The globe itself is mounted once above this page
            and the front page (see `(stage)/layout.tsx`); this is only where it
            should sit, and what it should show.
          */}
          <StageSlot variant="explorer" className={EXPLORE_SLOT_CLASS}>
            <StageSync
              data={{
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
              }}
            />
          </StageSlot>
        </Container>
      </section>

      {page.outcome && page.profile && page.filters && !picking ? (
        /*
         * The results, in the stage's palette.
         *
         * `stage-scope` remaps the semantic tokens so every component inside
         * keeps its own contrast pairings on the night.
         */
        <section className="stage-scope bg-stage text-stage-ink">
          <Container size="wide" className="flex flex-col gap-6 pt-6 pb-16">
            {/* Dimmed and busy while a changed search is on its way; see `LiveResults`. */}
            {chosenInCountry && stage.country ? (
              <a
                href={`/explore?${withQuery(values, { fDest: null })}`}
                className="text-tint-ink inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
              >
                Back to the airports in {stage.country.name}
              </a>
            ) : null}
            <LiveResults>
              <SearchResults
                outcome={page.outcome}
                profile={page.profile}
                filters={page.filters}
                searchValues={values}
                resultAgeMs={page.resultAgeMs}
                updatedAgeMs={page.updatedAgeMs}
                images={images}
                stayLinks={stayLinks}
                countries={countries}
                planTrips={planTrips}
                changeSearchHref={`/?${query}&edit=1`}
                whatToDo={(destination, city, href) => (
                  <Suspense
                    fallback={
                      <p role="status" className="text-ink-muted text-sm">
                        Loading what to do in {city}
                      </p>
                    }
                  >
                    <WhatToDo
                      destination={destination}
                      city={city}
                      {...(href ? { destinationHref: href } : {})}
                    />
                  </Suspense>
                )}
                basePath="/explore"
                flexStrip={(() => {
                  const trip = flexTrip(
                    values,
                    page.outcome,
                    page.outcome.diagnostics.plan.currency,
                  );
                  return trip ? <FlexDatesSection {...trip} /> : null;
                })()}
                saveSearch={
                  <SaveSearchForm
                    query={query}
                    suggestedName={suggestedSearchName(values)}
                    signedIn={page.signedIn}
                    action={saveSearchAction}
                  />
                }
                closing={
                  <TripExtras
                    offers={offersForTrip()}
                    today={new Date().toISOString().slice(0, 10)}
                  />
                }
              />
            </LiveResults>
          </Container>
        </section>
      ) : null}

      {picking && stage.country ? (
        <section aria-labelledby="airports-heading" className="stage-scope text-stage-ink bg-stage">
          <Container size="wide" className="flex flex-col gap-5 pt-2 pb-16">
            <h2 id="airports-heading" className="font-display text-display-sm">
              Airports in {stage.country.name}
            </h2>
            <p className="text-ink-muted max-w-xl text-sm">
              Choose an airport to see its trips. Each price is the cheapest whole trip we found to
              that airport.
            </p>
            {railCards.length > 0 ? (
              <ol aria-label="Airports" className="home-rail">
                {railCards
                  .map((card) =>
                    toHomeCard(card, destinationImages as Record<string, { blur: string }>),
                  )
                  .map((card, index) => (
                    <DestinationCard
                      key={card.code}
                      card={card}
                      variant="tall"
                      index={index}
                      sizes="320px"
                      headingLevel={3}
                    />
                  ))}
              </ol>
            ) : (
              <p role="status" className="text-ink-muted text-sm">
                No airport in {stage.country.name} could be priced for these dates. Try another
                country or other dates.
              </p>
            )}
          </Container>
        </section>
      ) : page.outcome ? (
        /*
         * After a search, the places the search was not about: the same card the
         * home page uses. One card that only repeats the place already searched
         * is not a section, so with nothing else to show there is none.
         */
        otherCards.length > 0 ? (
          <section
            aria-labelledby="other-places-heading"
            className="stage-scope text-stage-ink bg-stage"
          >
            <Container size="wide" className="flex flex-col gap-5 pt-2 pb-16">
              <h2 id="other-places-heading" className="font-display text-display-sm">
                Other places we can price
              </h2>
              <ol aria-label="Other destinations" className="home-rail">
                {otherCards.map((card, index) => (
                  <DestinationCard
                    key={card.code}
                    card={card}
                    variant="tall"
                    index={index}
                    sizes="320px"
                    headingLevel={3}
                  />
                ))}
              </ol>
            </Container>
          </section>
        ) : null
      ) : (
        <DestinationRail
          awaitingCountry={page.awaitingCountry}
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
          pricesLoading={page.pricesLoading}
          controls={
            <StageControls
              mode={page.mode}
              modeHref={page.modeHref}
              action="/explore"
              carry={countryCarry}
              counts={stage.countryCounts}
              selected={stage.country}
            />
          }
        />
      )}
    </div>
  );
}
