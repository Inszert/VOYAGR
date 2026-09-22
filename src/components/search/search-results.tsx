import { Badge, Card, DemoDataNotice, Disclosure } from '@/components/ui';
import { flightAlternatives, hotelAlternatives } from '@/search/alternatives';
import { explainTrip } from '@/search/explain';
import { applyFilters, hasActiveFilters, type ResultFilters } from '@/search/filters';
import { EmptyState } from '@/components/ui';
import { buildDateBreakdown } from '@/search/date-options';
import { DateOptions } from './date-options';
import { ResultFiltersPanel } from './result-filters';
import type { SearchOutcome } from '@/search/types';
import type { SearchProfile } from '@/core/trip/types';
import type { DestinationImage } from '@/providers/imagery/types';
import { TripCard } from './trip-card';

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
}

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
}: SearchResultsProps) {
  const { nearMisses, diagnostics } = outcome;
  const ageMinutes = minutesAgo(resultAgeMs);

  // Narrowed here rather than in the search: filters remove trips the search
  // already paid for, and re-running it per chip would cost provider calls.
  const { trips: results, hidden } = applyFilters(outcome.results, filters);
  const filtered = hasActiveFilters(filters);

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
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
          {results.length < diagnostics.eligibleCount ? `Showing the best ${results.length}. ` : ''}
          Considered {diagnostics.candidatesEvaluated} combinations across{' '}
          {diagnostics.plan.destinations.length}{' '}
          {diagnostics.plan.destinations.length === 1 ? 'destination' : 'destinations'}.
        </p>
      </div>

      {/*
        Before the results, not after them. A notice that everything below is
        fictional is worthless underneath the fiction.
      */}
      {diagnostics.provenance === 'mock' ? <DemoDataNotice /> : null}

      {diagnostics.degraded ? (
        <div
          role="status"
          className="border-caution-500/30 bg-caution-500/10 rounded-[--radius-card] border p-4"
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
        Above the filters and above the results, because it changes which
        results are worth looking at. A price comparison across dates placed
        under forty cards is a comparison nobody scrolls to.
      */}
      {diagnostics.eligibleCount > 0 ? (
        <DateOptions
          breakdown={buildDateBreakdown(outcome)}
          searchValues={searchValues}
          selected={filters.dates}
        />
      ) : null}

      {diagnostics.eligibleCount > 0 ? (
        <ResultFiltersPanel
          filters={filters}
          searchValues={searchValues}
          hidden={hidden}
          currency={profile.targetBudget.currency}
        />
      ) : null}

      {results.length === 0 && filtered ? (
        // Different from "no trip matched": the search found trips and the
        // filters removed them, so the thing to change is the filters.
        <EmptyState
          title="Your filters hid every trip"
          description={`The search found ${diagnostics.eligibleCount}, and the filters above removed all of them. Loosen one to see them again.`}
          action={
            <a
              href={`/?${new URLSearchParams(
                Object.entries(searchValues).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === 'string' && !entry[0].startsWith('f'),
                ),
              ).toString()}`}
              className="text-brand-ink text-sm underline underline-offset-4"
            >
              Clear the filters
            </a>
          }
        />
      ) : null}

      {results.length > 0 ? (
        <ol className="flex flex-col gap-4">
          {results.map((trip, index) => (
            <li key={trip.candidate.id}>
              {/*
                Alternatives are computed for the top result only. Evaluating
                every possible swap for forty cards would be work nobody asked
                for, and the top result is the one people actually examine.
              */}
              <TripCard
                trip={trip}
                rank={index}
                provenance={diagnostics.provenance}
                sources={diagnostics.sources}
                reasons={explainTrip(trip, profile)}
                image={images?.get(trip.candidate.destination) ?? null}
                {...(index === 0
                  ? {
                      flightAlternatives: flightAlternatives({ outcome, current: trip, profile }),
                      hotelAlternatives: hotelAlternatives({ outcome, current: trip, profile }),
                    }
                  : {})}
              />
            </li>
          ))}
        </ol>
      ) : (
        <Card>
          <p className="text-ink text-sm">
            Nothing came in under your limits.{' '}
            {nearMisses.length > 0
              ? 'These were the closest, with what ruled each one out.'
              : 'Try widening the dates, the budget or the destinations.'}
          </p>
        </Card>
      )}

      {nearMisses.length > 0 ? (
        <section aria-labelledby="near-misses-heading" className="flex flex-col gap-4">
          <h3 id="near-misses-heading" className="text-ink text-lg font-semibold">
            Close, but outside your limits
          </h3>
          <ol className="flex flex-col gap-4">
            {nearMisses.map((trip) => (
              <li key={trip.candidate.id}>
                {/* Rank is deliberately out of range: a near miss is not ranked. */}
                <TripCard
                  trip={trip}
                  rank={-1}
                  provenance={diagnostics.provenance}
                  sources={diagnostics.sources}
                  image={images?.get(trip.candidate.destination) ?? null}
                />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
