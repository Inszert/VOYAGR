import { cacheKey, getCacheStore, loadAndStore, readThrough, type CacheStore } from '@/cache';
import { addDays } from '@/core/dates';
import type { Freshness } from '@/core/freshness';
import type { IsoDate, IsoDateTime } from '@/core/trip/types';
import { SEARCH_FORM_DEFAULTS } from '@/components/search/search-form';
import { getLogger } from '@/lib/logger';
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

/**
 * An hour. Prices on the front page are a picture, not a quote.
 *
 * Twice the default `PRICE_REFRESH_MINUTES`, so with the worker running a page
 * always finds a fresh entry and only a stopped worker lets one age.
 */
export const DISCOVERY_TTL_MS = 60 * 60 * 1000;

/**
 * How much longer an expired snapshot is served while a refresh runs.
 *
 * A day: an old globe, labelled with its age, beats a blank one or a visitor
 * waiting on a full-catalogue search.
 */
export const DISCOVERY_STALE_MS = 24 * 60 * 60 * 1000;

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
  /**
   * Price these places instead of the whole catalogue.
   *
   * For the themed collections the worker keeps warm; the globe never sets it.
   */
  readonly destinations?: readonly string[];
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
  /** When they were observed. Null when the cache could not say. */
  readonly observedAt: IsoDateTime | null;
  readonly freshness: Freshness;
  readonly assumptions: DiscoveryAssumptions;
}

/** Where the front page's prices come from. One implementation today. */
export interface DiscoverySource {
  /** Null when no snapshot could be made; the globe then shows places without prices. */
  load(input: DiscoveryInput): Promise<DiscoverySnapshot | null>;
  /** Re-price and store, for the worker. False when the input made no valid search. */
  refresh(input: DiscoveryInput): Promise<boolean>;
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
  values.destinations = (input.destinations ?? listPlaceableDestinations()).join(', ');
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
  /** Defaults to the shared store: Redis when configured, memory otherwise. */
  readonly store?: CacheStore;
  readonly run?: (request: SearchRequest, source: DataSource) => Promise<SearchOutcome>;
  readonly now?: () => number;
}

/**
 * The key a snapshot is cached under.
 *
 * The data source is part of it for the reason `searchCacheKey` gives: the same
 * globe priced from fixtures and from the API is two globes. Exported so the
 * worker's refresh writes exactly the entry the page reads.
 */
export function discoveryCacheKey(request: SearchRequest, source: DataSource): string {
  return cacheKey('discovery', { request, source });
}

export class SearchDiscoverySource implements DiscoverySource {
  private readonly store: CacheStore | undefined;
  private readonly run: (request: SearchRequest, source: DataSource) => Promise<SearchOutcome>;
  private readonly now: () => number;

  constructor(options: SearchDiscoverySourceOptions = {}) {
    // Resolved per call when not given, so a test that resets the shared store
    // is not left holding the old one.
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.run = options.run ?? ((request, source) => runSearch(request, dependenciesFor(source)));
  }

  private cacheOptions(request: SearchRequest, source: DataSource) {
    return {
      freshMs: DISCOVERY_TTL_MS,
      staleMs: DISCOVERY_STALE_MS,
      load: () => this.run(request, source),
      now: this.now,
    };
  }

  async load(input: DiscoveryInput): Promise<DiscoverySnapshot | null> {
    const request = buildDiscoveryRequest(input);
    if (!request) return null;

    const source = input.source ?? 'api';

    // `readThrough` does not throw: with nothing cached and the search failing
    // the value is null. The globe without prices is a globe; the page must
    // not fail because the picture on it could not be priced.
    const cached = await readThrough(
      this.store ?? getCacheStore(),
      discoveryCacheKey(request, source),
      this.cacheOptions(request, source),
    );

    if (cached.value === null) {
      log.warn({ err: cached.error }, 'discovery snapshot could not be built');
      return null;
    }

    return {
      request,
      outcome: cached.value,
      ageMs: cached.ageMs ?? 0,
      observedAt: cached.observedAt,
      freshness: cached.freshness,
      assumptions: describeAssumptions(request),
    };
  }

  /**
   * Price the snapshot now and store it, whatever is already there.
   *
   * The worker's entry point: it exists to replace a value before a visitor
   * has to wait for one. Throws on failure, so the job can retry and the old
   * entry keeps being served meanwhile.
   */
  async refresh(input: DiscoveryInput): Promise<boolean> {
    const request = buildDiscoveryRequest(input);
    if (!request) return false;

    const source = input.source ?? 'api';

    await loadAndStore(
      this.store ?? getCacheStore(),
      discoveryCacheKey(request, source),
      this.cacheOptions(request, source),
    );

    return true;
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
