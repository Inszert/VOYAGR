import { addDays, daysBetween } from '@/core/dates';
import { resolveEntitlements } from '@/core/entitlements';
import type { DataProvenance } from '@/core/trip/provenance';
import type { IsoDate, SearchProfile } from '@/core/trip/types';
import { getCurrentUser } from '@/auth/current-user';
import { preferencesToFormDefaults, readExplicitPreferences } from '@/auth/preferences';
import { SEARCH_FORM_DEFAULTS } from '@/components/search/search-form';
import { getRepositories } from '@/db';
import { isAppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { getSearchCache } from '@/search/cache';
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
import { buildStageData, withQuery, type StageData } from './stage-data';

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
  /** The snapshot was attempted and could not be produced. */
  readonly unpriced: boolean;
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

  const user = await getCurrentUser();
  const stored = user ? await getRepositories().preferences.find(user.id) : null;
  const defaults = preferencesToFormDefaults(readExplicitPreferences(stored));

  const mode = parseMapMode(values.mapMode);

  let outcome: SearchOutcome | null = null;
  let profile: SearchProfile | null = null;
  let resultAgeMs = 0;
  let errors: SearchFormErrors = {};

  if (wasSubmitted(values)) {
    const parsed = parseSearchForm(values);

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
        // refresh exists to find out whether the price moved.
        const cached = await getSearchCache().run(request, () => runSearch(request));
        outcome = cached.outcome;
        resultAgeMs = cached.ageMs;
      } catch (error) {
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

  // The stage shows the search when there is one, and the discovery snapshot
  // when there is not. Never both: two answers to "where can I go?" on one
  // page would be two different searches pretending to be one.
  const snapshot = outcome ? null : await getDiscoverySource().load({ today, defaults });
  const stageOutcome = outcome ?? snapshot?.outcome ?? null;
  const provenance = stageOutcome?.diagnostics.provenance ?? 'unavailable';

  const filters = outcome && profile ? parseFilters(values, profile.targetBudget.currency) : null;

  const origins = outcome
    ? (profile?.origins ?? [])
    : (snapshot?.assumptions.origins ?? [defaults.origins ?? SEARCH_FORM_DEFAULTS.origins!]);

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
          }).toString()}`
        : ''
    }`;

  const stage = buildStageData({
    outcome: stageOutcome,
    mode,
    country: values.country,
    selectedDestination: filters?.destination ?? null,
    origins,
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

  const destinationsDefault =
    stage.countryDestinations.length > 0
      ? stage.countryDestinations.join(', ')
      : listPlaceableDestinations().join(', ');

  const destinationsHint = stage.country
    ? stage.countryDestinations.length > 0
      ? `${stage.country.name}'s airports, or any codes.`
      : `Nothing in ${stage.country.name} yet, so everywhere we can price.`
    : 'Everywhere we can price, or airport codes.';

  // Dates a stranger's first search should not have to fix: two weeks out,
  // a week long, three days either side. The lenses keep the window form.
  const earliest = addDays(today, DISCOVERY_WINDOW.startsInDays);
  const window = {
    earliestDeparture: earliest,
    latestReturn: addDays(earliest, DISCOVERY_WINDOW.lengthDays),
  };
  const lensDefaults = { ...defaults, ...window };
  const formDefaults = {
    ...lensDefaults,
    departureDate: addDays(today, 14),
    returnDate: addDays(today, 21),
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
    errors,
    assumptions: snapshot?.assumptions ?? null,
    season: {
      bands: bandsToGeoJson(model),
      date: model.date,
      month: monthName(model.month),
      description: describeSeason(model),
    },
    provenance,
    unpriced: !outcome && snapshot === null,
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
