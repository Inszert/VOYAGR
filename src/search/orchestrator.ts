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
import { createLimiter, type Limiter } from '@/lib/concurrency';
import { getLogger } from '@/lib/logger';
import { getProviderRegistry } from '@/providers/registry';
import type {
  FlightProvider,
  HotelProvider,
  ProviderKind,
  ProviderRequestOptions,
  ProviderResult,
  TransferProvider,
  WeatherProvider,
} from '@/providers/types';
import { collectPages } from '@/providers/paging';
import { assembleRouteCandidates, interleave } from './assemble';
import { evaluateTrip } from './evaluate';
import { combineProvenance, provenanceForProvider } from '@/core/trip/provenance';
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
}

function defaultDependencies(): SearchDependencies {
  const registry = getProviderRegistry();

  return {
    flights: registry.flights,
    hotels: registry.hotels,
    weather: registry.weather,
    transfers: registry.transfers,
  };
}

/** Everything one provider call needs in order to report itself when it fails. */
/** Mutable tally of real provider calls, for the diagnostics. */
interface CallCounter {
  calls: number;
}

interface CallContext {
  readonly kind: ProviderKind;
  readonly providerId: string;
  readonly scope: string;
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
  context: CallContext,
  issues: ProviderIssue[],
  limiter: Limiter,
  counter: CallCounter,
  run: () => Promise<ProviderResult<T>>,
): Promise<T | null> {
  // Counted here, where a call actually happens, rather than at each call
  // site. Once a query can span several pages, a caller counting its own
  // calls is a caller that will drift from the truth.
  counter.calls += 1;

  try {
    // The only place in the search that takes a slot. Acquiring one around the
    // fan-out instead would deadlock: see the rule in `concurrency.ts`.
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
  limiter: Limiter,
  counter: { calls: number },
): Promise<Map<AirportCode, DestinationContext>> {
  const options = requestOptions(plan, request.requestId);

  const entries = await Promise.all(
    plan.destinations.map(async (destination) => {
      const [outlook, transfers] = await Promise.all([
        callProvider(
          {
            kind: 'weather',
            providerId: deps.weather.metadata.id,
            scope: `weather:${destination}`,
          },
          issues,
          limiter,
          counter,
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
            scope: `transfers:${destination}`,
          },
          issues,
          limiter,
          counter,
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
      return [destination, { outlook: outlook ?? [], transfers: transfers ?? [] }] as const;
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
  limiter: Limiter,
  counter: CallCounter,
): Promise<readonly FlightOffer[]> {
  // Enough headroom for every route to be represented, rather than for one
  // cheap destination to fill the whole response.
  const wanted =
    plan.origins.length * plan.destinations.length * plan.limits.maxFlightOffersPerRoute;

  const context = {
    kind: 'flights' as const,
    providerId: deps.flights.metadata.id,
    scope: `flights:${window.departureDate}..${window.returnDate}`,
  };

  // Paged, because "one call returns everything" is false for every vendor
  // evaluated. Each page is a separate provider call and takes its own slot.
  const { result, error } = await collectPages<FlightOffer>(
    async (cursor) => {
      const page = await callProvider(context, issues, limiter, counter, () =>
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

      return page ? ok(page) : err(PAGE_FAILED);
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
  limiter: Limiter,
  counter: CallCounter,
): Promise<readonly HotelOffer[]> {
  const { profile } = request;

  const context = {
    kind: 'hotels' as const,
    providerId: deps.hotels.metadata.id,
    scope: `hotels:${destination}:${window.departureDate}..${window.returnDate}`,
  };

  const { result } = await collectPages<HotelOffer>(
    async (cursor) => {
      const page = await callProvider(context, issues, limiter, counter, () =>
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

      return page ? ok(page) : err(PAGE_FAILED);
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
function rankCandidate(
  candidate: TripCandidate,
  request: SearchRequest,
  currency: string,
  issues: ProviderIssue[],
): RankedTrip | null {
  const mismatch =
    candidate.flight.price.currency !== currency
      ? ({ kind: 'flights', providerId: candidate.flight.providerId, what: 'flight' } as const)
      : candidate.hotel.totalPrice.currency !== currency
        ? ({ kind: 'hotels', providerId: candidate.hotel.providerId, what: 'hotel' } as const)
        : null;

  if (mismatch) {
    issues.push({
      kind: mismatch.kind,
      providerId: mismatch.providerId,
      scope: `${mismatch.kind}:${candidate.destination}`,
      code: 'PROVIDER_ERROR',
      message: `A ${mismatch.what} was quoted in an unexpected currency and was left out.`,
    });
    return null;
  }

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
  const counter = { calls: 0 };

  // One limiter for the whole search. The fan-out below is structural - it
  // decides what to ask and in what shape - while this decides how much of it
  // reaches a provider at once. Keeping those separate is what stopped the
  // nested bounds from multiplying.
  const limiter = createLimiter(plan.limits.providerConcurrency);

  const contexts = await fetchDestinationContexts(plan, deps, request, issues, limiter, counter);

  // One unit of work per date window: its flights, then its hotels. Every
  // window is started at once and the limiter paces the calls, so a slow window
  // holds up nothing but itself.
  const perWindow = await Promise.all(
    plan.dateWindows.map(async (window) => {
      const flightsByDestination = groupByArrival(
        await fetchFlightsForWindow(plan, deps, request, window, issues, limiter, counter),
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
            limiter,
            counter,
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

  const ranked: RankedTrip[] = [];
  for (const candidate of unique.slice(0, plan.limits.maxCandidates)) {
    const trip = rankCandidate(candidate, request, plan.currency, issues);
    if (trip) ranked.push(trip);
  }

  const eligible = ranked.filter((trip) => trip.eligibility.eligible).sort(compareRanked);
  const ineligible = ranked.filter((trip) => !trip.eligibility.eligible).sort(compareRanked);

  const diagnostics: SearchDiagnostics = {
    plan,
    // Asked of the adapters that actually answered, rather than assumed from
    // configuration: a registry can be part live and part mock.
    provenance: combineProvenance([
      provenanceForProvider(deps.flights.metadata.isMock),
      provenanceForProvider(deps.hotels.metadata.isMock),
      provenanceForProvider(deps.transfers.metadata.isMock),
    ]),
    providerCalls: counter.calls,
    peakProviderConcurrency: limiter.peakInFlight,
    issues,
    degraded: issues.length > 0,
    candidatesAssembled: unique.length,
    candidatesEvaluated: ranked.length,
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
