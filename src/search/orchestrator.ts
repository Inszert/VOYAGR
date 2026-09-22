import type {
  AirportCode,
  FlightOffer,
  HotelOffer,
  TransferOffer,
  TripCandidate,
  WeatherOutlook,
} from '@/core/trip/types';
import { summariseDestinations } from './destinations';
import { AppError, isAppError } from '@/lib/errors';
import { err, ok } from '@/lib/result';
import { createLimiterPool, type LimiterPool } from '@/lib/concurrency';
import { concurrencyFor } from '@/providers/rate';
import { convert, fixedRates, type ConversionFailure, type RateSource } from '@/core/fx';
import type { CurrencyCode } from '@/core/money';
import { DEFAULT_FRESHNESS, freshnessOf, weakestFreshness } from '@/core/freshness';
import type { ZodType } from 'zod';
import {
  flightOfferSchema,
  hotelOfferSchema,
  transferOfferSchema,
  validateOffers,
} from '@/providers/schema';
import { getLogger } from '@/lib/logger';
import { getProviderRegistry } from '@/providers/registry';
import type {
  FlightProvider,
  HotelProvider,
  ProviderKind,
  ProviderPage,
  ProviderRequestOptions,
  ProviderResult,
  TransferProvider,
  WeatherProvider,
} from '@/providers/types';
import { collectPages } from '@/providers/paging';
import { assembleRouteCandidates, interleave } from './assemble';
import { evaluateTrip } from './evaluate';
import {
  combineProvenance,
  provenanceForMode,
  type SourceAttribution,
} from '@/core/trip/provenance';
import { buildSearchPlan } from './plan';
import type {
  DateWindow,
  ProviderIssue,
  RankedTrip,
  RouteOffers,
  SearchDiagnostics,
  SearchOutcome,
  SearchPlan,
  SearchRequest,
} from './types';

/**
 * Search orchestration (implementation plan 1.1).
 *
 * Fans out across destinations and date windows, assembles whole trips from
 * whatever came back, then hands every candidate to the deterministic core to
 * be costed, checked and scored.
 *
 * Two rules shape this module:
 *
 *  - **A provider failure degrades a search, it never aborts one.** Every call
 *    is isolated. A flight provider that fails for one date window costs that
 *    window its trips; the other windows still return results, and the failure
 *    is reported in the diagnostics rather than swallowed.
 *  - **No number is produced here.** Totals come from `cost.ts`, eligibility
 *    from `constraints.ts`, ranking from `scoring.ts`. This module only decides
 *    which candidates exist and in what order they are presented.
 */

const log = getLogger('search.orchestrator');

/**
 * Stands in when a page call failed.
 *
 * `callProvider` has already recorded the real failure as a reported issue, so
 * this exists only to stop `collectPages` walking further. It is never shown
 * to anyone.
 */
const PAGE_FAILED = new AppError('PROVIDER_ERROR', 'Provider page failed; already reported');

export interface SearchDependencies {
  readonly flights: FlightProvider;
  readonly hotels: HotelProvider;
  readonly weather: WeatherProvider;
  readonly transfers: TransferProvider;
  /** Injectable so a test can assert on a duration without a real clock. */
  readonly now?: () => number;
  /**
   * Where exchange rates come from, when a provider quotes in another
   * currency.
   *
   * Defaults to a source that holds nothing. That is the honest default: no
   * rate feed has been chosen, and a search must never invent one. With no
   * rates a foreign quote is dropped and says exactly why - which is what
   * happened before, except that the reason is now specific instead of
   * "quoted in an unexpected currency".
   */
  readonly rates?: RateSource;
}

function defaultDependencies(): SearchDependencies {
  const registry = getProviderRegistry();

  return {
    flights: registry.flights,
    hotels: registry.hotels,
    weather: registry.weather,
    transfers: registry.transfers,
    // Empty on purpose: see `SearchDependencies.rates`.
    rates: fixedRates([]),
  };
}

/**
 * What the search is allowed to spend, and what it has spent.
 *
 * Replaces the single limiter and the loose call tally that stood here. Two
 * things changed, both from the live-provider readiness gate:
 *
 *  - **One limiter per provider, not one per search.** A rate limit belongs
 *    to a vendor, so a slow hotel vendor no longer throttles the flight calls
 *    queued behind it, and two vendors are no longer held to a single budget
 *    sized for neither. Within a provider it is still one shared limiter for
 *    the whole search, still taken around the leaf call.
 *  - **A ceiling on calls.** The defaults imply about seventy provider calls
 *    per search, a figure chosen when a call cost nothing. Against a metered
 *    vendor an unbounded fan-out is a bill, so the search stops calling at
 *    `maxCalls` and says so in the diagnostics rather than quietly spending.
 */
interface CallBudget {
  readonly pool: LimiterPool;
  /** The most any one provider may have in flight, before its own limit applies. */
  readonly concurrency: number;
  /** The most calls this whole search may make, across every provider. */
  readonly maxCalls: number;
  /** Mutable tally of real provider calls, for the diagnostics. */
  calls: number;
  /** Set once the ceiling has been reported, so it is reported once. */
  exhausted: boolean;
}

/** Everything one provider call needs in order to report itself when it fails. */
interface CallContext {
  readonly kind: ProviderKind;
  readonly providerId: string;
  readonly scope: string;
}

/** A call context, plus what the provider says it will tolerate. */
interface CallTarget extends CallContext {
  readonly rateLimitPerMinute: number | null;
}

/**
 * Run one provider call under the search's concurrency bound, converting every
 * failure into a recorded issue.
 *
 * Adapters are contracted to return `Result` rather than throw, but a thrown
 * error from a misbehaving adapter must degrade the search exactly as a returned
 * one does - an adapter bug is not a reason to show the user nothing.
 */
async function callProvider<T>(
  target: CallTarget,
  issues: ProviderIssue[],
  budget: CallBudget,
  run: () => Promise<ProviderResult<T>>,
): Promise<T | null> {
  const { rateLimitPerMinute, ...context } = target;

  /*
   * The ceiling, checked before the call rather than after it.
   *
   * Reported once and then silently obeyed: one issue says the search was
   * cut short, and forty more saying it again would bury the real failures
   * underneath. The search degrades rather than aborting, which is the same
   * stance a failed provider call gets.
   */
  if (budget.calls >= budget.maxCalls) {
    if (!budget.exhausted) {
      budget.exhausted = true;

      issues.push({
        ...context,
        code: 'PROVIDER_ERROR',
        message: 'This search reached its provider-call limit, so some options were not checked.',
      });
    }

    return null;
  }

  // Counted here, where a call actually happens, rather than at each call
  // site. Once a query can span several pages, a caller counting its own
  // calls is a caller that will drift from the truth.
  budget.calls += 1;

  try {
    /*
     * The only place in the search that takes a slot, and the only place that
     * decides how big that provider's slot pool is. Acquiring one around the
     * fan-out instead would deadlock: see the rule in `concurrency.ts`.
     */
    const limiter = budget.pool.for(
      context.providerId,
      concurrencyFor(rateLimitPerMinute, budget.concurrency),
    );

    const result = await limiter.run(run);

    if (result.ok) return result.value;

    issues.push({ ...context, code: result.error.code, message: result.error.publicMessage });
  } catch (error) {
    log.warn({ ...context, err: error }, 'provider adapter threw instead of returning a result');

    issues.push({
      ...context,
      code: isAppError(error) ? error.code : 'PROVIDER_ERROR',
      message: isAppError(error)
        ? error.publicMessage
        : 'A travel data provider returned an unexpected response.',
    });
  }

  return null;
}

/**
 * Screen a page of offers before any of it reaches the domain.
 *
 * An adapter's TypeScript signature is a promise about our own code and says
 * nothing about the JSON a vendor actually sent. Everything a provider
 * returns is checked against `src/providers/schema.ts` here, at the one place
 * a page arrives, so nothing has to remember to do it per call site.
 *
 * A malformed offer is dropped and reported, never fatal: nineteen good
 * hotels and one recorded issue is a better search than no search, and it is
 * the same stance already taken on a failed call. The issue is recorded once
 * per page rather than once per offer, because a vendor sending one bad shape
 * usually sends forty.
 */
function screen<T>(
  schema: ZodType<T>,
  page: ProviderPage<unknown> | null,
  context: CallContext,
  issues: ProviderIssue[],
): ProviderPage<T> | null {
  if (!page) return null;

  return { ...page, items: screenList(schema, page.items, context, issues) };
}

/** The same screening, for a provider that answers with a plain list. */
function screenList<T>(
  schema: ZodType<T>,
  offers: readonly unknown[] | null,
  context: CallContext,
  issues: ProviderIssue[],
): readonly T[] {
  if (!offers) return [];

  const { accepted, rejected } = validateOffers(schema, offers);

  if (rejected.length > 0) {
    log.warn(
      { ...context, rejected: rejected.length, problems: rejected[0]?.problems },
      'provider returned offers that failed validation',
    );

    issues.push({
      ...context,
      code: 'PROVIDER_ERROR',
      message:
        rejected.length === 1
          ? 'One offer from a travel provider was malformed and was left out.'
          : `${rejected.length} offers from a travel provider were malformed and were left out.`,
    });
  }

  return accepted;
}

function requestOptions(plan: SearchPlan, requestId: string | undefined): ProviderRequestOptions {
  return {
    ...(requestId ? { requestId } : {}),
    timeoutMs: plan.limits.providerTimeoutMs,
    // A live adapter that honours the signal stops work the moment the budget
    // is spent. A mock ignores it, which is why `timeoutMs` is sent as well.
    signal: AbortSignal.timeout(plan.limits.providerTimeoutMs),
  };
}

function destinationNameFor(request: SearchRequest, destination: AirportCode): string {
  return request.destinationNames?.[destination] ?? destination;
}

/** Per-destination context fetched once and reused across every date window. */
interface DestinationContext {
  readonly outlook: readonly WeatherOutlook[];
  readonly transfers: readonly TransferOffer[];
}

/**
 * Fetch weather and transfers once per destination rather than once per trip.
 *
 * Both answer a question about the destination, not about a particular
 * departure date, so fetching them per date window would multiply the call
 * count by the number of windows for no new information.
 */
async function fetchDestinationContexts(
  plan: SearchPlan,
  deps: SearchDependencies,
  request: SearchRequest,
  issues: ProviderIssue[],
  budget: CallBudget,
): Promise<Map<AirportCode, DestinationContext>> {
  const options = requestOptions(plan, request.requestId);

  const entries = await Promise.all(
    plan.destinations.map(async (destination) => {
      const [outlook, transfers] = await Promise.all([
        callProvider(
          {
            kind: 'weather',
            providerId: deps.weather.metadata.id,
            rateLimitPerMinute: deps.weather.metadata.rateLimitPerMinute,
            scope: `weather:${destination}`,
          },
          issues,
          budget,
          () =>
            deps.weather.getOutlook(
              { destination, startDate: plan.earliestDate, endDate: plan.latestDate },
              options,
            ),
        ),
        callProvider(
          {
            kind: 'transfers',
            providerId: deps.transfers.metadata.id,
            rateLimitPerMinute: deps.transfers.metadata.rateLimitPerMinute,
            scope: `transfers:${destination}`,
          },
          issues,
          budget,
          () =>
            deps.transfers.searchTransfers(
              {
                airport: destination,
                destinationName: destinationNameFor(request, destination),
                passengers: plan.passengers,
                currency: plan.currency,
              },
              options,
            ),
        ),
      ]);

      // A missing outlook or transfer degrades a trip rather than removing it:
      // the scoring engine treats an empty forecast as neutral, and the cost
      // engine reports an unpriced transfer as an excluded line plus a warning.
      return [
        destination,
        {
          outlook: outlook ?? [],
          // Screened like every other provider response. A transfer arrives
          // as a plain list rather than a page, which is the only difference.
          transfers: screenList(
            transferOfferSchema,
            transfers,
            {
              kind: 'transfers',
              providerId: deps.transfers.metadata.id,
              scope: `transfers:${destination}`,
            },
            issues,
          ),
        },
      ] as const;
    }),
  );

  return new Map(entries);
}

/** Flights for one date window, across every origin and destination at once. */
async function fetchFlightsForWindow(
  plan: SearchPlan,
  deps: SearchDependencies,
  request: SearchRequest,
  window: DateWindow,
  issues: ProviderIssue[],
  budget: CallBudget,
): Promise<readonly FlightOffer[]> {
  // Enough headroom for every route to be represented, rather than for one
  // cheap destination to fill the whole response.
  const wanted =
    plan.origins.length * plan.destinations.length * plan.limits.maxFlightOffersPerRoute;

  const context = {
    kind: 'flights' as const,
    providerId: deps.flights.metadata.id,
    rateLimitPerMinute: deps.flights.metadata.rateLimitPerMinute,
    scope: `flights:${window.departureDate}..${window.returnDate}`,
  };

  // Paged, because "one call returns everything" is false for every vendor
  // evaluated. Each page is a separate provider call and takes its own slot.
  const { result, error } = await collectPages<FlightOffer>(
    async (cursor) => {
      const page = await callProvider(context, issues, budget, () =>
        deps.flights.searchFlights(
          {
            origins: plan.origins,
            destinations: plan.destinations,
            departureDate: window.departureDate,
            returnDate: window.returnDate,
            passengers: plan.passengers,
            currency: plan.currency,
            directOnly: request.profile.requireDirectFlights,
            maxResults: plan.limits.maxFlightOffersPerRoute * plan.destinations.length,
            ...(cursor ? { cursor } : {}),
          },
          requestOptions(plan, request.requestId),
        ),
      );

      const screened = screen(flightOfferSchema, page, context, issues);

      return screened ? ok(screened) : err(PAGE_FAILED);
    },
    { maxItems: wanted, maxPages: plan.limits.maxPagesPerSearch },
  );

  // `callProvider` already recorded the failure; nothing more to report here.
  void error;

  return result.items;
}

async function fetchHotels(
  plan: SearchPlan,
  deps: SearchDependencies,
  request: SearchRequest,
  destination: AirportCode,
  window: DateWindow,
  issues: ProviderIssue[],
  budget: CallBudget,
): Promise<readonly HotelOffer[]> {
  const { profile } = request;

  const context = {
    kind: 'hotels' as const,
    providerId: deps.hotels.metadata.id,
    rateLimitPerMinute: deps.hotels.metadata.rateLimitPerMinute,
    scope: `hotels:${destination}:${window.departureDate}..${window.returnDate}`,
  };

  const { result } = await collectPages<HotelOffer>(
    async (cursor) => {
      const page = await callProvider(context, issues, budget, () =>
        deps.hotels.searchHotels(
          {
            ...(cursor ? { cursor } : {}),
            destination,
            checkIn: window.departureDate,
            checkOut: window.returnDate,
            guests: plan.passengers,
            currency: plan.currency,
            // Hard requirements are pushed into the query rather than filtered
            // afterwards, so the provider does not spend its response budget on
            // rooms that could never be eligible.
            ...(profile.minHotelReviewScore !== null
              ? { minReviewScore: profile.minHotelReviewScore }
              : {}),
            ...(profile.requireFreeCancellation ? { freeCancellationOnly: true } : {}),
            // Headroom above the keep-limit, because the provider applies
            // those filters to this budget before we see anything.
            maxResults: plan.limits.maxHotelOffersPerDestination * 3,
          },
          requestOptions(plan, request.requestId),
        ),
      );

      const screened = screen(hotelOfferSchema, page, context, issues);

      return screened ? ok(screened) : err(PAGE_FAILED);
    },
    {
      maxItems: plan.limits.maxHotelOffersPerDestination * 3,
      maxPages: plan.limits.maxPagesPerSearch,
    },
  );

  return result.items;
}

/**
 * Cost, check and score one candidate.
 *
 * Returns null when the candidate cannot be costed honestly. A provider that
 * quotes in a currency the search did not ask for is a contract violation, and
 * converting it here with an invented rate would put a wrong number in front of
 * a user.
 */
type ConvertedCandidate =
  | { readonly ok: true; readonly candidate: TripCandidate }
  | {
      readonly ok: false;
      readonly kind: ProviderKind;
      readonly providerId: string;
      readonly message: string;
    };

/**
 * Put every price on a candidate into one currency.
 *
 * Both quotes and the hotel's excluded fees, because a total assembled from
 * two currencies is not a total. Same currency in and out costs nothing: the
 * common case does no work and allocates no new objects.
 *
 * What a user is told is deliberately plain. "No exchange rate" is a fact
 * about us, not about the trip, and saying so is better than implying the
 * provider was at fault - or worse, saying nothing and showing a shorter list.
 */
function convertCandidate(
  candidate: TripCandidate,
  currency: CurrencyCode,
  rates: RateSource,
): ConvertedCandidate {
  const flightConversion = convert(candidate.flight.price, currency, rates);

  if (!flightConversion.ok) {
    return {
      ok: false,
      kind: 'flights',
      providerId: candidate.flight.providerId,
      message: explainConversion(flightConversion.failure, 'flight'),
    };
  }

  const hotelConversion = convert(candidate.hotel.totalPrice, currency, rates);

  if (!hotelConversion.ok) {
    return {
      ok: false,
      kind: 'hotels',
      providerId: candidate.hotel.providerId,
      message: explainConversion(hotelConversion.failure, 'hotel'),
    };
  }

  /*
   * The excluded fees travel with the price they belong to.
   *
   * A fee left in the vendor's currency beside a converted total is worse
   * than no fee line at all - it is the same number in two units - so a fee
   * that cannot be converted fails the whole candidate rather than being
   * quietly dropped. Never silently drop a cost is the rule this obeys.
   */
  const fees = candidate.hotel.excludedFees;
  const feeConversion = fees === null ? null : convert(fees, currency, rates);

  if (feeConversion && !feeConversion.ok) {
    return {
      ok: false,
      kind: 'hotels',
      providerId: candidate.hotel.providerId,
      message: explainConversion(feeConversion.failure, 'hotel fee'),
    };
  }

  const unchanged =
    flightConversion.value === candidate.flight.price &&
    hotelConversion.value === candidate.hotel.totalPrice &&
    (feeConversion === null || feeConversion.value === fees);

  if (unchanged) return { ok: true, candidate };

  return {
    ok: true,
    candidate: {
      ...candidate,
      flight: { ...candidate.flight, price: flightConversion.value },
      hotel: {
        ...candidate.hotel,
        totalPrice: hotelConversion.value,
        excludedFees: feeConversion ? feeConversion.value : null,
      },
    },
  };
}

function explainConversion(failure: ConversionFailure, what: string): string {
  return failure.reason === 'no_rate'
    ? `A ${what} was quoted in ${failure.from} and no ${failure.from} to ${failure.to} exchange rate was available, so it was left out.`
    : `A ${what} was quoted in ${failure.from} and the ${failure.from} to ${failure.to} exchange rate was too old to use, so it was left out.`;
}

function rankCandidate(
  candidate: TripCandidate,
  request: SearchRequest,
  currency: string,
  issues: ProviderIssue[],
  rates: RateSource,
): RankedTrip | null {
  /*
   * A foreign quote is converted, or it is dropped - never guessed.
   *
   * Before this, a price in another currency was simply left out, and a
   * response entirely in the wrong currency became zero results and one
   * diagnostic: a wrong answer wearing an empty one's clothes. Now the search
   * asks for a rate. If there is one, the price is converted by
   * `src/core/fx.ts` with the arithmetic in integer minor units. If there is
   * not, the trip is still dropped - because the alternative is inventing a
   * number a user would be shown - but the diagnostic says which pair was
   * missing, which is something somebody can act on.
   */
  const converted = convertCandidate(candidate, currency, rates);

  if (!converted.ok) {
    issues.push({
      kind: converted.kind,
      providerId: converted.providerId,
      scope: `${converted.kind}:${candidate.destination}`,
      code: 'PROVIDER_ERROR',
      message: converted.message,
    });

    return null;
  }

  candidate = converted.candidate;

  try {
    return evaluateTrip(candidate, request.profile);
  } catch (error) {
    // A candidate the core refuses to cost is dropped rather than shown with a
    // partial total: loud in the logs, absent from the results.
    log.error({ candidateId: candidate.id, err: error }, 'candidate could not be costed');
    return null;
  }
}

/**
 * Ranking order.
 *
 * Score first, then the cheaper trip, then the id. The last tiebreak is not
 * cosmetic: without it two equally scored trips could swap places between
 * refreshes and look like a change worth alerting on.
 */
function compareRanked(a: RankedTrip, b: RankedTrip): number {
  return (
    b.score.score - a.score.score ||
    a.cost.total.amount - b.cost.total.amount ||
    a.candidate.id.localeCompare(b.candidate.id)
  );
}

/**
 * The distinct flights and hotels seen for each route.
 *
 * Built from every candidate that was assembled, so the swap options a user is
 * offered do not depend on how many results the page happens to show. Bounded,
 * because a wide search sees a lot and nobody compares thirty hotels.
 */
function collectRouteOffers(candidates: readonly TripCandidate[], limit: number): RouteOffers[] {
  const byRoute = new Map<
    string,
    { route: RouteOffers; flights: Map<string, FlightOffer>; hotels: Map<string, HotelOffer> }
  >();

  for (const candidate of candidates) {
    const key = `${candidate.destination}|${candidate.dates.departureDate}|${candidate.dates.nights}`;
    let entry = byRoute.get(key);

    if (!entry) {
      entry = {
        route: {
          destination: candidate.destination,
          departureDate: candidate.dates.departureDate,
          nights: candidate.dates.nights,
          flights: [],
          hotels: [],
        },
        flights: new Map(),
        hotels: new Map(),
      };
      byRoute.set(key, entry);
    }

    if (!entry.flights.has(candidate.flight.id))
      entry.flights.set(candidate.flight.id, candidate.flight);
    if (!entry.hotels.has(candidate.hotel.id))
      entry.hotels.set(candidate.hotel.id, candidate.hotel);
  }

  return [...byRoute.values()].map((entry) => ({
    ...entry.route,
    flights: [...entry.flights.values()]
      .sort((a, b) => a.price.amount - b.price.amount)
      .slice(0, limit),
    hotels: [...entry.hotels.values()]
      .sort((a, b) => a.totalPrice.amount - b.totalPrice.amount)
      .slice(0, limit),
  }));
}

/** Index the flight offers for one window by the airport they arrive at. */
function groupByArrival(offers: readonly FlightOffer[]): Map<AirportCode, FlightOffer[]> {
  const grouped = new Map<AirportCode, FlightOffer[]>();

  for (const offer of offers) {
    const destination = offer.outbound.segments.at(-1)?.destination;
    if (destination === undefined) continue;

    const existing = grouped.get(destination);
    if (existing) existing.push(offer);
    else grouped.set(destination, [offer]);
  }

  return grouped;
}

/**
 * Run a complete search.
 *
 * @throws AppError VALIDATION_ERROR when the request cannot describe any trip.
 *   Provider failures never throw: they are reported in
 *   `outcome.diagnostics.issues`, and the search returns what it could build.
 */
export async function runSearch(
  request: SearchRequest,
  dependencies?: Partial<SearchDependencies>,
): Promise<SearchOutcome> {
  // The plan is built before the providers are resolved, so an invalid request
  // fails on its own terms rather than on a configuration error.
  const plan = buildSearchPlan(request);

  const deps: SearchDependencies = { ...defaultDependencies(), ...dependencies };
  const now = deps.now ?? Date.now;
  const startedAt = now();

  const issues: ProviderIssue[] = [];
  /*
   * What this search may spend. The fan-out below is structural - it decides
   * what to ask and in what shape - while this decides how much of it reaches
   * a provider, and how much of it happens at all. Keeping those separate is
   * what stopped the nested bounds from multiplying.
   */
  const budget: CallBudget = {
    pool: createLimiterPool(plan.limits.providerConcurrency),
    concurrency: plan.limits.providerConcurrency,
    maxCalls: plan.limits.maxProviderCalls,
    calls: 0,
    exhausted: false,
  };

  const contexts = await fetchDestinationContexts(plan, deps, request, issues, budget);

  // One unit of work per date window: its flights, then its hotels. Every
  // window is started at once and the limiter paces the calls, so a slow window
  // holds up nothing but itself.
  const perWindow = await Promise.all(
    plan.dateWindows.map(async (window) => {
      const flightsByDestination = groupByArrival(
        await fetchFlightsForWindow(plan, deps, request, window, issues, budget),
      );

      return Promise.all(
        plan.destinations.map(async (destination): Promise<TripCandidate[]> => {
          const routeFlights = flightsByDestination.get(destination) ?? [];
          // No flights means no trip. Skipping the hotel call here is the
          // single biggest saving in the whole fan-out.
          if (routeFlights.length === 0) return [];

          const hotels = await fetchHotels(
            plan,
            deps,
            request,
            destination,
            window,
            issues,
            budget,
          );
          if (hotels.length === 0) return [];

          const context = contexts.get(destination);

          return assembleRouteCandidates({
            destination,
            destinationName: destinationNameFor(request, destination),
            window,
            passengers: plan.passengers,
            flights: routeFlights,
            hotels,
            transfers: context?.transfers ?? [],
            outlook: context?.outlook ?? [],
            limits: plan.limits,
          });
        }),
      );
    }),
  );

  // Interleaved rather than concatenated, so the global cap below trims every
  // route evenly instead of spending the whole budget on the first one.
  const assembled = interleave(perWindow.flat().filter((group) => group.length > 0));

  // Ids are content-derived, so a duplicate means the same combination was
  // reachable twice. Keep the first and move on.
  const seen = new Set<string>();
  const unique = assembled.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });

  /*
   * Who answered, and what their answers are worth.
   *
   * Read off the adapters that actually served this search rather than from
   * configuration, because a registry can be part live and part mock. `mode`
   * is what decides it: `isMock` is a boolean and cannot tell a live account
   * from a sandbox, so a Duffel test key would otherwise inherit "Live
   * price" for seats that do not exist.
   */
  const sources: SourceAttribution[] = (
    [
      ['flights', deps.flights],
      ['hotels', deps.hotels],
      ['transfers', deps.transfers],
    ] as const
  ).map(([part, provider]) => ({
    part,
    providerId: provider.metadata.id,
    displayName: provider.metadata.displayName,
    provenance: provenanceForMode(
      provider.metadata.mode ?? (provider.metadata.isMock ? 'mock' : 'live'),
    ),
  }));

  const ranked: RankedTrip[] = [];
  const rates = deps.rates ?? fixedRates([]);

  /*
   * How current the quotes behind these results are.
   *
   * Taken against the clock the search started on, so every trip in one
   * result set is judged at the same instant rather than drifting as the
   * ranking loop runs.
   */
  const freshness = { fresh: 0, stale: 0, unknown: 0 };

  for (const candidate of unique.slice(0, plan.limits.maxCandidates)) {
    const trip = rankCandidate(candidate, request, plan.currency, issues, rates);
    if (!trip) continue;

    freshness[
      weakestFreshness([
        freshnessOf(candidate.flight.observedAt, startedAt, DEFAULT_FRESHNESS.flights),
        freshnessOf(candidate.hotel.observedAt, startedAt, DEFAULT_FRESHNESS.hotels),
      ])
    ] += 1;

    ranked.push(trip);
  }

  const eligible = ranked.filter((trip) => trip.eligibility.eligible).sort(compareRanked);
  const ineligible = ranked.filter((trip) => !trip.eligibility.eligible).sort(compareRanked);

  const diagnostics: SearchDiagnostics = {
    plan,
    // Asked of the adapters that actually answered, rather than assumed from
    // configuration: a registry can be part live and part mock.
    provenance: combineProvenance(sources.map((source) => source.provenance)),
    sources,
    providerCalls: budget.calls,
    /*
     * The worst any single provider was pushed to.
     *
     * There is a limiter per provider now, so there is no one number for the
     * search; the highest of them is what says whether the bound was ever
     * near its edge, which is what this diagnostic is for.
     */
    peakProviderConcurrency: Math.max(
      0,
      ...[...budget.pool.limiters.values()].map((limiter) => limiter.peakInFlight),
    ),
    issues,
    degraded: issues.length > 0,
    candidatesAssembled: unique.length,
    candidatesEvaluated: ranked.length,
    quoteFreshness: freshness,
    eligibleCount: eligible.length,
    ineligibleCount: ineligible.length,
    durationMs: now() - startedAt,
  };

  log[issues.length > 0 ? 'warn' : 'info'](
    {
      requestId: request.requestId,
      destinations: plan.destinations.length,
      dateWindows: plan.dateWindows.length,
      providerCalls: diagnostics.providerCalls,
      assembled: diagnostics.candidatesAssembled,
      eligible: diagnostics.eligibleCount,
      issues: issues.length,
      durationMs: diagnostics.durationMs,
    },
    issues.length > 0 ? 'search completed with degraded provider coverage' : 'search completed',
  );

  return {
    results: eligible.slice(0, plan.limits.maxResults),
    nearMisses: ineligible.slice(0, plan.limits.maxNearMisses),
    routeOffers: collectRouteOffers(unique, plan.limits.maxSwapOptionsPerRoute),
    // From every eligible trip, deliberately - not from the page above it.
    destinationSummaries: summariseDestinations(eligible),
    diagnostics,
  };
}
