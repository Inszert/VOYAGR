import type { ReactNode } from 'react';
import { Button, Disclosure, Icon, UpdatedAgo } from '@/components/ui';
import { shortDate } from '@/lib/display-date';
import './explore.css';
import { HeaderOffset } from './header-offset';
import type { PlanTrip } from './add-to-plan';
import { explainTrip } from '@/search/explain';
import {
  anyArrivalKnown,
  applyFilters,
  hasActiveFilters,
  parseSort,
  sortTrips,
  type ResultFilters,
} from '@/search/filters';
import { EmptyState } from '@/components/ui';
import { buildDateBreakdown } from '@/search/date-options';
import { DateOptions } from './date-options';
import { EmptySearch } from './empty-search';
import { ResultFiltersPanel } from './result-filters';
import { SortSelect } from './sort-select';
import type { RankedTrip, SearchOutcome } from '@/search/types';
import type { SearchProfile } from '@/core/trip/types';
import type { StayLinkOffer } from '@/core/stay/types';
import type { DestinationImage } from '@/providers/imagery/types';
import { offersFor, offersForTrip } from '@/booking/partners';
import { YourTrip } from './your-trip';
import { TripRow } from './trip-row';
import { buildTrip } from '@/search/trip-builder';
import { dealAgainstTypical } from '@/search/deal-score';
import { budgetWhatIf } from '@/search/what-if';
import { WhatIfPanel } from './what-if-panel';
import { FiltersDisclosure, FiltersPanel, FiltersToggle } from './live-search';
import { NearbyAirportsPanel } from './nearby-airports-panel';
import { RouteLines } from './route-lines';
import { MAX_ROUTE_LINES } from '@/discovery/search-routes';
import { nearbyOrigins } from '@/search/destination-names';

/**
 * The results list.
 *
 * Three things have to be true here, and they are why this is not just a map
 * over an array:
 *
 *  - A degraded search says so. If a provider failed, the user is looking at an
 *    incomplete answer and is told before they conclude "there is nothing".
 *  - An empty result set explains itself. `nearMisses` carry their violations,
 *    so "no trips" becomes "these came close, and here is what was wrong".
 *  - How the answer was produced is inspectable rather than hidden, because a
 *    ranked list the user cannot interrogate is a list they have to trust.
 */

export interface SearchResultsProps {
  outcome: SearchOutcome;
  /** Needed to re-score a swapped trip against what the user actually asked for. */
  profile: SearchProfile;
  filters: ResultFilters;
  /** The search these filters narrow, carried into the filter form. */
  searchValues: Readonly<Record<string, string | undefined>>;
  /** How long ago these results were computed. Zero for a fresh search. */
  resultAgeMs?: number;
  /**
   * A photograph per destination, keyed by airport code.
   *
   * Resolved by the page, not here: this component renders what it is handed
   * and never goes looking for anything. An absent entry is normal and the
   * cards are built for it.
   */
  images?: ReadonlyMap<string, DestinationImage>;
  /**
   * "Find a stay" links for trips that have no priced stay, keyed by candidate
   * id. Resolved by the page for the same reason as `images`.
   */
  stayLinks?: ReadonlyMap<string, StayLinkOffer>;
  /** The page the results are on, for every link that narrows or rebuilds them. */
  basePath?: string;
  /**
   * The "keep looking" card for this search, rendered by the page because it
   * needs the raw query string and the save action. Shown beside the results
   * rather than above them, with the rest of what is said about the search
   * itself rather than about any one trip in it.
   */
  saveSearch?: ReactNode;
  /** How old the prices behind this page are, for the header's "Updated" line. */
  updatedAgeMs?: number | null;
  /** The flexible-dates strip, placed above the list. */
  flexStrip?: ReactNode;
  /** The partner section, placed in the closing band. */
  closing?: ReactNode;
  /** Country names by airport code, so a card says "Malta", not "MT". */
  countries?: ReadonlyMap<string, string>;
  /** The signed-in person's trips, for "Add to my plan". Null when signed out. */
  planTrips?: readonly PlanTrip[] | null;
  /** Where "Change the search" goes, for an empty result. */
  changeSearchHref?: string;
  /**
   * "What to do in <city>" for the trip being built. Resolved by the page, which
   * owns the places loader; this component only places it.
   */
  whatToDo?: (destination: string, city: string, destinationHref?: string) => ReactNode;
}

/** The builder's parameters: which trip, and which flight and hotel in it. */
const BUILD_KEYS = ['tTrip', 'tFlight', 'tHotel'] as const;

/** Whole minutes, because "3 minutes ago" is the honest resolution here. */
function minutesAgo(ageMs: number): number {
  return Math.floor(ageMs / 60_000);
}

export function SearchResults({
  outcome,
  profile,
  filters,
  searchValues,
  resultAgeMs = 0,
  images,
  stayLinks,
  basePath = '/explore',
  saveSearch,
  updatedAgeMs,
  flexStrip,
  closing,
  countries,
  planTrips = null,
  changeSearchHref,
  whatToDo,
}: SearchResultsProps) {
  const { nearMisses, diagnostics } = outcome;
  const ageMinutes = minutesAgo(resultAgeMs);
  const view = searchValues.view === 'flight' ? 'flight' : 'trip';

  // Narrowed here rather than in the search: filters remove trips the search
  // already paid for, and re-running it per chip would cost provider calls.
  const { trips: filteredTrips, hidden } = applyFilters(outcome.results, filters);
  // Cheapest first unless the address says otherwise: the first thing a person
  // comparing trips wants is the lowest total.
  const sort = parseSort(searchValues.fSort);
  const results = sortTrips(filteredTrips, sort);
  const filtered = hasActiveFilters(filters);

  // Which departure airport has the cheapest trip, said only when the trips
  // come from more than one. The ordering is the engine's `sortTrips`, not a
  // comparison made here.
  const originCodes = new Set(results.map((trip) => trip.candidate.origin));
  const cheapestOrigin =
    originCodes.size > 1 ? (sortTrips(results, 'cheapest')[0]?.candidate.origin ?? null) : null;

  /** This search, with some parameters changed and some removed. */
  const linkWith = (changes: Readonly<Record<string, string | null>>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchValues)) {
      if (typeof value === 'string' && value !== '' && !(key in changes)) params.set(key, value);
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value !== null) params.set(key, value);
    }
    return `${basePath}?${params.toString()}`;
  };

  /*
   * The trip being built: the one the URL names, or the best match.
   *
   * It is looked up among the trips the filters left, so a filter that rules
   * it out ends the build rather than showing a trip the list says is hidden.
   */
  const focusId = searchValues.tTrip ?? null;
  const focus =
    (focusId ? [...results, ...nearMisses].find((trip) => trip.candidate.id === focusId) : null) ??
    results[0] ??
    null;
  const built = focus
    ? buildTrip({
        outcome,
        profile,
        original: focus,
        flightId: focus.candidate.id === focusId ? (searchValues.tFlight ?? null) : null,
        hotelId: focus.candidate.id === focusId ? (searchValues.tHotel ?? null) : null,
      })
    : null;
  const others = focus ? results.filter((trip) => trip !== focus) : results;
  const closeCalls = focus ? nearMisses.filter((trip) => trip !== focus) : nearMisses;

  const noBuild = Object.fromEntries(BUILD_KEYS.map((key) => [key, null]));

  const destinationLabel = searchValues.destinations?.trim()
    ? searchValues.destinations
    : 'anywhere';

  /** The destination page for a trip, carrying the search's dates and party over. */
  const destinationHref = (trip: RankedTrip) => {
    const { candidate } = trip;
    const params = new URLSearchParams({
      startDate: candidate.dates.departureDate,
      endDate: candidate.dates.returnDate,
      origin: candidate.origin,
      departureDate: candidate.dates.departureDate,
      returnDate: candidate.dates.returnDate,
      passengers: String(candidate.passengers),
      currency: trip.cost.total.currency,
    });
    return `/destinations/${candidate.destination.toLowerCase()}?${params.toString()}`;
  };

  const countryOf = (trip: RankedTrip) => countries?.get(trip.candidate.destination) ?? null;

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-6">
      <HeaderOffset />

      {/*
        The header: how many, between where and where, when, and how fresh.

        The heading counts what matched, not what fits on the page. Titling a
        capped list "10 trips match" when 192 did would be a number the user
        could act on and we made up.
      */}
      <header className="flex flex-col gap-2">
        <h2 id="results-heading" className="text-ink font-display text-display-sm">
          {diagnostics.eligibleCount > 0
            ? `${diagnostics.eligibleCount} ${diagnostics.eligibleCount === 1 ? 'trip' : 'trips'} match`
            : 'No trip matched'}
        </h2>
        <div className="text-ink flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium">
          <span>
            {profile.origins.join(', ')}
            <span aria-hidden="true" className="text-dim mx-1.5">
              →
            </span>
            <span className="sr-only"> to </span>
            {destinationLabel}
          </span>
          <span className="text-ink-muted font-normal tabular-nums">
            {shortDate(profile.earliestDeparture)} to {shortDate(profile.latestReturn)}
          </span>
          {updatedAgeMs !== undefined ? (
            <UpdatedAgo ageMs={updatedAgeMs} className="text-ink-muted" />
          ) : null}
        </div>
        <p className="text-ink-muted text-sm">
          {results.length < diagnostics.eligibleCount ? `Showing the best ${results.length}. ` : ''}
          Considered {diagnostics.candidatesEvaluated} combinations across{' '}
          {diagnostics.plan.destinations.length}{' '}
          {diagnostics.plan.destinations.length === 1 ? 'destination' : 'destinations'}.
        </p>
        {diagnostics.plan.destinationsRequested <= MAX_ROUTE_LINES ? (
          <RouteLines
            origins={diagnostics.plan.origins}
            destinations={diagnostics.plan.destinations}
          />
        ) : null}
      </header>

      {/*
        One quiet toolbar. It sticks under the site header once the list
        scrolls beneath it (the header's height is measured, not assumed), and
        on a phone it stays in the flow, because two rows of controls pinned
        to the top of a small screen cost more than they give.

        Which price leads each result is a reading of the same search, not a
        new one: the ranking is the whole trip's either way, and both figures
        are the engine's. Links, so the choice is part of the address.
      */}
      <FiltersDisclosure>
        <div className="voyagr-toolbar border-stage-glass-border bg-stage-glass backdrop-blur-glass static flex flex-wrap items-end justify-between gap-x-3 gap-y-3 rounded-(--radius-card) border px-3 py-2.5 sm:sticky sm:gap-x-6">
          <SortSelect
            value={sort}
            action={basePath}
            hidden={Object.fromEntries(
              Object.entries(searchValues).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string' &&
                  entry[1] !== '' &&
                  entry[0] !== 'fSort' &&
                  !(BUILD_KEYS as readonly string[]).includes(entry[0]),
              ),
            )}
          />
          {diagnostics.eligibleCount > 0 ? <FiltersToggle /> : null}
          <nav
            aria-label="Price shown"
            className="border-border flex rounded-(--radius-pill) border p-1"
          >
            {(
              [
                ['trip', 'Whole trip'],
                ['flight', 'Flights only'],
              ] as const
            ).map(([option, text]) => (
              <a
                key={option}
                href={linkWith({ view: option })}
                aria-current={view === option ? 'page' : undefined}
                className={
                  view === option
                    ? 'bg-tint-ink text-surface inline-flex min-h-11 items-center rounded-(--radius-pill) px-3 text-sm font-semibold whitespace-nowrap sm:px-4'
                    : 'text-ink-muted hover:text-ink ease-standard inline-flex min-h-11 items-center rounded-(--radius-pill) px-3 text-sm whitespace-nowrap transition-colors sm:px-4'
                }
              >
                {text}
              </a>
            ))}
          </nav>
        </div>

        {/*
        Nearby airports, above the results and always in view: adding one is a
        decision about the search, not a detail to be found in a closed panel.
      */}
        <NearbyAirportsPanel
          airports={nearbyOrigins(profile.origins).slice(0, 5)}
          hrefFor={(code) =>
            linkWith({ ...noBuild, origins: [...profile.origins, code].join(', ') })
          }
        />

        {diagnostics.eligibleCount > 0 ? (
          <FiltersPanel className="bg-surface-sunken border-border grid items-start gap-8 rounded-(--radius-card) border p-4 sm:p-6 lg:grid-cols-2">
            <ResultFiltersPanel
              filters={filters}
              searchValues={searchValues}
              hidden={hidden}
              currency={profile.targetBudget.currency}
              basePath={basePath}
              origin={profile.origins.join(', ')}
              arrivalsKnown={anyArrivalKnown(outcome.results)}
            />
            <WhatIfPanel
              steps={budgetWhatIf(outcome, profile)}
              hrefFor={(ceiling) => linkWith({ maxBudget: String(ceiling) })}
            />
          </FiltersPanel>
        ) : null}
      </FiltersDisclosure>

      {/*
        Quotes the vendor no longer stands behind, or observed too long ago.
        Said before the trips, because a price that may have moved is the one
        surprise worth leading with.
      */}
      {diagnostics.quoteFreshness.stale > 0 ? (
        <p role="status" className="text-ink-muted text-sm">
          <span className="text-caution-ink font-medium">Some prices may have moved.</span>{' '}
          {diagnostics.quoteFreshness.stale} of these trips{' '}
          {diagnostics.quoteFreshness.stale === 1 ? 'carries' : 'carry'} an older quote; check the
          price before booking.{' '}
          <a
            href={linkWith({})}
            className="text-tint-ink inline-flex min-h-11 items-center font-medium underline underline-offset-4"
          >
            Search again
          </a>
        </p>
      ) : null}

      {/*
        A provider that did not answer, in plain words: what is missing, what
        that means for the list, and a way to ask again.
      */}
      {diagnostics.degraded ? (
        <div
          role="status"
          className="border-caution-500/30 bg-caution-500/10 flex flex-col gap-3 rounded-(--radius-card) border p-4"
        >
          <div>
            <h3 className="text-caution-ink text-sm font-semibold">This search is incomplete</h3>
            <p className="text-ink mt-1 text-sm">
              One or more travel data sources did not answer, so there may be trips we did not see.
            </p>
          </div>
          <ul className="flex flex-col gap-1">
            {diagnostics.issues.map((issue) => (
              <li key={`${issue.scope}-${issue.code}`} className="text-ink text-sm">
                <span className="text-caution-ink font-medium capitalize">
                  <span className="sr-only">Unavailable: </span>
                  {issue.kind}
                </span>
                {' — '}
                {issue.message}
              </li>
            ))}
          </ul>
          <a
            href={linkWith({})}
            className="text-tint-ink inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium underline underline-offset-4"
          >
            Try the search again
            <Icon name="arrow-right" size={0.9} aria-hidden="true" />
          </a>
        </div>
      ) : null}

      {/* The flexible-dates strip comes before the list: the dates are the first thing to move. */}
      {flexStrip}

      {/*
        The dates, across the whole width.

        A calendar with a price in every day is two months side by side on a
        desktop, and it is the first thing to choose, so it comes before the trips.
      */}
      {diagnostics.eligibleCount > 0 ? (
        <DateOptions
          breakdown={buildDateBreakdown(outcome)}
          searchValues={searchValues}
          selected={filters.dates}
          basePath={basePath}
          sources={diagnostics.sources}
          {...(changeSearchHref ? { changeSearchHref } : {})}
        />
      ) : null}

      <div className="flex min-w-0 flex-col gap-6">
        {results.length === 0 && filtered ? (
          // Different from "no trip matched": the search found trips and the
          // filters removed them, so the thing to change is the filters.
          <EmptyState
            title="Your filters hid every trip"
            description={`The search found ${diagnostics.eligibleCount}, and the filters above removed all of them. Loosen one to see them again.`}
            action={
              <Button asChild variant="secondary" size="md">
                <a
                  href={linkWith(
                    Object.fromEntries(
                      Object.keys(searchValues)
                        .filter((key) => key.startsWith('f'))
                        .map((key) => [key, null]),
                    ),
                  )}
                >
                  Clear the filters
                </a>
              </Button>
            }
          />
        ) : null}

        {built && focus ? (
          /*
            Your trip: the one being built, on a band of its own so it reads
            as the answer, with the other ways to do it below. Each band runs
            the full width; the 64px between them (40px on a phone) is the
            separation, not a box.
          */
          <div
            id="your-trip"
            className="before:bg-bg-alt relative scroll-mt-24 py-10 before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-screen before:-translate-x-1/2 lg:py-16"
          >
            <YourTrip
              built={built}
              profile={profile}
              reasons={explainTrip(built.trip, profile)}
              deal={dealAgainstTypical(built.trip, outcome.destinationSummaries)}
              view={view}
              nearMiss={!results.includes(focus)}
              stayLink={stayLinks?.get(built.trip.candidate.id) ?? null}
              transferOffer={offersFor('transfer')[0] ?? null}
              planTrips={planTrips}
              signedIn={planTrips !== null}
              tripHref={linkWith({
                tTrip: focus.candidate.id,
                tFlight: searchValues.tFlight ?? null,
                tHotel: searchValues.tHotel ?? null,
              })}
              extras={offersForTrip({ categories: ['esim', 'transfer', 'compensation'] })}
              destinationHref={destinationHref(built.trip)}
              calendarHref="#date-options-heading"
              {...(whatToDo
                ? {
                    whatToDo: whatToDo(
                      built.trip.candidate.destination,
                      built.trip.candidate.destinationName,
                      destinationHref(built.trip),
                    ),
                  }
                : {})}
              {...(saveSearch ? { watchHref: '#save-search-heading' } : {})}
              flightHref={(offerId) =>
                linkWith({
                  tTrip: focus.candidate.id,
                  tFlight: offerId,
                  tHotel: searchValues.tHotel ?? null,
                })
              }
              hotelHref={(offerId) =>
                linkWith({
                  tTrip: focus.candidate.id,
                  tHotel: offerId,
                  tFlight: searchValues.tFlight ?? null,
                })
              }
              resetHref={linkWith({ ...noBuild, tTrip: focus.candidate.id })}
            />
          </div>
        ) : null}

        {others.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-dim text-[11px] font-semibold tracking-[0.18em] uppercase">
              Compare
            </p>
            <h2 id="other-ways-heading" className="font-display text-ink text-display-sm">
              Other ways to do this trip
            </h2>
            <p className="text-ink-muted text-sm">
              Other dates and places this search priced. Open one to build it instead.
            </p>
          </div>
        ) : null}

        {others.length > 0 ? (
          /*
            The rest of the results: where, when, how and how much, and anything
            worth worrying about. One column, two from 1280px. Each
            opens in the builder.
          */
          <ol
            aria-labelledby="other-ways-heading"
            className="grid grid-cols-1 gap-4 xl:grid-cols-2"
          >
            {others.map((trip, index) => (
              <li key={trip.candidate.id} className="voyagr-reveal min-w-0">
                <TripRow
                  trip={trip}
                  rank={index + 1}
                  deal={dealAgainstTypical(trip, outcome.destinationSummaries)}
                  view={view}
                  cheapestOrigin={trip.candidate.origin === cheapestOrigin}
                  image={images?.get(trip.candidate.destination) ?? null}
                  country={countryOf(trip)}
                  buildHref={`${linkWith({ ...noBuild, tTrip: trip.candidate.id })}#your-trip`}
                />
              </li>
            ))}
          </ol>
        ) : focus || filtered ? null : (
          /*
            An empty result set is a state, not a sentence in a box. It says
            what happened and offers the one thing worth doing next: widening
            the dates, because a budget is usually what somebody meant and the
            calendar is usually what they can move.
          */
          <EmptySearch
            outcome={outcome}
            profile={profile}
            linkWith={linkWith}
            changeSearchHref={changeSearchHref}
          />
        )}

        {closeCalls.length > 0 ? (
          <section aria-labelledby="near-misses-heading" className="mt-4 flex flex-col gap-4">
            <h3 id="near-misses-heading" className="font-display text-ink text-2xl">
              Close, but outside your limits
            </h3>
            <ol className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {closeCalls.map((trip) => (
                <li key={trip.candidate.id} className="min-w-0">
                  {/* Rank is deliberately out of range: a near miss is not ranked. */}
                  <TripRow
                    trip={trip}
                    rank={-1}
                    view={view}
                    image={images?.get(trip.candidate.destination) ?? null}
                    country={countryOf(trip)}
                    buildHref={`${linkWith({ ...noBuild, tTrip: trip.candidate.id })}#your-trip`}
                  />
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>

      <Disclosure summary="How this search was run">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Date windows priced</dt>
            <dd className="text-ink tabular-nums">
              {diagnostics.plan.dateWindows.length} of {diagnostics.plan.dateWindowsAvailable}{' '}
              possible
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Provider calls</dt>
            <dd className="text-ink tabular-nums">{diagnostics.providerCalls}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Combinations built</dt>
            <dd className="text-ink tabular-nums">{diagnostics.candidatesAssembled}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Combinations scored</dt>
            <dd className="text-ink tabular-nums">{diagnostics.candidatesEvaluated}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Outside your limits</dt>
            <dd className="text-ink tabular-nums">{diagnostics.ineligibleCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Peak calls at once</dt>
            <dd className="text-ink tabular-nums">{diagnostics.peakProviderConcurrency}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Quotes still current</dt>
            <dd className="text-ink tabular-nums">
              {diagnostics.quoteFreshness.fresh} current · {diagnostics.quoteFreshness.stale} stale
              {diagnostics.quoteFreshness.unknown > 0
                ? ` · ${diagnostics.quoteFreshness.unknown} undated`
                : ''}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Prices observed</dt>
            <dd className="text-ink">
              {/*
                A reused result is a price observed some time ago. Saying so is
                cheaper than the alternative, which is a user acting on a fare
                that moved while the page sat in a cache.
              */}
              {ageMinutes < 1 ? 'Just now' : `${ageMinutes} minutes ago`}
            </dd>
          </div>
        </dl>
        {diagnostics.plan.dateWindows.length < diagnostics.plan.dateWindowsAvailable ? (
          <p className="text-ink-muted mt-3 text-sm">
            Your dates allow more combinations than one search prices. We sampled evenly across the
            window rather than searching only its first days.
          </p>
        ) : null}
      </Disclosure>

      {/*
        A calm closing band: keep looking, then the rest of the trip. The
        affiliate disclosure travels with the partner links inside it.
      */}
      {saveSearch || closing ? (
        <aside
          aria-label="About this search"
          className="bg-surface-sunken border-border mt-4 flex flex-col gap-10 rounded-(--radius-surface) border p-6 sm:p-10"
        >
          {saveSearch}
          {closing}
        </aside>
      ) : null}
    </section>
  );
}
