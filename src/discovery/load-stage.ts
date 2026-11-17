import { ANYWHERE } from '@/search/schema';
import { resolveWorldRegion } from '@/search/world-regions';
import { addDays, daysBetween } from '@/core/dates';
import { resolveEntitlements } from '@/core/entitlements';
import type { DataProvenance, SourceAttribution } from '@/core/trip/provenance';
import type { IsoDate, IsoDateTime, SearchProfile } from '@/core/trip/types';
import { getCurrentUser } from '@/auth/current-user';
import { preferencesToFormDefaults, readExplicitPreferences } from '@/auth/preferences';
import { searchFormDefaults } from '@/search/form-defaults';
import { getRepositories } from '@/db';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { cacheKey, getCacheStore, readThrough } from '@/cache';
import { requestCacheRefresh } from '@/cache/request-refresh';
import { ageOf } from '@/core/freshness';
import {
  listAirports,
  listPlaceableDestinations,
  resolveDestinationNames,
  type AirportSuggestion,
} from '@/search/destination-names';
import { parseFilters, type ResultFilters } from '@/search/filters';
import { runSearch } from '@/search/orchestrator';
import { parseSearchForm, type SearchFormErrors } from '@/search/schema';
import type { RankedTrip, SearchOutcome } from '@/search/types';
import { parseMapMode, type MapMode } from './map-model';
import { bandsToGeoJson, describeSeason, monthName, seasonModel } from './seasons';
import {
  buildDiscoveryQuery,
  DISCOVERY_WINDOW,
  getDiscoverySource,
  type DiscoveryAssumptions,
} from './snapshot';
import { recordSearch } from './record-search';
import { MAX_ROUTE_LINES } from './search-routes';
import { buildStageData, withQuery, type StageData } from './stage-data';
import { dependenciesFor } from '@/search/dependencies';
import { getActiveDataSource, type ActiveDataSource } from '@/providers/request-source';

/**
 * Loading a stage page.
 *
 * The homepage and the explorer are the same page with a different
 * composition: parse the query, run a search if one was asked for, otherwise
 * take the discovery snapshot, and turn whichever it was into what the stage
 * and the rail draw. One module, so the two routes cannot answer "where can I
 * go?" differently.
 *
 * Nothing here computes a figure. It decides what to run and passes the
 * results through.
 */

const log = getLogger('discovery.load-stage');

/**
 * How long a stored live-search result is reused: one hour, the owner's rule. A search younger
 * than this is read from the store; an older one is run again and saved. No stale window.
 */
export const LIVE_SEARCH_FRESH_MS = 60 * 60 * 1000;

export type StageAction = '/' | '/explore';

export interface StagePage {
  readonly values: Readonly<Record<string, string | undefined>>;
  readonly today: string;
  readonly signedIn: boolean;
  /** The traveller's saved preferences as form values. */
  readonly defaults: Readonly<Record<string, string>>;
  /** Those plus dates that are not in the past, for the compact form. */
  readonly formDefaults: Readonly<Record<string, string>>;
  /** Those plus a window that is not in the past, for the lenses. */
  readonly lensDefaults: Readonly<Record<string, string>>;
  readonly mode: MapMode;
  readonly outcome: SearchOutcome | null;
  /**
   * The best trip on the page, whether it came from a search or from the
   * discovery snapshot.
   *
   * The snapshot already prices whole trips - that is where the figures on
   * the globe come from - so showing the best of them is the page repeating
   * itself, not a second search dressed as a recommendation. Null when
   * nothing could be priced.
   */
  readonly recommended: RankedTrip | null;
  readonly profile: SearchProfile | null;
  readonly filters: ResultFilters | null;
  readonly resultAgeMs: number;
  /**
   * How long ago what the stage shows was observed, or null when it is not
   * dated. For "Updated 12 min ago"; the stage and a search both report it.
   */
  readonly updatedAgeMs: number | null;
  readonly errors: SearchFormErrors;
  readonly assumptions: DiscoveryAssumptions | null;
  /**
   * The world as the sun lights it on the dates in question, and a sentence
   * saying that is what it is.
   */
  readonly season: {
    readonly bands: ReturnType<typeof bandsToGeoJson>;
    readonly date: IsoDate;
    readonly month: string;
    readonly description: string;
  };
  readonly provenance: DataProvenance;
  /**
   * Who supplied each part, so a notice can name what is demo data rather
   * than declaring the whole page fictional because one fixture is in it.
   */
  readonly sources: readonly SourceAttribution[];
  /** Which adapters answered, and what the switch is set to. */
  readonly dataSource: ActiveDataSource;
  /** The snapshot was attempted and could not be produced. */
  readonly unpriced: boolean;
  /**
   * Unpriced because nothing is cached yet (first boot), not because pricing
   * failed: the worker has been asked and the page says so.
   */
  readonly pricesLoading: boolean;
  readonly stage: StageData;
  readonly carry: Readonly<Record<string, string>>;
  readonly destinationsDefault: string;
  readonly destinationsHint: string;
  /** Every airport the catalogue knows, for the search suggestions. */
  readonly airports: readonly AirportSuggestion[];
  modeHref(mode: MapMode): string;
  clearCountryHref(): string;
  readonly navigation: { readonly path: StageAction; readonly query: string };
}

/**
 * The middle of two dates, as a date.
 *
 * Counted in days from the epoch with `daysBetween` and stepped with
 * `addDays`, rather than averaging two parsed `Date`s, which is the same
 * timezone trap `src/core/dates` exists to keep out of this codebase.
 */
function middleDate(from: IsoDate, to: IsoDate): IsoDate {
  const span = daysBetween(from, to);
  return span <= 0 ? from : addDays(from, Math.floor(span / 2));
}

/** A GET form always submits its text inputs, so `origins` marks a real search. */
export function wasSubmitted(params: Readonly<Record<string, string | undefined>>): boolean {
  return typeof params.origins === 'string';
}

/** Repeated query keys collapse to the first value; the form never sends them. */
export function firstValues(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(params)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }

  return flat;
}

export async function loadStagePage(
  values: Readonly<Record<string, string | undefined>>,
  action: StageAction,
): Promise<StagePage> {
  // Read once, on the server, so every date on the page agrees about what
  // day it is.
  const today = new Date().toISOString().slice(0, 10);

  /*
   * Which adapters answer this page.
   *
   * Read once, here, and passed down - never looked up again further in.
   * A second read could disagree with the first if the cookie changed
   * mid-render, and a page whose globe and whose results came from
   * different sources is the one thing the switch must never produce.
   */
  const dataSource = await getActiveDataSource();

  const user = await getCurrentUser();
  const stored = user ? await getRepositories().preferences.find(user.id) : null;
  /*
   * The party in the address wins over the saved one: "4 travellers" chosen
   * in the search bar prices the globe, the cards and every link out of them
   * for four. The snapshot for that party is its own cache entry; until the
   * worker has filled it, the page shows the default party's and says which
   * party it is for (the rail's "Priced for N travellers").
   */
  const party = Number(values.passengers);
  const defaults: Record<string, string> = {
    ...preferencesToFormDefaults(readExplicitPreferences(stored)),
    ...(Number.isSafeInteger(party) && party >= 1 && party <= 9
      ? { passengers: String(party) }
      : {}),
  };

  const mode = parseMapMode(values.mapMode);

  let outcome: SearchOutcome | null = null;
  let profile: SearchProfile | null = null;
  let resultAgeMs = 0;
  let observedAt: IsoDateTime | null = null;
  let errors: SearchFormErrors = {};

  if (wasSubmitted(values)) {
    // `anywhere` in the destination expands to everything we can price.
    const parsed = parseSearchForm(values, listPlaceableDestinations(), resolveWorldRegion);

    if (parsed.ok) {
      // Anonymous visitors get the default plan's allowance, so the limit is
      // resolved from a plan in both cases rather than being a constant here.
      const entitlements = user?.entitlements ?? resolveEntitlements();
      profile = parsed.value.request.profile;

      const request = {
        ...parsed.value.request,
        destinationNames: resolveDestinationNames(parsed.value.request.destinations),
        limits: {
          // How many results a page shows is a presentation decision, so it
          // is made here rather than in the engine's defaults.
          maxResults: 10,
          // Resolved from the plan, not hard-coded. The account page tells
          // the user this number; it has to be the one the search applies.
          maxDestinations: entitlements.maxDestinationsPerSearch,
        },
      };

      try {
        // Cached at the page, never inside `runSearch`: a Travel Watch
        // refresh exists to find out whether the price moved. Live, but
        // remembered for an hour by query key, with no stale window -
        // an explicit search is a question about now.
        const cached = await readThrough(
          getCacheStore(),
          cacheKey('search', { request, source: dataSource.effective }),
          {
            freshMs: LIVE_SEARCH_FRESH_MS,
            staleMs: 0,
            load: () => runSearch(request, dependenciesFor(dataSource.effective)),
          },
        );

        // No value means the run failed and nothing was cached: report it the
        // way a thrown search always was.
        if (cached.value === null) {
          throw cached.error instanceof Error ? cached.error : new Error('search failed');
        }

        outcome = cached.value;
        resultAgeMs = cached.ageMs ?? 0;
        observedAt = cached.observedAt;

        // Signed-in visitors only; never throws, and the page does not wait on a failure.
        if (user) {
          await recordSearch(getRepositories().tripSearches, {
            userId: user.id,
            profile: request.profile,
            destinations: request.destinations,
          });
        }
      } catch (error) {
        log.warn({ err: error }, 'search could not be run');
        errors = {
          form: isAppError(error)
            ? error.publicMessage
            : 'Something went wrong running that search.',
        };
      }
    } else {
      /*
       * A form that was filled in sends every field, so a field that is simply
       * absent from the address was never typed: the link (a globe label, a
       * shared half-search) only carried some of the search. That is not the
       * visitor's mistake, and Zod's own "expected string, received undefined"
       * is not a sentence for a page - so only what was actually entered is
       * complained about, and the rest keeps the form's defaults.
       */
      errors = Object.fromEntries(
        Object.entries(parsed.error).filter(
          ([field]) => field === 'form' || values[field] !== undefined,
        ),
      );
    }
  }

  // The stage shows the search when there is one, and the discovery snapshot
  // when there is not. Never both: two answers to "where can I go?" on one
  // page would be two different searches pretending to be one.
  const discoveryInput = { today, defaults, source: dataSource.effective };
  const discovery = outcome ? null : await getDiscoverySource().read(discoveryInput);
  const snapshot = discovery?.snapshot ?? null;

  // The worker fills the cache; a page only says what it found missing or old.
  // Not awaited: the visitor does not wait on the queue either.
  if (discovery?.refreshWanted) void requestCacheRefresh(discoveryInput);
  const stageOutcome = outcome ?? snapshot?.outcome ?? null;
  const stageObservedAt = outcome ? observedAt : (snapshot?.observedAt ?? null);
  const provenance = stageOutcome?.diagnostics.provenance ?? 'unavailable';
  const sources = stageOutcome?.diagnostics.sources ?? [];

  const filters = outcome && profile ? parseFilters(values, profile.targetBudget.currency) : null;

  const origins = outcome
    ? (profile?.origins ?? [])
    : (snapshot?.assumptions.origins ?? [defaults.origins ?? searchFormDefaults(today).origins!]);

  /*
   * What a chip or card does. After a search: narrow the results already on
   * the page, which costs no provider call. Before one: run a search to that
   * place, under the same assumptions the snapshot priced it with, so the
   * results are the trips the chip's figure came from.
   */
  const discoveryQuery = buildDiscoveryQuery({ today, defaults });
  const hrefFor = outcome
    ? (destination: string) => `${action}?${withQuery(values, { fDest: destination })}`
    : (destination: string) =>
        `/?${new URLSearchParams({ ...discoveryQuery, destinations: destination }).toString()}`;

  const plan = stageOutcome?.diagnostics.plan;
  const aboutHrefFor = (destination: string) =>
    `/destinations/${destination.toLowerCase()}${
      plan
        ? `?${new URLSearchParams({
            startDate: plan.earliestDate,
            endDate: plan.latestDate,
            passengers: String(plan.passengers),
            currency: plan.currency,
            // What the destination page's "fly earlier or later" strip moves:
            // where from, and one real pair of dates rather than the whole window.
            ...(plan.origins[0] ? { origin: plan.origins[0] } : {}),
            ...(plan.dateWindows[0]
              ? {
                  departureDate: plan.dateWindows[0].departureDate,
                  returnDate: plan.dateWindows[0].returnDate,
                }
              : {}),
          }).toString()}`
        : ''
    }`;

  const stage = buildStageData({
    outcome: stageOutcome,
    mode,
    country: values.country,
    selectedDestination: filters?.destination ?? null,
    origins,
    // Named places only: "anywhere" is every airport, and a line to each is a
    // tangle. Those keep the priced routes alone.
    routeDestinations:
      outcome && outcome.diagnostics.plan.destinationsRequested <= MAX_ROUTE_LINES
        ? outcome.diagnostics.plan.destinations
        : [],
    provenance,
    assumptions: snapshot?.assumptions ?? null,
    hrefFor,
    actionLabel: outcome ? 'Show only trips to' : 'Search trips to',
    aboutHrefFor,
  });

  // Carried through the search and the country picker: the selection and
  // the ranking, so submitting either keeps the globe as it was.
  const carry: Record<string, string> = {};
  if (stage.country) carry.country = stage.country.adm0;
  if (values.mapMode) carry.mapMode = values.mapMode;

  /*
   * "Anywhere" unless the globe has been used to narrow it.
   *
   * The field used to arrive pre-filled with every destination code we can
   * price, which is accurate and unreadable - a wall of three-letter codes
   * reads as a setting somebody else chose rather than as an open question.
   * The word means the same thing to the parser and the opposite thing to a
   * reader. Picking a country on the globe is a deliberate narrowing, so
   * that still wins.
   */
  const destinationsDefault =
    stage.countryDestinations.length > 0 ? stage.countryDestinations.join(', ') : ANYWHERE;

  const destinationsHint = stage.country
    ? stage.countryDestinations.length > 0
      ? `${stage.country.name}'s airports, or any codes.`
      : `Nothing in ${stage.country.name} yet, so everywhere we can price.`
    : 'Anywhere we can price, or type airport codes.';

  // Dates a stranger's first search should not have to fix: two weeks out,
  // a week long, three days either side. The lenses keep the window form.
  const earliest = addDays(today, DISCOVERY_WINDOW.startsInDays);
  const window = {
    earliestDeparture: earliest,
    latestReturn: addDays(earliest, DISCOVERY_WINDOW.lengthDays),
  };
  /*
   * The two dates a person would type, alongside the window.
   *
   * A lens link carries them too. Left out, they fell back to the form's
   * built-in defaults, which are a fixed week in the past once that week has
   * gone by - and the flexibility chips on the results ("A weekend", "± 3
   * days") widen exactly those two dates, so a search that began on a lens
   * would offer weekends in June.
   */
  const typedDates = { departureDate: addDays(today, 14), returnDate: addDays(today, 21) };
  const lensDefaults = { ...defaults, ...window, ...typedDates };
  const formDefaults = {
    ...lensDefaults,
    flexibility: 'plus-minus-3',
  };

  /*
   * The season is drawn for the middle of the window being looked at.
   *
   * The middle rather than the start, because a search across two months
   * should not paint the world as it is on the first morning of it. Falling
   * back to today when nothing has been asked about, which is the honest
   * answer to "when is this?" before anybody has said.
   */
  const lit = profile ?? snapshot?.assumptions ?? null;
  const model = seasonModel(lit ? middleDate(lit.earliestDeparture, lit.latestReturn) : today);

  const navigation = { path: action, query: withQuery(values, { country: null }) };

  return {
    values,
    today,
    signedIn: Boolean(user),
    defaults,
    formDefaults,
    lensDefaults,
    mode,
    outcome,
    recommended: stageOutcome?.results[0] ?? null,
    profile,
    filters,
    resultAgeMs,
    // Read against the same instant `today` came from, so "updated N min ago"
    // and the dates on the page agree. Null stays null: undated is not old.
    updatedAgeMs: ageOf(stageObservedAt, Date.now()),
    errors,
    assumptions: snapshot?.assumptions ?? null,
    season: {
      bands: bandsToGeoJson(model),
      date: model.date,
      month: monthName(model.month),
      description: describeSeason(model),
    },
    provenance,
    sources,
    dataSource,
    unpriced: !outcome && snapshot === null,
    pricesLoading: discovery?.pending ?? false,
    stage,
    carry,
    destinationsDefault,
    destinationsHint,
    airports: listAirports(),
    modeHref: (next) => `${action}?${withQuery(values, { mapMode: next })}`,
    clearCountryHref: () => {
      const query = withQuery(values, { country: null });
      return query ? `${action}?${query}` : action;
    },
    navigation,
  };
}
