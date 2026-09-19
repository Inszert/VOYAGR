import type {
  AirportCode,
  FlightOffer,
  HotelOffer,
  TransferOffer,
  TripCandidate,
  WeatherOutlook,
} from '@/core/trip/types';
import { isAppError } from '@/lib/errors';
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
import { assembleRouteCandidates, interleave } from './assemble';
import { evaluateTrip } from './evaluate';
import { combineProvenance, provenanceForProvider } from '@/core/trip/provenance';
import { buildSearchPlan } from './plan';
import type {
  DateWindow,
  ProviderIssue,
  RankedTrip,
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
  run: () => Promise<ProviderResult<T>>,
): Promise<T | null> {
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
      counter.calls += 2;

      const [outlook, transfers] = await Promise.all([
        callProvider(
          {
            kind: 'weather',
            providerId: deps.weather.metadata.id,
            scope: `weather:${destination}`,
          },
          issues,
          limiter,
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
): Promise<readonly FlightOffer[]> {
  const offers = await callProvider(
    {
      kind: 'flights',
      providerId: deps.flights.metadata.id,
      scope: `flights:${window.departureDate}..${window.returnDate}`,
    },
    issues,
    limiter,
    () =>
      deps.flights.searchFlights(
        {
          origins: plan.origins,
          destinations: plan.destinations,
          departureDate: window.departureDate,
          returnDate: window.returnDate,
          passengers: plan.passengers,
          currency: plan.currency,
          directOnly: request.profile.requireDirectFlights,
          // Enough headroom for every route to be represented, rather than for
          // one cheap destination to fill the whole response.
          maxResults:
            plan.origins.length * plan.destinations.length * plan.limits.maxFlightOffersPerRoute,
        },
        requestOptions(plan, request.requestId),
      ),
  );

  return offers ?? [];
}

async function fetchHotels(
  plan: SearchPlan,
  deps: SearchDependencies,
  request: SearchRequest,
  destination: AirportCode,
  window: DateWindow,
  issues: ProviderIssue[],
  limiter: Limiter,
): Promise<readonly HotelOffer[]> {
  const { profile } = request;

  const offers = await callProvider(
    {
      kind: 'hotels',
      providerId: deps.hotels.metadata.id,
      scope: `hotels:${destination}:${window.departureDate}..${window.returnDate}`,
    },
    issues,
    limiter,
    () =>
      deps.hotels.searchHotels(
        {
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
          // Headroom above the keep-limit, because the provider applies those
          // filters to this budget before we see anything.
          maxResults: plan.limits.maxHotelOffersPerDestination * 3,
        },
        requestOptions(plan, request.requestId),
      ),
  );

  return offers ?? [];
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
      counter.calls += 1;
      const flightsByDestination = groupByArrival(
        await fetchFlightsForWindow(plan, deps, request, window, issues, limiter),
      );

      return Promise.all(
        plan.destinations.map(async (destination): Promise<TripCandidate[]> => {
          const routeFlights = flightsByDestination.get(destination) ?? [];
          // No flights means no trip. Skipping the hotel call here is the
          // single biggest saving in the whole fan-out.
          if (routeFlights.length === 0) return [];

          counter.calls += 1;
          const hotels = await fetchHotels(
            plan,
            deps,
            request,
            destination,
            window,
            issues,
            limiter,
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
    diagnostics,
  };
}
