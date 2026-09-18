import { Badge, Card, Disclosure } from '@/components/ui';
import type { SearchOutcome } from '@/search/types';
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
}

export function SearchResults({ outcome }: SearchResultsProps) {
  const { results, nearMisses, diagnostics } = outcome;

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/*
          The heading counts what matched, not what fits on the page. Titling a
          capped list "10 trips match" when 192 did would be a number the user
          could act on and we made up.
        */}
        <h2 id="results-heading" className="text-ink text-xl font-semibold">
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

      {results.length > 0 ? (
        <ol className="flex flex-col gap-4">
          {results.map((trip, index) => (
            <li key={trip.candidate.id}>
              <TripCard trip={trip} rank={index} />
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
                <TripCard trip={trip} rank={-1} />
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
