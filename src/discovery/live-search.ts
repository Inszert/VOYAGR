import { cacheKey, getCacheStore, readThrough, type CacheStore } from '@/cache';
import type { IsoDateTime } from '@/core/trip/types';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import type { DataSource } from '@/providers/data-source';
import { dependenciesFor } from '@/search/dependencies';
import { searchFormDefaults } from '@/search/form-defaults';
import { runSearch } from '@/search/orchestrator';
import type { SearchOutcome, SearchRequest } from '@/search/types';

/**
 * A search the visitor asked for, answered now.
 *
 * The owner's rule for flight searches: a route or day that is not stored yet is asked of the
 * vendor live, inside the one search's call ceiling (`maxProviderCalls`, 120 by default), saved
 * for an hour and shown. It does not wait for the background worker and does not say "not loaded
 * yet" while a live answer is possible. The landing page's many-places snapshot is a different
 * thing and stays with the worker (`discovery/snapshot.ts`); nothing here is used for it.
 *
 * The call goes through `runSearch`, so every provider call still takes the shared per-vendor
 * limiter, the ceiling still applies, and a vendor that fails or is rate limited degrades the
 * search rather than throwing from here.
 */

const log = getLogger('discovery.live-search');

/** One hour, the owner's rule. A younger stored result is read; an older one is asked again. */
export const LIVE_SEARCH_FRESH_MS = 60 * 60 * 1000;

/** What the page says when the live answer could not be had and nothing is stored. */
export const LIVE_SEARCH_FAILED_MESSAGE =
  'Live prices could not be loaded just now. Try again in a moment.';

/** The three-letter codes in a typed list; words such as "anywhere" are not codes. */
export function airportCodesIn(value: string | undefined): string[] {
  const codes = (value ?? '')
    .split(/[\s,]+/)
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code) && code !== 'ANY');
  return [...new Set(codes)];
}

/**
 * The submitted values, with what a short form leaves out filled from defaults.
 *
 * A route typed in the compact bar (where from, where to, who, when) carries no budget, so it
 * never validated and the page fell back to "prices are loading". With both ends typed the
 * question is clear, so the missing fields are the traveller's saved settings or the form's
 * defaults, and what was typed always wins. A form with no origin and destination typed is left
 * exactly as it came.
 */
export function withRouteDefaults(
  values: Readonly<Record<string, string | undefined>>,
  today: string,
  saved: Readonly<Record<string, string>>,
): Readonly<Record<string, string | undefined>> {
  if (airportCodesIn(values.origins).length === 0) return values;
  if (airportCodesIn(values.destinations).length === 0) return values;

  const typed = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ''),
  );

  // Dates typed without a preset mean those dates, widened by nothing.
  const hasDates = typed.departureDate !== undefined && typed.returnDate !== undefined;
  const flexibility = typed.flexibility ?? (hasDates ? 'exact' : undefined);

  return {
    ...searchFormDefaults(today),
    ...saved,
    ...typed,
    ...(flexibility ? { flexibility } : {}),
  };
}

export interface LiveSearchDeps {
  readonly store?: CacheStore;
  readonly run?: (request: SearchRequest, source: DataSource) => Promise<SearchOutcome>;
  readonly now?: () => number;
}

export type LiveSearchResult =
  | {
      readonly ok: true;
      readonly outcome: SearchOutcome;
      readonly ageMs: number;
      readonly observedAt: IsoDateTime | null;
    }
  | { readonly ok: false; readonly message: string };

/**
 * The stored result for this request if it is under an hour old, otherwise one live search,
 * stored and returned. Never throws: a failure is a plain message the page shows.
 */
export async function liveSearch(
  request: SearchRequest,
  source: DataSource,
  deps: LiveSearchDeps = {},
): Promise<LiveSearchResult> {
  const run = deps.run ?? ((req, src) => runSearch(req, dependenciesFor(src)));

  try {
    // Cached at the page, never inside `runSearch`: a Travel Watch refresh exists to find out
    // whether the price moved. The key and the freshness rule are the page's own.
    const cached = await readThrough(
      deps.store ?? getCacheStore(),
      cacheKey('search', { request, source }),
      {
        freshMs: LIVE_SEARCH_FRESH_MS,
        staleMs: 0,
        load: () => run(request, source),
        ...(deps.now ? { now: deps.now } : {}),
      },
    );

    if (cached.value === null) {
      log.warn({ err: cached.error }, 'live search failed and nothing was stored');
      return {
        ok: false,
        message: isAppError(cached.error) ? cached.error.publicMessage : LIVE_SEARCH_FAILED_MESSAGE,
      };
    }

    return {
      ok: true,
      outcome: cached.value,
      ageMs: cached.ageMs ?? 0,
      observedAt: cached.observedAt,
    };
  } catch (error) {
    log.warn({ err: error }, 'live search could not be run');
    return {
      ok: false,
      message: isAppError(error) ? error.publicMessage : LIVE_SEARCH_FAILED_MESSAGE,
    };
  }
}
