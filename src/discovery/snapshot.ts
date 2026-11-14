import { addDays } from '@/core/dates';
import type { IsoDate } from '@/core/trip/types';
import { SEARCH_FORM_DEFAULTS } from '@/components/search/search-form';
import { getLogger } from '@/lib/logger';
import { SearchCache } from '@/search/cache';
import { listPlaceableDestinations, resolveDestinationNames } from '@/search/destination-names';
import { runSearch } from '@/search/orchestrator';
import { dependenciesFor } from '@/search/dependencies';
import type { DataSource } from '@/providers/data-source';
import { parseSearchForm } from '@/search/schema';
import type { SearchOutcome, SearchRequest } from '@/search/types';

/**
 * The discovery snapshot: what the globe shows before anyone has searched.
 *
 * A globe with prices on it needs prices from somewhere, and this product has
 * exactly one honest source for a price: the search engine. So the homepage
 * runs one. The profile is deliberate and stated - the traveller's own origin,
 * currency, party and budget; every destination the catalogue can place; the
 * next two months; four to seven nights - and the rail beside the globe says
 * so, because a price with hidden assumptions is a price nobody can judge.
 *
 * Two properties matter more than the rest.
 *
 * **It is a system search, not the visitor's.** Its limits come from
 * `DISCOVERY_LIMITS` rather than from a plan, so an anonymous plan allowing two
 * destinations cannot produce a globe with two dots on it.
 *
 * **It has its own cache, with a long TTL.** A homepage that ran a full search
 * per visit against a live provider would be the most expensive page in the
 * product. `DiscoverySource` is the seam: today it runs the search; when live
 * providers arrive it reads the latest observed prices from price history,
 * refreshed by a scheduled job, and nothing above this interface changes.
 */

const log = getLogger('discovery.snapshot');

/** An hour. Prices on the front page are a picture, not a quote. */
export const DISCOVERY_TTL_MS = 60 * 60 * 1000;

/**
 * The window the snapshot prices, relative to today.
 *
 * Starts a week out because a trip leaving tomorrow is not what someone
 * browsing a globe is asking about, and runs two months because that is far
 * enough for a flexible-date search to find a cheap week.
 */
export const DISCOVERY_WINDOW = {
  startsInDays: 7,
  lengthDays: 75,
  minNights: 4,
  // Two weeks, not one: the cheapest flight to the far side of the world is
  // seldom a week long, and a globe that only knew week-long trips would leave
  // Brazil, Argentina and most of Asia blank.
  maxNights: 14,
} as const;

/**
 * System limits for the discovery search.
 *
 * `maxDestinations` covers the whole catalogue with room to grow. The
 * per-route limits are tighter than a user's search: the globe needs one
 * honest figure per place, not forty combinations per place, and a snapshot
 * of the whole catalogue must stay cheaper than one ordinary search when the
 * providers are real. The results themselves are not what the globe reads -
 * `destinationSummaries` is, and that covers every eligible trip regardless
 * of `maxResults`.
 */
export const DISCOVERY_LIMITS = {
  maxOrigins: 2,
  maxDestinations: 400,
  maxDateWindows: 4,
  // The globe needs one honest figure per place, not a priced calendar.
  calendarCoverageDays: 0,
  maxFlightOffersPerRoute: 2,
  maxHotelOffersPerDestination: 3,
  maxCandidatesPerRoute: 6,
  maxResults: 10,
  // Every place, each with a weather call, a transfer call and a hotel call.
  maxProviderCalls: 2000,
} as const;

/**
 * The ceiling above the traveller's target, as a multiple.
 *
 * High enough to exclude nothing, so the globe answers "what does it cost?"
 * rather than "what fits a budget nobody has set yet". Scales with the target
 * so it means the same thing in any currency.
 */
const CEILING_MULTIPLIER = 10;

/** The traveller's own settings, which the snapshot keeps and never invents. */
const USER_OWNED = [
  'origins',
  'passengers',
  'currency',
  'targetBudget',
  'travelStyle',
  'optimisationMode',
] as const;

export interface DiscoveryInput {
  /** Today, as an ISO date. Decides the window. */
  readonly today: IsoDate;
  /** The visitor's saved preferences as form values, if any. */
  readonly defaults?: Readonly<Record<string, string>>;
  /**
   * Which adapters to price it with.
   *
   * The snapshot is cached, so this also has to reach the cache key: the
   * same globe priced from fixtures and from the API is two globes, and one
   * of them must not be served under the other's label.
   */
  readonly source?: DataSource;
}

/** What the prices were made under, for the rail to state in words. */
export interface DiscoveryAssumptions {
  readonly origins: readonly string[];
  readonly passengers: number;
  readonly currency: string;
  readonly earliestDeparture: IsoDate;
  readonly latestReturn: IsoDate;
  readonly minNights: number;
  readonly maxNights: number;
}

export interface DiscoverySnapshot {
  readonly request: SearchRequest;
  readonly outcome: SearchOutcome;
  /** How long ago the prices were observed. Zero for a fresh run. */
  readonly ageMs: number;
  readonly assumptions: DiscoveryAssumptions;
}

/** Where the front page's prices come from. One implementation today. */
export interface DiscoverySource {
  /** Null when no snapshot could be made; the globe then shows places without prices. */
  load(input: DiscoveryInput): Promise<DiscoverySnapshot | null>;
}

/**
 * The discovery search as form values.
 *
 * Form values rather than a hand-built profile, so the request passes through
 * exactly the validation a typed search does and cannot drift from it.
 */
export function buildDiscoveryQuery(input: DiscoveryInput): Record<string, string> {
  const defaults = { ...SEARCH_FORM_DEFAULTS, ...input.defaults };
  const values: Record<string, string> = {};

  for (const key of USER_OWNED) values[key] = defaults[key]!;

  const earliestDeparture = addDays(input.today, DISCOVERY_WINDOW.startsInDays);

  values.flexibility = 'custom';
  values.earliestDeparture = earliestDeparture;
  values.latestReturn = addDays(earliestDeparture, DISCOVERY_WINDOW.lengthDays);
  values.minNights = String(DISCOVERY_WINDOW.minNights);
  values.maxNights = String(DISCOVERY_WINDOW.maxNights);
  values.destinations = listPlaceableDestinations().join(', ');
  values.maxBudget = String(Math.ceil(Number(values.targetBudget) * CEILING_MULTIPLIER));

  return values;
}

export function buildDiscoveryRequest(input: DiscoveryInput): SearchRequest | null {
  const parsed = parseSearchForm(buildDiscoveryQuery(input));
  if (!parsed.ok) {
    log.warn({ errors: parsed.error }, 'discovery query did not validate');
    return null;
  }

  return {
    ...parsed.value.request,
    destinationNames: resolveDestinationNames(parsed.value.request.destinations),
    limits: DISCOVERY_LIMITS,
  };
}

export function describeAssumptions(request: SearchRequest): DiscoveryAssumptions {
  const { profile } = request;

  return {
    origins: profile.origins,
    passengers: profile.passengers,
    currency: profile.targetBudget.currency,
    earliestDeparture: profile.earliestDeparture,
    latestReturn: profile.latestReturn,
    minNights: profile.minNights,
    maxNights: profile.maxNights,
  };
}

export interface SearchDiscoverySourceOptions {
  readonly cache?: SearchCache;
  readonly run?: (request: SearchRequest, source: DataSource) => Promise<SearchOutcome>;
}

export class SearchDiscoverySource implements DiscoverySource {
  private readonly cache: SearchCache;
  private readonly run: (request: SearchRequest, source: DataSource) => Promise<SearchOutcome>;

  constructor(options: SearchDiscoverySourceOptions = {}) {
    this.cache = options.cache ?? new SearchCache({ ttlMs: DISCOVERY_TTL_MS, maxEntries: 50 });
    this.run = options.run ?? ((request, source) => runSearch(request, dependenciesFor(source)));
  }

  async load(input: DiscoveryInput): Promise<DiscoverySnapshot | null> {
    const request = buildDiscoveryRequest(input);
    if (!request) return null;

    const source = input.source ?? 'api';

    try {
      const cached = await this.cache.run(request, () => this.run(request, source), source);

      return {
        request,
        outcome: cached.outcome,
        ageMs: cached.ageMs,
        assumptions: describeAssumptions(request),
      };
    } catch (error) {
      // The globe without prices is a globe; the page must not fail because
      // the picture on it could not be priced.
      log.warn({ err: error }, 'discovery snapshot could not be built');
      return null;
    }
  }
}

let shared: DiscoverySource | undefined;

export function getDiscoverySource(): DiscoverySource {
  shared ??= new SearchDiscoverySource();
  return shared;
}

/** Test helper - drops the shared instance. */
export function resetDiscoverySource(): void {
  shared = undefined;
}
