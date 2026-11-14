import type { ReactNode } from 'react';
import { Badge, Button, DemoDataNotice, Disclosure } from '@/components/ui';
import { explainTrip } from '@/search/explain';
import {
  anyArrivalKnown,
  applyFilters,
  hasActiveFilters,
  parseSort,
  RESULT_SORTS,
  sortTrips,
  type ResultFilters,
} from '@/search/filters';
import { EmptyState } from '@/components/ui';
import { buildDateBreakdown } from '@/search/date-options';
import { DateOptions } from './date-options';
import { ResultFiltersPanel } from './result-filters';
import { SortSelect } from './sort-select';
import type { SearchOutcome } from '@/search/types';
import type { SearchProfile } from '@/core/trip/types';
import type { DestinationImage } from '@/providers/imagery/types';
import { TripCard } from './trip-card';
import { TripRow } from './trip-row';
import { buildTrip } from '@/search/trip-builder';
import { dealAgainstTypical } from '@/search/deal-score';
import { budgetWhatIf } from '@/search/what-if';
import { WhatIfPanel } from './what-if-panel';
import { NearbyAirportsPanel } from './nearby-airports-panel';
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
  /** The page the results are on, for every link that narrows or rebuilds them. */
  basePath?: string;
  /**
   * The "keep looking" card for this search, rendered by the page because it
   * needs the raw query string and the save action. Shown beside the results
   * rather than above them, with the rest of what is said about the search
   * itself rather than about any one trip in it.
   */
  saveSearch?: ReactNode;
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
  basePath = '/explore',
  saveSearch,
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
  const building = focus !== null && focus.candidate.id === focusId;

  const noBuild = Object.fromEntries(BUILD_KEYS.map((key) => [key, null]));

  /*
   * Whether there is anything to say beside the results at all.
   *
   * Filters and date options only mean something once there is a match to
   * narrow, but the "keep looking" card and the demo-data notice are true of
   * the search itself and belong here even when nothing matched - so the
   * column exists whenever any one of the three does, not only when the
   * instruments do.
   */
  const hasSidebar =
    diagnostics.eligibleCount > 0 || Boolean(saveSearch) || diagnostics.provenance === 'mock';

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          {/*
          The heading counts what matched, not what fits on the page. Titling a
          capped list "10 trips match" when 192 did would be a number the user
          could act on and we made up.
        */}
          <h2 id="results-heading" className="text-ink font-display text-display-sm">
            {diagnostics.eligibleCount > 0
              ? `${diagnostics.eligibleCount} ${diagnostics.eligibleCount === 1 ? 'trip' : 'trips'} match`
              : 'No trip matched'}
          </h2>
          <p className="text-ink-muted text-sm">
            {results.length < diagnostics.eligibleCount
              ? `Showing the best ${results.length}. `
              : ''}
            Considered {diagnostics.candidatesEvaluated} combinations across{' '}
            {diagnostics.plan.destinations.length}{' '}
            {diagnostics.plan.destinations.length === 1 ? 'destination' : 'destinations'}.
          </p>
        </div>

        {/*
          Which price leads each result.

          A reading of the same search, not a new one: the ranking is the
          whole trip's either way, and both figures are the engine's. Links,
          so the choice is part of the address like everything else here.
        */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
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
                    ? 'bg-tint-ink text-surface rounded-(--radius-pill) px-4 py-1.5 text-sm font-semibold'
                    : 'text-ink-muted hover:text-ink rounded-(--radius-pill) px-4 py-1.5 text-sm transition-colors'
                }
              >
                {text}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/*
        Quotes the vendor no longer stands behind, or observed too long ago.
        Counted by the search from each offer's own time and, where the
        vendor gives one, its validity window. Said before the trips, because
        a price that may have moved is the one surprise worth leading with.
      */}
      {diagnostics.quoteFreshness.stale > 0 ? (
        <div
          role="status"
          className="border-caution-500/30 bg-caution-500/10 rounded-(--radius-card) border p-4"
        >
          <h3 className="text-caution-ink text-sm font-semibold">Some prices may have moved</h3>
          <p className="text-ink mt-1 text-sm">
            {diagnostics.quoteFreshness.stale} of these trips{' '}
            {diagnostics.quoteFreshness.stale === 1 ? 'carries' : 'carry'} a quote that has expired
            or was observed a while ago. Search again, or check the price with the provider before
            booking.
          </p>
        </div>
      ) : null}

      {diagnostics.degraded ? (
        <div
          role="status"
          className="border-caution-500/30 bg-caution-500/10 rounded-(--radius-card) border p-4"
        >
          <h3 className="text-caution-ink text-sm font-semibold">This search is incomplete</h3>
          <p className="text-ink mt-1 text-sm">
            One or more travel data sources did not answer, so there may be trips we did not see.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {diagnostics.issues.map((issue) => (
              <li key={`${issue.scope}-${issue.code}`} className="text-ink text-sm">
                <Badge tone="caution" srPrefix="Unavailable">
                  {issue.kind}
                </Badge>{' '}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        The dates, across the whole width.

        A calendar with a price in every day is two months side by side on a
        desktop, which does not fit in the narrow column beside the trips - and
        it is the first thing to choose, so it comes before them.
      */}
      {diagnostics.eligibleCount > 0 ? (
        <DateOptions
          breakdown={buildDateBreakdown(outcome)}
          searchValues={searchValues}
          selected={filters.dates}
          basePath={basePath}
          sources={diagnostics.sources}
        />
      ) : null}

      {/*
        Two columns once there is room: the instruments on the left, the
        trips on the right.

        "What the dates are worth" and "Narrow these results" were two large
        panels stacked above the trips, so a person had to scroll past both to
        reach the first result. Beside the list they are where a control
        belongs: next to what it changes.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
        {hasSidebar ? (
          <aside aria-label="About this search" className="flex flex-col gap-8">
            {saveSearch}

            {/*
              Said beside the results rather than above them, with the rest of
              what this card already says about the search - but never later
              than the first thing a reader sees of it, because a notice that
              everything below is fictional is worthless underneath the
              fiction.
            */}
            {diagnostics.provenance === 'mock' ? (
              <DemoDataNotice sources={diagnostics.sources} />
            ) : null}

            {diagnostics.eligibleCount > 0 ? (
              <>
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
                <NearbyAirportsPanel
                  airports={nearbyOrigins(profile.origins).slice(0, 5)}
                  hrefFor={(code) =>
                    linkWith({ ...noBuild, origins: [...profile.origins, code].join(', ') })
                  }
                />
              </>
            ) : null}
          </aside>
        ) : null}

        <div
          className={
            hasSidebar ? 'flex min-w-0 flex-col gap-4' : 'flex min-w-0 flex-col gap-4 lg:col-span-2'
          }
        >
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
            <TripCard
              trip={built.trip}
              rank={results.includes(focus) ? 0 : -1}
              lead={RESULT_SORTS.find((option) => option.value === sort)?.label}
              deal={dealAgainstTypical(built.trip, outcome.destinationSummaries)}
              label={building ? 'Your trip' : undefined}
              view={view}
              provenance={diagnostics.provenance}
              sources={diagnostics.sources}
              reasons={explainTrip(built.trip, profile)}
              image={images?.get(built.trip.candidate.destination) ?? null}
              builder={{
                built,
                flightHref: (offerId) =>
                  linkWith({
                    tTrip: focus.candidate.id,
                    tFlight: offerId,
                    tHotel: searchValues.tHotel ?? null,
                  }),
                hotelHref: (offerId) =>
                  linkWith({
                    tTrip: focus.candidate.id,
                    tHotel: offerId,
                    tFlight: searchValues.tFlight ?? null,
                  }),
                dateHref: (choice) => linkWith({ ...noBuild, tTrip: choice.trip.candidate.id }),
                resetHref: linkWith({ ...noBuild, tTrip: focus.candidate.id }),
              }}
            />
          ) : null}

          {others.length > 0 ? (
            /*
              The rest of the results as rows: where, when, how and how much,
              and anything worth worrying about. Each opens in the builder.
            */
            <ol
              tabIndex={0}
              aria-label={`Other trips, ${others.length} more, scroll for the rest`}
              className="border-border max-h-[44rem] overflow-y-auto overscroll-contain border-t"
            >
              {others.map((trip, index) => (
                <li key={trip.candidate.id}>
                  <TripRow
                    trip={trip}
                    rank={index + 1}
                    deal={dealAgainstTypical(trip, outcome.destinationSummaries)}
                    view={view}
                    provenance={diagnostics.provenance}
                    image={images?.get(trip.candidate.destination) ?? null}
                    buildHref={`${linkWith({ ...noBuild, tTrip: trip.candidate.id })}#results-heading`}
                  />
                </li>
              ))}
            </ol>
          ) : focus || filtered ? null : (
            /*
          An empty result set is a state, not a sentence in a box.

          It says what happened, and it offers the one thing worth doing
          next. Widening the dates is that thing: a budget is usually what
          somebody meant, and the calendar is usually what they can move.
        */
            <EmptyState
              title="Nothing came in under your limits"
              description={
                nearMisses.length > 0
                  ? 'These were the closest, and each one says below what ruled it out.'
                  : 'Nothing was found within the dates, the budget and the destinations you set.'
              }
              action={
                <Button asChild variant="secondary" size="md">
                  <a href={linkWith({ ...noBuild, flexibility: 'flexible' })}>
                    Try more flexible dates
                  </a>
                </Button>
              }
            />
          )}

          {closeCalls.length > 0 ? (
            <section aria-labelledby="near-misses-heading" className="mt-6 flex flex-col gap-3">
              <h3 id="near-misses-heading" className="font-display text-ink text-2xl">
                Close, but outside your limits
              </h3>
              <ol className="border-border border-t">
                {closeCalls.map((trip) => (
                  <li key={trip.candidate.id}>
                    {/* Rank is deliberately out of range: a near miss is not ranked. */}
                    <TripRow
                      trip={trip}
                      rank={-1}
                      view={view}
                      provenance={diagnostics.provenance}
                      image={images?.get(trip.candidate.destination) ?? null}
                      buildHref={`${linkWith({ ...noBuild, tTrip: trip.candidate.id })}#results-heading`}
                    />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
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
    </section>
  );
}
