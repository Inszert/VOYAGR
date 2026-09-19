import type { Metadata } from 'next';
import { SearchForm } from '@/components/search/search-form';
import { SearchResults } from '@/components/search/search-results';
import { SaveSearchForm } from '@/components/watches/save-search-form';
import { saveSearchAction } from '@/app/actions/watches';
import { runSearch } from '@/search/orchestrator';
import { getSearchCache } from '@/search/cache';
import { parseSearchForm } from '@/search/schema';
import { resolveDestinationNames } from '@/search/destination-names';
import { getCurrentUser } from '@/auth/current-user';
import { preferencesToFormDefaults, readExplicitPreferences } from '@/auth/preferences';
import { getRepositories } from '@/db';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import type { SearchFormErrors } from '@/search/schema';
import type { SearchOutcome } from '@/search/types';

/**
 * Search page.
 *
 * The form submits as a GET, so a search is a URL: shareable, bookmarkable,
 * reloadable, and correct with the back button. That also means the page is
 * fully server-rendered and works before any JavaScript arrives.
 *
 * The page's job is to turn a query string into a `SearchRequest` and render
 * what came back. It computes nothing: every figure on screen was produced by
 * `src/core/` and carried here by `runSearch`.
 */

const log = getLogger('app.search-page');

export const metadata: Metadata = {
  title: 'Find a trip',
};

/** A GET form always submits its text inputs, so `origins` marks a real search. */
function wasSubmitted(params: Readonly<Record<string, string | undefined>>): boolean {
  return typeof params.origins === 'string';
}

/**
 * A starting name for a saved search.
 *
 * Built from what the user actually asked for, so the name means something the
 * moment they see it rather than being "Saved search 3".
 */
function suggestedSearchName(values: Record<string, string | undefined>): string {
  const destinations = (values.destinations ?? '').trim();
  const from = (values.earliestDeparture ?? '').slice(0, 7);

  if (destinations && from) return `${destinations} in ${from}`;
  return destinations || 'Saved search';
}

/** Repeated query keys collapse to the first value; the form never sends them. */
function firstValues(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(params)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }

  return flat;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = firstValues(await searchParams);

  // A signed-in user's saved preferences become the form's defaults. They are
  // defaults and nothing more: they never filter results or override a field
  // the user has actually filled in.
  const user = await getCurrentUser();
  const stored = user ? await getRepositories().preferences.find(user.id) : null;
  const defaults = preferencesToFormDefaults(readExplicitPreferences(stored));

  let outcome: SearchOutcome | null = null;
  let resultAgeMs = 0;
  let errors: SearchFormErrors = {};

  if (wasSubmitted(values)) {
    const parsed = parseSearchForm(values);

    if (parsed.ok) {
      const request = {
        ...parsed.value.request,
        destinationNames: resolveDestinationNames(parsed.value.request.destinations),
        // How many results a page should show is a presentation decision, so it
        // is made here rather than in the engine's defaults. The engine still
        // ranks everything, and the diagnostics still report how many matched.
        limits: { maxResults: 10 },
      };

      try {
        // Cached at the page, never inside `runSearch`: a Travel Watch refresh
        // exists to find out whether the price moved, and serving that from a
        // cache would be a monitoring loop monitoring its own memory.
        const cached = await getSearchCache().run(request, () => runSearch(request));
        outcome = cached.outcome;
        resultAgeMs = cached.ageMs;
      } catch (error) {
        // The planner rejects a profile that can describe no trip at all. Its
        // public message is written for a user; anything else is not.
        log.warn({ err: error }, 'search could not be run');
        errors = {
          form: isAppError(error)
            ? error.publicMessage
            : 'Something went wrong running that search.',
        };
      }
    } else {
      errors = parsed.error;
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Find a complete trip</h1>
        <p className="text-ink-muted mt-2 max-w-2xl">
          Flights, a hotel and the ride from the airport, priced together and ranked by what the
          whole trip is worth to you — not by the cheapest headline fare.
        </p>
      </div>

      <SearchForm values={values} defaults={defaults} errors={errors} />

      {outcome ? (
        <>
          <SaveSearchForm
            query={new URLSearchParams(
              Object.entries(values).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ).toString()}
            suggestedName={suggestedSearchName(values)}
            signedIn={Boolean(user)}
            action={saveSearchAction}
          />

          <SearchResults outcome={outcome} resultAgeMs={resultAgeMs} />
        </>
      ) : null}
    </div>
  );
}
